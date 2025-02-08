const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const { handleQuestProgression } = require('../services/questService');
const stateService = require('../services/stateService');
const Actor = require('../models/Actor');
const User = require('../models/User');
const Mob = require('../models/Mob');
const Quest = require('../models/Quest');
const socketService = require('../services/socketService');
const { publishSystemMessage } = require('../services/chatService');

const HELP_TEXT = `
Available Commands:
------------------
ls................List all players and NPCs in current location
ls <name>.........View details of player or NPC in current location
chat <actor>......Talk to an NPC in current location
quests............View your active quests and current hints
?.................Display this help message
`.trim();

async function handleCommand(socket, data) {
    try {
        const user = await User.findById(socket.user.userId);
        if (!user || !user.avatarName || !user.currentNode) {
            throw new Error('User not found or missing required data');
        }

        switch (data.command) {
            case 'move': {
                const oldNode = user.currentNode;
                const result = await nodeService.moveUser(socket.user.userId, data.direction);
                if (oldNode) {
                    stateService.removeUserFromNode(socket.user.userId, oldNode);
                    await socketService.unsubscribeFromNodeChat(oldNode);
                }
                
                stateService.addUserToNode(socket.user.userId, user.currentNode);
                await socketService.subscribeToNodeChat(user.currentNode);

                socket.emit('console response', {
                    message: result.message,
                    type: 'move'
                });
                break;
            }

            case 'list':
                await handleListCommand(socket, user, data.target);
                break;

            case 'chat':
                await handleChatCommand(socket, user, data.target);
                break;

            case 'quests':
                await handleQuestsCommand(socket, user);
                break;

            case 'help':
                socket.emit('console response', {
                    type: 'info',
                    message: HELP_TEXT
                });
                break;

            default:
                socket.emit('console response', {
                    type: 'error',
                    message: 'Unknown command'
                });
        }
    } catch (error) {
        logger.error('Error handling console command:', error);
        socket.emit('console response', { 
            message: error.message || 'Error processing command',
            type: 'error'
        });
    }
}

async function handleListCommand(socket, user, target) {
    const nodeUsers = stateService.nodeUsernames.get(user.currentNode) || [];
    const actors = await Actor.find({ location: user.currentNode });
    const actorNames = actors.map(actor => actor.name);

    if (target) {
        // Check players first
        const targetUser = nodeUsers.find(
            username => username.toLowerCase() === target.toLowerCase()
        );
        
        if (targetUser) {
            socket.emit('console response', {
                type: 'list',
                redirect: true,
                target: targetUser
            });
            return;
        }
        
        // Then check actors
        const targetActor = actors.find(
            actor => actor.name.toLowerCase() === target.toLowerCase()
        );
        
        if (targetActor) {
            socket.emit('console response', {
                type: 'list',
                redirect: true,
                target: targetActor.name,
                isActor: true,
                description: targetActor.description,
                image: targetActor.image
            });
            return;
        }

        socket.emit('console response', {
            type: 'error',
            message: `Character "${target}" not found in this location.`
        });
    } else {
        let mobNames = [];
        const mobInstance = stateService.playerEnemies.get(user._id.toString());
        if (mobInstance) {
            mobNames.push(mobInstance.name);
        }
        socket.emit('console response', {
            type: 'list',
            users: nodeUsers,
            actors: actorNames,
            enemies: mobNames
        });
    }
}

async function handleChatCommand(socket, user, target) {
    if (!target) {
        socket.emit('console response', { 
            message: 'Usage: chat <actor or mob name>'
        });
        return;
    }

    // First, try to find an actor in the current location
    const actor = await Actor.findOne({ 
        name: new RegExp(`^${target}$`, 'i'), 
        location: user.currentNode 
    });

    logger.error('QUEST DEBUG - Found actor:', actor ? {
        id: actor.id,
        name: actor.name,
        location: actor.location
    } : 'No actor found');

    if (actor) {
        logger.error('QUEST DEBUG - Attempting quest progression with actor:', {
            customId: actor.id,
            mongoId: actor._id.toString()
        });
        const questResponse = await handleQuestProgression(socket.user.userId, actor.id);
        logger.error('QUEST DEBUG - Quest progression response:', questResponse);

        if (questResponse) {
            logger.error('QUEST DEBUG - Sending quest response to client');
            socket.emit('console response', { 
                message: questResponse.message 
            });

            if (questResponse.isComplete) {
                socket.emit('console response', { 
                    message: `Quest completed: ${questResponse.questTitle}`,
                    type: 'system'
                });
            }
            return;
        }

        // Regular actor chat
        logger.error('QUEST DEBUG - No quest response, proceeding with regular chat');
        const stateKey = `${socket.user.userId}-${actor.id}`;
        let currentIndex = stateService.actorChatStates.get(stateKey) || 0;
        const sortedMessages = [...actor.chatMessages].sort((a, b) => a.order - b.order);
        const message = sortedMessages[currentIndex];
        currentIndex = (currentIndex + 1) % sortedMessages.length;
        stateService.actorChatStates.set(stateKey, currentIndex);

        socket.emit('console response', {
            type: 'chat',
            message: `${actor.name} says: "${message.message}"`
        });
        return;
    }

    // Check for mob chat
    const mobInstance = stateService.playerEnemies.get(user._id.toString());
    if (mobInstance && mobInstance.name.toLowerCase() === target.toLowerCase()) {
        const stateKey = `${socket.user.userId}-${mobInstance.instanceId}`;
        let currentIndex = stateService.actorChatStates.get(stateKey) || 0;
        const sortedMessages = [...mobInstance.chatMessages].sort((a, b) => a.order - b.order);
        
        if (!sortedMessages.length) {
            socket.emit('console response', {
                type: 'chat',
                message: `${mobInstance.name} has nothing to say.`
            });
            return;
        }

        const message = sortedMessages[currentIndex];
        currentIndex = (currentIndex + 1) % sortedMessages.length;
        stateService.actorChatStates.set(stateKey, currentIndex);

        socket.emit('console response', {
            type: 'chat',
            message: `${mobInstance.name} says: "${message.message}"`
        });
        return;
    }

    socket.emit('console response', { 
        message: `No actor or mob named "${target}" found in current location.`
    });
}

async function handleQuestsCommand(socket, user) {
    const allQuests = await Quest.find();
    
    const activeQuests = user.quests
        .filter(userQuest => !userQuest.completed)
        .map(userQuest => {
            const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
            if (!quest) return null;

            const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
            if (!currentEvent) return null;
            
            const choices = currentEvent.choices.map(choice => {
                const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                return nextEvent?.hint || 'No hint available';
            }).filter(Boolean);

            return {
                title: quest.title,
                hints: choices.length > 0 ? choices : ['No available choices']
            };
        })
        .filter(Boolean);

    if (activeQuests.length === 0) {
        socket.emit('console response', {
            type: 'quests',
            message: 'You have no active quests.'
        });
        return;
    }

    const questList = activeQuests
        .map(quest => {
            const hintsText = quest.hints
                .map(hint => `  Hint: ${hint}`)
                .join('\n');
            return `${quest.title}\n${hintsText}`;
        })
        .join('\n\n');

    socket.emit('console response', {
        type: 'quests',
        message: `Active Quests:\n--------------\n${questList}`
    });
}

module.exports = {
    handleCommand
}; 