const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const userService = require('../services/userService');
const combatService = require('../services/combatService');
const actorService = require('../services/actorService');
const questService = require('../services/questService');
const conversationService = require('../services/conversationService');

const HELP_TEXT = `
Available Commands:
------------------
ls................List all players and NPCs in current location
ls <name>.........View details of player or NPC in current location
chat <actor>......Talk to an NPC in current location
quests............View your active quests and current hints
fight <mob>.......Engage in combat with a mob
rest..............Rest to restore health (only at rest points)
map...............Open the world map view
?.................Display this help message
`.trim();

async function handleCommand(socket, data) {
    try {
        const user = await userService.getUser(socket.user.userId);
        if (!userService.validateUser(user)) {
            throw new Error('User not found or missing required data');
        }

        // Check if user is in combat
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        
        // If in combat, handle combat moves first
        if (combatState && data.command !== 'help' && data.command !== 'flee') {
            await combatService.handleCombatCommand(user, data.command);
            return;
        }

        // Check if user is in combat for restricted commands
        if (combatState && ['move', 'list', 'chat', 'quests'].includes(data.command)) {
            socket.emit('console response', {
                type: 'error',
                message: 'You cannot use this command while in combat!'
            });
            return;
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
                if (combatState) {
                    const combatHelp = await userService.formatCombatHelp(socket.user.userId);
                    socket.emit('console response', {
                        type: 'info',
                        message: combatHelp
                    });
                } else {
                    socket.emit('console response', {
                        type: 'info',
                        message: HELP_TEXT
                    });
                }
                break;

            case 'fight':
                await combatService.handleFightCommand(user, data.target);
                break;

            case 'flee':
                await combatService.handleFleeCommand(user);
                break;

            case 'rest':
                await handleRestCommand(socket, user);
                break;

            case 'map':
                await handleMapCommand(socket, user);
                break;

            default:
                // If in combat, handle combat moves
                if (combatState && data.command !== 'help') {
                    await combatService.handleCombatCommand(user, data.command);
                    return;
                }
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
    const actorNames = await actorService.getActorsInLocation(user.currentNode);
    const mobInstance = stateService.playerMobs.get(user._id.toString());

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
        const targetActor = await actorService.findActorInLocation(target, user.currentNode);
        
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

        // Finally check mobs
        if (mobInstance && mobInstance.name.toLowerCase() === target.toLowerCase()) {
            socket.emit('console response', {
                type: 'list',
                redirect: true,
                target: mobInstance.name,
                isActor: true,
                description: mobInstance.description,
                image: mobInstance.image
            });
            return;
        }

        socket.emit('console response', {
            type: 'error',
            message: `Character "${target}" not found in this location.`
        });
    } else {
        let mobNames = [];
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

    // First check if user is in an active conversation
    if (conversationService.isInConversation(user._id.toString())) {
        const result = await conversationService.processConversationInput(
            user._id.toString(), 
            target
        );
        
        if (result) {
            if (result.error) {
                socket.emit('console response', {
                    type: 'error',
                    message: result.message
                });
            } else {
                // Get the actor name from the active conversation
                const activeConv = stateService.getActiveConversation(user._id.toString());
                const actor = await actorService.findActorById(activeConv.actorId);
                
                socket.emit('console response', {
                    type: 'chat',
                    message: `${actor.name} says: "${result.message}"`,
                    isEndOfConversation: result.isEnd
                });

                // If this is the end of the conversation, clear the state
                if (result.isEnd) {
                    stateService.clearActiveConversation(user._id.toString());
                }
            }
        }
        return;
    }

    // If not in conversation, try to find an actor in the current location
    const actor = await actorService.findActorInLocation(target, user.currentNode);

    if (actor) {
        // Try to start a conversation
        const conversationResult = await conversationService.handleActorChat(user, actor);
        
        if (conversationResult) {
            socket.emit('console response', {
                type: 'chat',
                message: `${actor.name} says: "${conversationResult.message}"`
            });
            return;
        }

        // Fall back to quest progression if no conversation available
        const questResponse = await questService.handleQuestProgression(user, actor.id);

        if (questResponse) {
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
        const stateKey = `${socket.user.userId}-${actor.id}`;
        let currentIndex = stateService.actorChatStates.get(stateKey) || 0;
        const chatResult = actorService.getActorChatMessage(actor, stateKey, currentIndex);
        stateService.actorChatStates.set(stateKey, chatResult.nextIndex);

        socket.emit('console response', {
            type: 'chat',
            message: `${actor.name} says: "${chatResult.message}"`
        });
        return;
    }

    // Check for mob chat
    const mobInstance = stateService.playerMobs.get(user._id.toString());
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
    try {
        const activeQuests = await questService.getActiveQuests(user._id);

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
    } catch (error) {
        socket.emit('console response', {
            type: 'error',
            message: 'Error retrieving quests'
        });
    }
}

async function handleRestCommand(socket, user) {
    try {
        // Check if user is in a rest point using nodeService
        const isRest = await nodeService.isRestPoint(user.currentNode);
        if (!isRest) {
            socket.emit('console response', {
                type: 'error',
                message: 'You can only rest at designated rest points.'
            });
            return;
        }

        const result = await userService.healUser(user._id);
        socket.emit('console response', {
            type: 'success',
            message: `You rest and recover your health. (HP restored to ${result.healed})`
        });
    } catch (error) {
        socket.emit('console response', {
            type: 'error',
            message: 'Failed to rest: ' + error.message
        });
    }
}

async function handleMapCommand(socket, user) {
    // Implementation of handleMapCommand
}

module.exports = {
    handleCommand
}; 