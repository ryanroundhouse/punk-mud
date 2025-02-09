const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const { handleQuestProgression } = require('../services/questService');
const stateService = require('../services/stateService');
const mobService = require('../services/mobService');
const Actor = require('../models/Actor');
const User = require('../models/User');
const Mob = require('../models/Mob');
const Quest = require('../models/Quest');
const socketService = require('../services/socketService');
const { publishSystemMessage } = require('../services/chatService');
const userService = require('../services/userService');

const HELP_TEXT = `
Available Commands:
------------------
ls................List all players and NPCs in current location
ls <name>.........View details of player or NPC in current location
chat <actor>......Talk to an NPC in current location
quests............View your active quests and current hints
fight <mob>.......Engage in combat with a mob
?.................Display this help message
`.trim();

async function handleCommand(socket, data) {
    try {
        const user = await User.findById(socket.user.userId);
        if (!user || !user.avatarName || !user.currentNode) {
            throw new Error('User not found or missing required data');
        }

        // Check if user is in combat
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        
        // If in combat, handle combat moves first
        if (combatState && data.command !== 'help' && data.command !== 'flee') {
            await handleCombatCommand(socket, user, data.command);
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
                await handleFightCommand(socket, user, data.target);
                break;

            case 'flee':
                await handleFleeCommand(socket, user);
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

    // First, try to find an actor in the current location
    const actor = await Actor.findOne({ 
        name: new RegExp(`^${target}$`, 'i'), 
        location: user.currentNode 
    });

    if (actor) {
        const questResponse = await handleQuestProgression(socket.user.userId, actor.id);

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

async function handleFightCommand(socket, user, target) {
    if (!target) {
        socket.emit('console response', {
            type: 'error',
            message: 'Usage: fight <mob name>'
        });
        return;
    }

    // Check if already in combat
    if (stateService.userCombatStates.get(socket.user.userId)) {
        socket.emit('console response', {
            type: 'error',
            message: 'You are already in combat!'
        });
        return;
    }

    // Get mob from current location
    const mobInstance = stateService.playerMobs.get(user._id.toString());
    if (!mobInstance || mobInstance.name.toLowerCase() !== target.toLowerCase()) {
        socket.emit('console response', {
            type: 'error',
            message: `No mob named "${target}" found in current location.`
        });
        return;
    }

    // Initialize combat state
    stateService.userCombatStates.set(socket.user.userId, {
        mobInstanceId: mobInstance.instanceId,
        mobName: mobInstance.name
    });

    socket.emit('console response', {
        type: 'combat',
        message: `You engage in combat with ${mobInstance.name}!`,
        hint: 'Type ? to see available combat commands.'
    });

    publishSystemMessage(user.currentNode, `${user.avatarName} engages in combat with ${mobInstance.name}!`);
}

async function handleCombatCommand(socket, user, moveName) {
    try {
        logger.debug(`Starting combat command for user ${user._id} with move: ${moveName}`);
        
        // Get user's available moves
        const userMoves = await userService.getUserMoves(user._id);
        logger.debug('User moves:', userMoves);
        
        const selectedMove = userMoves.find(move => 
            move.name.toLowerCase() === moveName.toLowerCase()
        );

        logger.debug('Selected move:', selectedMove);

        if (!selectedMove) {
            socket.emit('console response', {
                type: 'error',
                message: `You don't know the move "${moveName}"`
            });
            return;
        }

        // Get combat state and mob
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        logger.debug('Combat state:', combatState);
        
        const mobInstance = stateService.playerMobs.get(user._id.toString());
        logger.debug('Mob instance:', mobInstance);

        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            logger.warn('Mob instance not found or mismatch:', {
                mobInstance: mobInstance?.instanceId,
                expectedId: combatState?.mobInstanceId
            });
            socket.emit('console response', {
                type: 'error',
                message: 'Your target is no longer available.'
            });
            stateService.userCombatStates.delete(socket.user.userId);
            return;
        }

        // Select random mob move based on usageChance
        const mobMoves = mobInstance.moves;
        logger.debug('Mob moves:', mobMoves);

        if (!mobMoves || !Array.isArray(mobMoves)) {
            logger.error('Invalid mob moves:', {
                mobMoves,
                mobInstance,
                mobId: mobInstance.instanceId
            });
            throw new Error('Invalid mob moves configuration');
        }

        const totalChance = mobMoves.reduce((sum, move) => sum + move.usageChance, 0);
        let random = Math.random() * totalChance;
        let mobMove;

        for (const move of mobMoves) {
            random -= move.usageChance;
            if (random <= 0) {
                mobMove = move;
                break;
            }
        }

        logger.debug('Selected mob move:', mobMove);

        // Calculate combat results
        const playerResult = calculateAttackResult(selectedMove, user.avatarName, mobInstance.name);
        const mobResult = calculateAttackResult(mobMove, mobInstance.name, user.avatarName);

        logger.debug('Combat results:', { playerResult, mobResult });

        // Apply combat effects and check results
        if (playerResult.effect) {
            const target = playerResult.effect.target === 'self' ? user.stats : mobInstance.stats;
            const stat = playerResult.effect.stat;
            if (stat && target) {
                if (stat === 'hitpoints') {
                    target.currentHitpoints += playerResult.effect.amount || 0;
                    // If this affected the user, save to database
                    if (target === user.stats) {
                        await User.findByIdAndUpdate(user._id, {
                            'stats.currentHitpoints': user.stats.currentHitpoints
                        });
                    }
                } else {
                    target[stat] += playerResult.effect.amount || 0;
                }
            }
        }

        if (mobResult.effect) {
            const target = mobResult.effect.target === 'self' ? mobInstance.stats : user.stats;
            const stat = mobResult.effect.stat;
            if (stat && target) {
                if (stat === 'hitpoints') {
                    target.currentHitpoints += mobResult.effect.amount || 0;
                    // If this affected the user, save to database
                    if (target === user.stats) {
                        await User.findByIdAndUpdate(user._id, {
                            'stats.currentHitpoints': user.stats.currentHitpoints
                        });
                    }
                } else {
                    target[stat] += mobResult.effect.amount || 0;
                }
            }
        }

        // Get current HP status after applying effects
        const userCurrentHP = user.stats.currentHitpoints;
        const mobCurrentHP = mobInstance.stats.currentHitpoints;

        // Check if mob is defeated
        if (mobCurrentHP <= 0) {
            // Clear combat state and remove mob
            stateService.clearUserCombatState(socket.user.userId);
            mobService.clearUserMob(user._id.toString());

            socket.emit('console response', {
                type: 'combat',
                message: `You use ${selectedMove.name}! ${playerResult.message}\n` +
                         `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n` +
                         `\nVictory! You have defeated ${mobInstance.name}!`
            });

            publishSystemMessage(
                user.currentNode,
                `${user.avatarName} has defeated ${mobInstance.name}!`
            );
            return;
        }

        // Normal combat round message if mob wasn't defeated
        socket.emit('console response', {
            type: 'combat',
            message: `You use ${selectedMove.name}! ${playerResult.message}\n` +
                     `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n` +
                     `\nStatus:\n` +
                     `${user.avatarName}: ${userCurrentHP} HP\n` +
                     `${mobInstance.name}: ${mobCurrentHP} HP`
        });

    } catch (error) {
        logger.error('Error handling combat command:', {
            error,
            userId: user._id,
            moveName,
            stack: error.stack
        });
        socket.emit('console response', {
            type: 'error',
            message: 'Error processing combat command'
        });
    }
}

function calculateAttackResult(move, attackerName, defenderName) {
    const success = Math.random() * 100 <= move.successChance;
    const effect = success ? move.success : move.failure;
    
    if (!effect) {
        return {
            success,
            message: success ? 'The attack succeeds!' : 'The attack fails!'
        };
    }

    const targetName = effect.target === 'self' ? attackerName : defenderName;
    const amount = effect.amount || 0;
    
    // Start with custom message if it exists
    let message = '';
    if (effect.message) {
        message = effect.message
            .replace(/\[name\]/g, attackerName)
            .replace(/\[opponent\]/g, defenderName);
    }

    // Only add effect message if amount is non-zero
    if (amount !== 0) {
        let effectMessage;
        if (effect.stat === 'hitpoints') {
            if (amount < 0) {
                effectMessage = `${targetName} takes ${Math.abs(amount)} damage!`;
            } else {
                effectMessage = `${targetName} heals for ${amount} points!`;
            }
        } else {
            const statEffect = amount < 0 ? 'loses' : 'gains';
            effectMessage = `${targetName} ${statEffect} ${Math.abs(amount)} ${effect.stat}!`;
        }
        
        message = message ? `${message} ${effectMessage}` : effectMessage;
    }

    return {
        success,
        effect,
        message: message || 'Nothing happens.'
    };
}

async function handleFleeCommand(socket, user) {
    try {
        // Check if user is in combat
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        if (!combatState) {
            socket.emit('console response', {
                type: 'error',
                message: 'You are not in combat!'
            });
            return;
        }

        // Get the mob instance
        const mobInstance = stateService.playerMobs.get(user._id.toString());
        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            socket.emit('console response', {
                type: 'error',
                message: 'Your target is no longer available.'
            });
            stateService.userCombatStates.delete(socket.user.userId);
            return;
        }

        // Mob gets a free attack
        const mobMove = mobInstance.moves[0]; // Use first move as "chase" attack
        const mobResult = calculateAttackResult(mobMove, mobInstance.name, user.avatarName);
        
        // Apply mob attack effect
        if (mobResult.effect) {
            const target = mobResult.effect.target === 'self' ? mobInstance.stats : user.stats;
            const stat = mobResult.effect.stat;
            if (stat && target) {
                if (stat === 'hitpoints') {
                    target.currentHitpoints += mobResult.effect.amount || 0;
                    if (target === user.stats) {
                        await User.findByIdAndUpdate(user._id, {
                            'stats.currentHitpoints': user.stats.currentHitpoints
                        });
                    }
                } else {
                    target[stat] += mobResult.effect.amount || 0;
                }
            }
        }

        // 50% chance to successfully flee
        const fleeSuccess = Math.random() < 0.5;

        if (fleeSuccess) {
            // Get available exits
            const currentNode = await nodeService.getNode(user.currentNode);
            const exits = currentNode.exits || [];
            
            if (exits.length === 0) {
                socket.emit('console response', {
                    type: 'error',
                    message: 'There is nowhere to flee to!'
                });
                return;
            }

            // Pick random exit
            const randomExit = exits[Math.floor(Math.random() * exits.length)];
            
            // Move user to new node
            const oldNode = user.currentNode;
            await nodeService.moveUser(socket.user.userId, randomExit.direction);
            
            // Update node subscriptions
            if (oldNode) {
                stateService.removeUserFromNode(socket.user.userId, oldNode);
                await socketService.unsubscribeFromNodeChat(oldNode);
            }
            stateService.addUserToNode(socket.user.userId, user.currentNode);
            await socketService.subscribeToNodeChat(user.currentNode);

            // Clear combat state and remove mob
            stateService.clearUserCombatState(socket.user.userId);
            mobService.clearUserMob(user._id.toString());

            socket.emit('console response', {
                type: 'combat',
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\nYou successfully flee from combat!`
            });

            publishSystemMessage(oldNode, `${user.avatarName} flees from combat with ${mobInstance.name}!`);
        } else {
            socket.emit('console response', {
                type: 'combat',
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\nYou fail to escape!`
            });
        }

    } catch (error) {
        logger.error('Error handling flee command:', error);
        socket.emit('console response', {
            type: 'error',
            message: 'Error processing flee command'
        });
    }
}

module.exports = {
    handleCommand
}; 