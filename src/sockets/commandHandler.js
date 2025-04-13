const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const userService = require('../services/userService');
const chatService = require('../services/chatService');
const systemMessageService = require('../services/systemMessageService');
const combatService = require('../services/combatService');
const actorService = require('../services/actorService');
const questService = require('../services/questService');
const eventService = require('../services/eventService');
const User = require('../models/User');
const messageService = require('../services/messageService');

const HELP_TEXT = `
Available Commands:
------------------
north|south|east|west.......Move north/south/east/west
ls..........................List all players and NPCs in current location
ls <name>...................View details of player or NPC in current location
chat <actor>................Talk to an NPC in current location
quests......................View your active quests and current hints
fight <mob>.................Engage in combat with a mob
rest........................Rest to restore health (only at rest points)
map.........................Open the world map view
?...........................Display this help message
`.trim();

async function handleCommand(socket, data) {
    try {
        // Add detailed logging for the received command
        logger.info('Command received:', {
            userId: socket.user.userId,
            command: data.command,
            direction: data.direction,
            target: data.target,
            timestamp: new Date().toISOString()
        });

        const user = await userService.getUser(socket.user.userId);
        if (!userService.validateUser(user)) {
            throw new Error('User not found or missing required data');
        }

        // Check if user is in combat
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        
        // If in combat, handle combat moves first
        if (combatState && data.command !== 'help' && data.command !== 'flee' && data.command !== 'get_moves') {
            await combatService.handleCombatCommand(user, data.command);
            return;
        }

        // Check if user is in a story event
        if (stateService.isInStoryEvent(socket.user.userId)) {
            // Handle story event input
            const result = await eventService.processEventInput(
                socket.user.userId,
                data.command
            );
            
            if (result) {
                if (result.error) {
                    socket.emit('console response', {
                        type: 'error',
                        message: result.message
                    });
                } else {
                    // Send the event response first
                    socket.emit('console response', {
                        type: 'event',
                        message: result.message,
                        isEndOfEvent: result.isEnd
                    });
                    
                    // If this event choice initiated combat, make sure the client knows to show combat UI
                    if (result.combatInitiated) {
                        // Small delay to ensure the event end message is processed first
                        setTimeout(() => {
                            // Check if combat state exists and send moves
                            const combatState = stateService.userCombatStates.get(socket.user.userId);
                            if (combatState) {
                                // Get the moves and send them immediately
                                userService.getUserMoves(socket.user.userId).then(moves => {
                                    // Add 'flee' as a special move everyone has
                                    const allMoves = [...moves, {
                                        name: 'flee',
                                        type: 'special',
                                        helpDescription: 'Attempt to escape combat'
                                    }];
                                    
                                    socket.emit('console response', {
                                        type: 'moves',
                                        moves: allMoves
                                    });
                                });
                            }
                        }, 100);
                    }
                    
                    // Check if there's a teleport action to handle
                    if (result.teleportAction) {
                        logger.debug('Teleport action detected in event choice', {
                            userId: socket.user.userId,
                            targetNode: result.teleportAction.targetNode
                        });
                        
                        // Get the target node
                        const targetNode = await nodeService.getNodeByAddress(result.teleportAction.targetNode);
                        
                        if (targetNode) {
                            // Get the user's current node before teleporting
                            const user = await userService.getUser(socket.user.userId);
                            const oldNode = user.currentNode;
                            
                            // Teleport the user to the target node
                            await userService.moveUserToNode(socket.user.userId, 'teleport', targetNode);
                            
                            // Send a teleport notification to the client
                            socket.emit('console response', {
                                type: 'move',
                                message: `You have been teleported to ${targetNode.name}`
                            });
                            
                            // Handle node subscriptions
                            if (oldNode) {
                                await stateService.removeUserFromNodeAndUpdateUsernames(socket.user.userId, oldNode);
                                await socketService.unsubscribeFromNodeChat(oldNode);
                            }
                            await stateService.addUserToNodeAndUpdateUsernames(socket.user.userId, targetNode.address);
                            await socketService.subscribeToNodeChat(targetNode.address);
                        } else {
                            logger.error('Failed to teleport user - target node not found', {
                                userId: socket.user.userId,
                                targetNode: result.teleportAction.targetNode
                            });
                        }
                    }
                }
            }
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
                try {
                    // Check if user is in a story event
                    if (stateService.isInStoryEvent(socket.user.userId)) {
                        socket.emit('console response', {
                            type: 'error',
                            message: 'You cannot move while in an event.'
                        });
                        return;
                    }

                    const oldNode = user.currentNode;
                    
                    // Get user's quest information
                    const userQuestInfo = await questService.getUserQuestInfo(socket.user.userId);
                    logger.debug('User quest info for move command', {
                        userId: socket.user.userId,
                        activeQuestCount: userQuestInfo.activeQuestIds?.length || 0,
                        completedQuestEventCount: userQuestInfo.completedQuestEventIds?.length || 0
                    });
                    
                    // Get the target node first, passing quest information
                    const targetNode = await nodeService.getNodeByDirection(socket.user.userId, data.direction, userQuestInfo);
                    
                    // Then move the user to that node
                    await userService.moveUserToNode(socket.user.userId, data.direction, targetNode);

                    const nodeEventResult = await nodeService.getNodeEvent(socket.user.userId, targetNode.address);
                    
                    const nodeConnectionResult = {
                        success: true,
                        message: `You move ${data.direction} to ${targetNode.name}`,
                        node: targetNode,
                        mobSpawn: nodeEventResult.mobSpawn,
                        storyEvent: nodeEventResult.storyEvent
                    };
                    
                    if (oldNode) {
                        await stateService.removeUserFromNodeAndUpdateUsernames(socket.user.userId, oldNode);
                        await socketService.unsubscribeFromNodeChat(oldNode);
                    }
                    
                    await stateService.addUserToNodeAndUpdateUsernames(socket.user.userId, user.currentNode);
                    await socketService.subscribeToNodeChat(user.currentNode);

                    // Send the move confirmation first
                    socket.emit('console response', {
                        message: nodeConnectionResult.message,
                        type: 'move'
                    });
                    
                    // Check if a story event was triggered
                    const hasStoryEvent = nodeEventResult.storyEvent != null;
                    
                    // Then send the complete node data with event info
                    await handleGetNodeData(socket, {
                        inEvent: hasStoryEvent
                    });
                    
                } catch (error) {
                    // Check if this is a "No exit" error
                    if (error.message.includes('No exit to the')) {
                        socket.emit('console response', {
                            type: 'error',
                            message: error.message
                        });
                    } else {
                        // For other errors, log and send a generic message
                        logger.error('Error processing move command:', error, {
                            userId: socket.user.userId,
                            direction: data.direction
                        });
                        socket.emit('console response', {
                            type: 'error',
                            message: 'Unable to move in that direction.'
                        });
                    }
                }
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
                await handleFightCommand(user, data.target);
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

            case 'get_moves':
                const moves = await userService.getUserMoves(socket.user.userId);
                // Add 'flee' as a special move everyone has
                const allMoves = [...moves, {
                    name: 'flee',
                    type: 'special',
                    helpDescription: 'Attempt to escape combat'
                }];
                socket.emit('console response', {
                    type: 'moves',
                    moves: allMoves
                });
                break;

            case 'event refresh':
                // Check if user is in a story event and send current state
                if (stateService.isInStoryEvent(socket.user.userId)) {
                    const activeEvent = stateService.getActiveEvent(socket.user.userId);
                    if (activeEvent && activeEvent.currentNode) {
                        // Format the current event state for display
                        const eventResponse = await eventService.formatEventResponse(
                            activeEvent.currentNode, 
                            socket.user.userId
                        );

                        // Send the event data to the client
                        socket.emit('console response', {
                            type: 'event',
                            message: eventResponse.message,
                            isEndOfEvent: eventResponse.isEnd
                        });
                    }
                } else {
                    // If not in event, update the UI to normal mode
                    socket.emit('console response', {
                        type: 'info',
                        message: 'Not currently in an event.',
                        inEvent: false
                    });
                }
                break;

            default:
                // Check if this is a numeric input and user is in an event
                if (/^\d+$/.test(data.command) && eventService.isInEvent(socket.user.userId)) {
                    // Handle event choice
                    const result = await eventService.processEventInput(
                        socket.user.userId,
                        data.command
                    );
                    
                    if (result) {
                        if (result.error) {
                            socket.emit('console response', {
                                type: 'error',
                                message: result.message
                            });
                            // Re-display the current event state
                            const activeEvent = stateService.getActiveEvent(socket.user.userId);
                            if (activeEvent && activeEvent.currentNode) {
                                const currentState = await eventService.formatEventResponse(
                                    activeEvent.currentNode,
                                    socket.user.userId
                                );
                                socket.emit('console response', {
                                    type: 'event',
                                    message: currentState.message,
                                    isEndOfEvent: false
                                });
                            }
                        } else {
                            socket.emit('console response', {
                                type: 'event',
                                message: result.message,
                                isEndOfEvent: result.isEnd
                            });
                        }
                    }
                    return;
                }

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
    logger.debug('Starting handleListCommand', {
        userId: user._id.toString(),
        currentNode: user.currentNode,
        hasTarget: !!target
    });

    // Wait a short time for any pending mob spawns to complete
    logger.debug('Checking for mob before delay', {
        userId: user._id.toString(),
        hasMob: stateService.playerMobs.has(user._id.toString()),
        mobDetails: stateService.playerMobs.get(user._id.toString())
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    logger.debug('Checking for mob after delay', {
        userId: user._id.toString(),
        hasMob: stateService.playerMobs.has(user._id.toString()),
        mobDetails: stateService.playerMobs.get(user._id.toString())
    });
    
    const nodeUsers = stateService.nodeUsernames.get(user.currentNode) || [];
    const actors = await actorService.getActorsInLocation(user.currentNode, user._id.toString());
    const mobInstance = stateService.playerMobs.get(user._id.toString());

    logger.debug('Room contents gathered', {
        userId: user._id.toString(),
        userCount: nodeUsers.length,
        actorCount: actors.length,
        hasMob: !!mobInstance,
        mobName: mobInstance?.name,
        mobInstanceId: mobInstance?.instanceId
    });

    if (target) {
        // Check if target is "node" to display the current location description
        if (target.toLowerCase() === 'node') {
            // Get the current node data
            const node = await nodeService.getNodeWithOverrides(user.currentNode, user._id.toString());
            
            if (node) {
                logger.debug('Returning node description', {
                    userId: user._id.toString(),
                    nodeAddress: node.address,
                    nodeName: node.name
                });
                
                socket.emit('console response', {
                    type: 'list',
                    target: 'node',
                    message: `${node.name}\n${'-'.repeat(node.name.length)}\n\n${node.description}`,
                    image: node.image
                });
                return;
            }
        }
        
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
        const targetActor = await actorService.findActorInLocation(target, user.currentNode, user._id.toString());
        
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
        // No target specified, list everything in the room
        let response = '';
        
        if (nodeUsers.length > 0) {
            response += 'Players here:\n';
            response += nodeUsers.map(name => `- ${name}`).join('\n');
        }
        
        if (actors.length > 0) {
            if (response) response += '\n\n';
            response += 'NPCs here:\n';
            response += actors.map(actor => `- ${actor.name}`).join('\n');
        }
        
        if (mobInstance) {
            if (response) response += '\n\n';
            response += 'Enemies here:\n';
            response += `- ${mobInstance.name}`;
        }
        
        if (!response) {
            response = 'There is no one else here.';
        }

        logger.debug('Sending list response', {
            userId: user._id.toString(),
            responseLength: response.length,
            hasUsers: nodeUsers.length > 0,
            hasActors: actors.length > 0,
            hasMob: !!mobInstance,
            response: response
        });
        
        socket.emit('console response', {
            type: 'list',
            message: response,
            users: nodeUsers,
            actors: actors.map(actor => actor.name),
            enemies: mobInstance ? [{name: mobInstance.name, level: mobInstance.level}] : [],
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

    // First check if user is in an active event
    if (eventService.isInEvent(user._id.toString())) {
        const result = await eventService.processEventInput(
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
                // Get the actor name from the active event
                const activeEvent = stateService.getActiveEvent(user._id.toString());
                const actor = await actorService.findActorById(activeEvent.actorId);
                
                socket.emit('console response', {
                    type: 'event',
                    message: `${actor.name} says: "${result.message}"`,
                    isEndOfEvent: result.isEnd,
                    image: actor.image
                });

                // If this is the end of the event, clear the state
                if (result.isEnd) {
                    stateService.clearActiveEvent(user._id.toString());
                }
            }
        }
        return;
    }

    // If not in an event, try to find an actor in the current location
    const actor = await actorService.findActorInLocation(target, user.currentNode, user._id.toString());
    
    if (actor) {
        // Check if this actor is part of an active quest's chat event
        // This needs to happen BEFORE trying to start an event
        const questResult = await questService.handleQuestProgression(
            user,
            actor._id.toString(),
            [], // No completion events
            null // No quest to activate
        );

        logger.debug('Quest progression check for chat command:', {
            userId: user._id.toString(),
            actorId: actor._id.toString(),
            actorName: actor.name,
            hasQuestResult: !!questResult,
            questResultType: questResult?.type,
            isQuestComplete: questResult?.isComplete,
            questTitle: questResult?.questTitle
        });

        // If quest progression happened, return early
        if (questResult) {
            // Don't display the message again, as questService.handleQuestProgression 
            // already sends the message to the user
            logger.debug('Quest progression handled by questService:', {
                userId: user._id.toString(),
                actorId: actor._id.toString(),
                actorName: actor.name,
                questResult: JSON.stringify(questResult)
            });
            return;
        }

        // Try to start an event for this actor
        const result = await eventService.handleActorChat(user, actor);
        if (result) {
            socket.emit('console response', {
                type: 'event',
                message: result.message,
                isEndOfEvent: result.isEnd,
                image: actor.image
            });
            return;
        }

        // If no event or event failed to start, fall back to regular chat
        const stateKey = `${socket.user.userId}-${actor._id}`;
        let currentIndex = stateService.actorChatStates.get(stateKey) || 0;

        const chatResult = await actorService.getActorChatMessage(actor, stateKey, currentIndex);
        if (!chatResult || !chatResult.message) {
            socket.emit('console response', {
                type: 'chat',
                message: `${actor.name} has nothing to say.`,
                image: actor.image
            });
            return;
        }

        // Update the state with the next index
        stateService.actorChatStates.set(stateKey, chatResult.nextIndex);

        socket.emit('console response', {
            type: 'chat',
            message: `${actor.name} says: "${chatResult.message}"`,
            image: chatResult.image || actor.image
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
                message: `${mobInstance.name} has nothing to say.`,
                image: mobInstance.image
            });
            return;
        }

        const message = sortedMessages[currentIndex];
        currentIndex = (currentIndex + 1) % sortedMessages.length;
        stateService.actorChatStates.set(stateKey, currentIndex);

        socket.emit('console response', {
            type: 'chat',
            message: `${mobInstance.name} says: "${message.message}"`,
            image: mobInstance.image
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
        
        // Send both the success message and the playerStatus update
        socket.emit('console response', {
            type: 'success',
            message: `You rest and recover your health. (HP restored to ${result.healed})`
        });
        
        // Send the playerStatus message to update the health bar
        socket.emit('console response', {
            type: 'playerStatus',
            message: `HP: ${result.healed}/${result.healed} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
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

async function handleFightCommand(user, target) {
    if (!target) {
        messageService.sendErrorMessage(user._id.toString(), 'Usage: fight <mob name>');
        return;
    }

    if (stateService.userCombatStates.get(user._id.toString())) {
        messageService.sendErrorMessage(user._id.toString(), 'You are already in combat!');
        return;
    }

    // Check if user has enough energy
    if (user.stats.currentEnergy < 1) {
        messageService.sendErrorMessage(user._id.toString(), "You're too tired to pick a fight right now.  Get a good night's sleep.");
        return;
    }

    const mobInstance = stateService.playerMobs.get(user._id.toString());
    if (!mobInstance || mobInstance.name.toLowerCase() !== target.toLowerCase()) {
        messageService.sendErrorMessage(user._id.toString(), `No mob named "${target}" found in current location.`);
        return;
    }

    // Deduct energy before initiating combat
    user.stats.currentEnergy -= 1;
    await User.findByIdAndUpdate(user._id, {
        'stats.currentEnergy': user.stats.currentEnergy
    });

    // Update combat state to include health values
    stateService.userCombatStates.set(user._id.toString(), {
        mobInstanceId: mobInstance.instanceId,
        mobName: mobInstance.name
    });

    // Get the socket first to ensure it exists
    const socket = stateService.getClient(user._id.toString());
    if (!socket) {
        logger.error('No socket found for user in handleFightCommand', {
            userId: user._id.toString()
        });
        return;
    }

    // Send all messages using the verified socket
    socket.emit('console response', {
        type: 'combat',
        message: `You engage in combat with ${mobInstance.name}!`,
        image: mobInstance.image
    });
    
    // Send status update after energy deduction
    socket.emit('console response', {
        type: 'playerStatus',
        message: `HP: ${user.stats.currentHitpoints}/${user.stats.hitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
    });

    // Publish system message to the node
    systemMessageService.publishSystemMessage(user.currentNode, {
        message: `${user.avatarName} engages in combat with ${mobInstance.name}!`,
        type: 'system'
    });

    // Get and send the moves list immediately after entering combat
    const moves = await userService.getUserMoves(user._id.toString());
    // Add 'flee' as a special move everyone has
    const allMoves = [...moves, {
        name: 'flee',
        type: 'special',
        helpDescription: 'Attempt to escape combat'
    }];
    socket.emit('console response', {
        type: 'moves',
        moves: allMoves
    });
}

/**
 * Handles WebSocket requests for node data
 * Combines data from multiple services into a single response
 */
async function handleGetNodeData(socket, data = {}) {
    try {
        const userId = socket.user.userId;
        let node;
        
        // Get node data - either specified address or user's current location
        if (data.address) {
            // Get specific node by address
            node = await nodeService.getNodeByAddress(data.address);
            if (!node) {
                throw new Error('Node not found');
            }
        } else {
            // Get user's current location from the user service
            const user = await userService.getUser(userId);
            if (!user || !user.currentNode) {
                throw new Error('User location not found');
            }
            
            // Get node with any quest-specific overrides
            node = await nodeService.getNodeWithOverrides(user.currentNode, userId);
        }
        
        // Get the user's level for enemy level comparison
        const user = await userService.getUser(userId);
        const userLevel = user.stats.level;
        
        // Get user's quest information to filter exits
        const userQuestInfo = await questService.getUserQuestInfo(userId);
        
        // Filter exits based on quest requirements if user has quests
        if (userQuestInfo) {
            node.exits = nodeService.filterAccessibleExits(node.exits, userQuestInfo);
        }
        
        // Check for enemies in this node using the mob service
        const mobInstance = stateService.playerMobs.get(userId);
        const enemiesData = [];
        
        if (mobInstance) {
            enemiesData.push({
                name: mobInstance.name,
                level: mobInstance.level
            });
        }

        // Get actors in the location from actor service
        const actors = await actorService.getActorsInLocation(node.address, userId);
        
        // Get users in the node from state service
        const nodeUsers = stateService.nodeUsernames.get(node.address) || [];
        
        // Get all node names for exits from public nodes data
        const allNodes = await nodeService.getAllPublicNodes();
        const nodeMap = new Map(allNodes.map(n => [n.address, n.name]));
        
        // Enhance exits with target node names
        const enhancedExits = (node.exits || []).map(exit => ({
            ...exit,
            targetName: nodeMap.get(exit.target) || 'Unknown'
        }));
        
        // Check if user is in an event
        const inEvent = data.inEvent || stateService.isInStoryEvent(userId);
        
        // Add event data if user is in an event
        let eventMessage = null;
        let eventChoices = null;
        if (inEvent) {
            const activeEvent = stateService.getActiveEvent(userId);
            if (activeEvent && activeEvent.currentNode) {
                const eventResponse = await eventService.formatEventResponse(
                    activeEvent.currentNode,
                    userId
                );
                
                // Extract only the narrative part before "Responses:"
                const fullMessage = eventResponse.message;
                const responsesIndex = fullMessage.indexOf("\n\nResponses:");
                eventMessage = responsesIndex !== -1 
                    ? fullMessage.substring(0, responsesIndex) 
                    : fullMessage;
                    
                // Extract just the text field from each choice
                eventChoices = (activeEvent.currentNode.choices || []).map(choice => choice.text);
            }
        }
        
        // Combine everything into a single response
        const nodeData = {
            // Basic node info
            address: node.address,
            name: node.name,
            description: node.description,
            image: node.image,
            isRestPoint: node.isRestPoint,
            
            // Enhanced exits with target names
            exits: enhancedExits,
            
            // Users present in node
            users: nodeUsers,
            
            // Actors present
            actors: actors.map(actor => ({
                id: actor._id,
                name: actor.name
            })),
            
            // Enemies present in node
            enemies: enemiesData,
            
            // User level for determining threat levels
            playerLevel: userLevel,
            
            // Flag indicating if the user is in an event
            inEvent: inEvent,
            
            // Event data (if in an event)
            eventMessage: eventMessage,
            eventChoices: eventChoices,

            // Combat state
            inCombat: stateService.isUserInCombat(userId)
        };
        
        // If user is in combat, request their moves list
        if (stateService.isUserInCombat(userId)) {
            const moves = await userService.getUserMoves(userId);
            // Add 'flee' as a special move everyone has
            const allMoves = [...moves, {
                name: 'flee',
                type: 'special',
                helpDescription: 'Attempt to escape combat'
            }];
            socket.emit('console response', {
                type: 'moves',
                moves: allMoves
            });
        }
        
        // Emit the combined data
        socket.emit('node data', nodeData);
        
    } catch (error) {
        logger.error('Error getting node data:', error);
        socket.emit('error', { message: error.message });
    }
}

module.exports = {
    handleCommand,
    handleGetNodeData
}; 