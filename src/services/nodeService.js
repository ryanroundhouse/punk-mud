const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const stateService = require('./stateService');
const mobService = require('./mobService');
const questService = require('./questService');
const { publishSystemMessage } = require('./chatService');
const Event = require('../models/Event');
const eventService = require('./eventService');
const messageService = require('./messageService');

async function moveUser(userId, direction) {
    const user = await User.findById(userId);
    if (!user || !user.currentNode) {
        throw new Error('User not found or missing location');
    }

    const currentNode = await Node.findOne({ address: user.currentNode });
    if (!currentNode) {
        throw new Error('Current location not found');
    }

    const exit = currentNode.exits.find(e => e.direction.toLowerCase() === direction.toLowerCase());
    if (!exit) {
        throw new Error(`No exit to the ${direction}`);
    }

    // Get the target node with any quest overrides
    const targetNode = await getNodeWithOverrides(exit.target, userId);
    if (!targetNode) {
        throw new Error('Target location not found');
    }

    logger.debug('Moving user to node with potential overrides:', {
        userId,
        fromNode: user.currentNode,
        toNode: targetNode.address,
        hasActorOverrides: !!targetNode.actors,
        actorOverrideCount: targetNode.actors?.length || 0,
        actorIds: targetNode.actors?.map(a => a.actorId) || []
    });

    const oldNode = user.currentNode;
    user.currentNode = targetNode.address;
    await user.save();

    // Handle node client management
    stateService.removeUserFromNode(userId, oldNode);
    stateService.addUserToNode(userId, targetNode.address);

    // Send movement messages
    await publishSystemMessage(oldNode, `${user.avatarName} has left.`);
    await publishSystemMessage(
        targetNode.address,
        `${user.avatarName} has arrived.`,
        `You have entered ${targetNode.name}.`,
        userId
    );

    // Clear any existing mob and check for new spawn
    mobService.clearUserMob(userId);
    const result = await handlePlayerNodeConnection(userId, targetNode.address);
    
    return {
        success: true,
        message: `You move ${direction} to ${targetNode.name}`,
        node: targetNode,
        mobSpawn: result.mobSpawn,
        storyEvent: result.storyEvent
    };
}

async function handlePlayerNodeConnection(userId, nodeAddress) {
    logger.debug('Starting handlePlayerNodeConnection', {
        userId,
        nodeAddress,
        timestamp: new Date().toISOString()
    });

    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    // Use getNodeWithOverrides instead of direct Node.findOne
    const node = await getNodeWithOverrides(nodeAddress, userId);
    if (!node) {
        throw new Error('Node not found');
    }

    logger.debug('handlePlayerNodeConnection called', {
        userId,
        nodeAddress,
        inCombat: stateService.isUserInCombat(userId),
        nodeEvents: node.events?.length || 0,
        hasActors: !!node.actors,
        actorCount: node.actors?.length || 0,
        timestamp: new Date().toISOString()
    });

    // Only process events if not in combat
    if (!stateService.isUserInCombat(userId)) {
        logger.debug('Clearing previous mob before spawn check', {
            userId,
            hadPreviousMob: stateService.playerMobs.has(userId),
            timestamp: new Date().toISOString()
        });
        
        mobService.clearUserMob(userId);
        
        // Check for quest-specific node event overrides
        const questNodeEvents = await questService.getQuestNodeEventOverrides(userId, nodeAddress);
        
        logger.debug('Quest node event override check result', {
            userId,
            nodeAddress,
            hasQuestOverrides: !!questNodeEvents,
            questEventCount: questNodeEvents?.length || 0,
            originalNodeEventCount: node.events?.length || 0,
            timestamp: new Date().toISOString()
        });
        
        let result = { mobSpawn: null, storyEvent: null };

        // Determine which events to use
        const eventsToUse = questNodeEvents && questNodeEvents.length > 0 ? 
            questNodeEvents : 
            node.events || [];

        // Calculate total spawn chance
        const totalChance = eventsToUse.reduce((sum, event) => sum + event.chance, 0);
        
        logger.debug('Event spawn calculation:', {
            userId,
            nodeAddress,
            totalChance,
            eventCount: eventsToUse.length,
            events: eventsToUse.map(e => ({
                mobId: e.mobId,
                eventId: e.eventId,
                chance: e.chance
            })),
            timestamp: new Date().toISOString()
        });
        
        if (totalChance === 100) {
            // When total chance is 100%, ensure one event triggers
            const roll = Math.random() * 100;
            let chanceSum = 0;
            
            logger.debug('Processing 100% total chance events:', {
                userId,
                roll,
                totalChance,
                timestamp: new Date().toISOString()
            });
            
            // Find which event should trigger based on the roll
            for (const event of eventsToUse) {
                chanceSum += event.chance;
                if (roll < chanceSum) {
                    if (event.mobId) {
                        // Handle mob spawn
                        logger.debug('Attempting to spawn mob:', {
                            userId,
                            mobEventId: event.mobId,
                            roll,
                            chanceSum,
                            timestamp: new Date().toISOString()
                        });
                        
                        const mobInstance = await mobService.loadMobFromEvent(event);
                        logger.debug('Mob load result:', {
                            userId,
                            mobEventId: event.mobId,
                            mobLoaded: !!mobInstance,
                            mobName: mobInstance?.name,
                            timestamp: new Date().toISOString()
                        });
                        if (mobInstance) {
                            logger.debug('Setting mob in state service', {
                                userId,
                                mobInstanceId: mobInstance.instanceId,
                                mobName: mobInstance.name,
                                timestamp: new Date().toISOString()
                            });
                            stateService.playerMobs.set(userId, mobInstance);
                            result.mobSpawn = mobInstance;
                            await publishSystemMessage(
                                nodeAddress,
                                `A ${mobInstance.name} appears!`,
                                `A ${mobInstance.name} appears!`,
                                userId
                            );
                        }
                    } else if (event.eventId) {
                        // Handle story event
                        const storyEvent = await Event.findById(event.eventId);
                        if (storyEvent) {
                            // Check if user has enough energy for this story event
                            const hasEnoughEnergy = storyEvent.requiresEnergy === false || user.stats.currentEnergy >= 1;
                            
                            if (!hasEnoughEnergy) {
                                logger.debug('User has insufficient energy for story event that requires energy', {
                                    userId,
                                    currentEnergy: user.stats.currentEnergy,
                                    eventId: storyEvent._id,
                                    eventTitle: storyEvent.title,
                                    requiresEnergy: storyEvent.requiresEnergy
                                });

                                // Get the socket to send the tired message
                                const socket = stateService.getClient(userId);
                                if (socket) {
                                    socket.emit('console response', {
                                        type: 'info',
                                        message: "You notice something interesting might happen, but you're too tired to engage fully right now. Get some sleep."
                                    });
                                }
                            } else {
                                logger.debug(`Starting story event ${storyEvent._id} (${storyEvent.title}) for user ${userId}`);
                                
                                // Deduct energy if the event requires it
                                if (storyEvent.requiresEnergy === true) {
                                    // Deduct energy
                                    user.stats.currentEnergy -= 1;
                                    await User.findByIdAndUpdate(userId, {
                                        'stats.currentEnergy': user.stats.currentEnergy
                                    });
                                    
                                    // Send status update after energy deduction
                                    messageService.sendPlayerStatusMessage(
                                        userId, 
                                        `HP: ${user.stats.currentHitpoints}/${user.stats.hitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
                                    );
                                    
                                    logger.debug('Deducted energy for story event:', {
                                        userId,
                                        eventId: storyEvent._id,
                                        newEnergyLevel: user.stats.currentEnergy
                                    });
                                }

                                // Set the story event as active
                                stateService.setActiveEvent(
                                    userId,
                                    storyEvent._id,
                                    storyEvent.rootNode,
                                    null, // No actor for story events
                                    true // Mark as story event
                                );
                                result.storyEvent = storyEvent;

                                // Get the socket for this user to send initial prompt
                                const socket = stateService.getClient(userId);
                                if (socket) {
                                    // Format and send initial story prompt
                                    const formattedResponse = await eventService.formatEventResponse(storyEvent.rootNode, userId);
                                    socket.emit('console response', {
                                        type: 'event',
                                        message: formattedResponse.message,
                                        isEndOfEvent: formattedResponse.isEnd
                                    });
                                }
                            }
                        }
                    }
                    break;
                }
            }
        } else {
            // For non-100% total chance, check each event individually
            const eligibleEvents = eventsToUse.filter(event => {
                const roll = Math.random() * 100;
                logger.debug(`Event ${event.mobId || event.eventId} - Rolled ${roll} against chance ${event.chance}`);
                return roll < event.chance;
            });
            
            if (eligibleEvents.length > 0) {
                // Randomly select one event from eligible events
                const selectedEvent = eligibleEvents[Math.floor(Math.random() * eligibleEvents.length)];
                
                if (selectedEvent.mobId) {
                    // Handle mob spawn
                    const mobInstance = await mobService.loadMobFromEvent(selectedEvent);
                    if (mobInstance) {
                        logger.debug(`Spawning mob instance ${mobInstance.instanceId} (${mobInstance.name}) for user ${userId}`);
                        stateService.playerMobs.set(userId, mobInstance);
                        result.mobSpawn = mobInstance;
                        await publishSystemMessage(
                            nodeAddress,
                            `A ${mobInstance.name} appears!`,
                            `A ${mobInstance.name} appears!`,
                            userId
                        );
                    }
                } else if (selectedEvent.eventId) {
                    // Handle story event
                    const storyEvent = await Event.findById(selectedEvent.eventId);
                    if (storyEvent) {
                        // Check if user has enough energy for this story event
                        const hasEnoughEnergy = storyEvent.requiresEnergy === false || user.stats.currentEnergy >= 1;
                        
                        if (!hasEnoughEnergy) {
                            logger.debug('User has insufficient energy for story event that requires energy', {
                                userId,
                                currentEnergy: user.stats.currentEnergy,
                                eventId: storyEvent._id,
                                eventTitle: storyEvent.title,
                                requiresEnergy: storyEvent.requiresEnergy
                            });

                            // Get the socket to send the tired message
                            const socket = stateService.getClient(userId);
                            if (socket) {
                                socket.emit('console response', {
                                    type: 'info',
                                    message: "You notice something interesting might happen, but you're too tired to engage fully right now. Get some sleep."
                                });
                            }
                        } else {
                            logger.debug(`Starting story event ${storyEvent._id} (${storyEvent.title}) for user ${userId}`);
                            
                            // Deduct energy if the event requires it
                            if (storyEvent.requiresEnergy === true) {
                                // Deduct energy
                                user.stats.currentEnergy -= 1;
                                await User.findByIdAndUpdate(userId, {
                                    'stats.currentEnergy': user.stats.currentEnergy
                                });
                                
                                // Send status update after energy deduction
                                messageService.sendPlayerStatusMessage(
                                    userId, 
                                    `HP: ${user.stats.currentHitpoints}/${user.stats.hitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
                                );
                                
                                logger.debug('Deducted energy for story event:', {
                                    userId,
                                    eventId: storyEvent._id,
                                    newEnergyLevel: user.stats.currentEnergy
                                });
                            }

                            // Set the story event as active
                            stateService.setActiveEvent(
                                userId,
                                storyEvent._id,
                                storyEvent.rootNode,
                                null, // No actor for story events
                                true // Mark as story event
                            );
                            result.storyEvent = storyEvent;

                            // Get the socket for this user to send initial prompt
                            const socket = stateService.getClient(userId);
                            if (socket) {
                                // Format and send initial story prompt
                                const formattedResponse = await eventService.formatEventResponse(storyEvent.rootNode, userId);
                                socket.emit('console response', {
                                    type: 'event',
                                    message: formattedResponse.message,
                                    isEndOfEvent: formattedResponse.isEnd
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return result;
    } else {
        logger.debug('Skipping event processing because user is in combat', {
            userId,
            nodeAddress
        });
    }
    
    return { mobSpawn: null, storyEvent: null };
}

async function getNode(address) {
    const node = await Node.findOne({ address });
    if (!node) {
        throw new Error('Node not found');
    }
    
    // Add debug logging to see what's being returned
    logger.debug('getNode returning node data:', {
        address,
        hasEvents: !!node.events,
        eventCount: node.events?.length || 0
    });
    
    return node;
}

// Add a new method to get node with quest overrides if applicable
async function getNodeWithOverrides(address, userId) {
    const node = await Node.findOne({ address });
    if (!node) {
        throw new Error('Node not found');
    }
    
    // Check for quest-specific node event overrides
    const questNodeEvents = await questService.getQuestNodeEventOverrides(userId, address);
    
    // Check for quest-specific node actor overrides
    const questNodeActors = await questService.getQuestNodeActorOverrides(userId, address);
    
    logger.debug('Quest node override check results:', {
        userId,
        nodeAddress: address,
        originalActors: node.actors?.length || 0,
        questActorOverrides: questNodeActors?.length || 0,
        questActorOverrideDetails: questNodeActors?.map(actor => ({
            id: actor.actorId,
            type: actor.type,
            overrideType: actor.overrideType
        }))
    });

    // Create a copy of the node to avoid modifying the database object
    const nodeData = node.toObject();
    
    // If there are quest overrides, include them in the node data
    if (questNodeEvents && questNodeEvents.length > 0) {
        logger.debug('Including quest event overrides in node data:', {
            address,
            userId,
            originalEvents: nodeData.events?.length || 0,
            questEventCount: questNodeEvents.length
        });
        
        // Add the quest events to the node data
        nodeData.events = questNodeEvents;
    }

    // If there are actor overrides, include them in the node data
    if (questNodeActors && questNodeActors.length > 0) {
        logger.debug('Applying quest actor overrides to node data:', {
            address,
            userId,
            originalActors: nodeData.actors?.length || 0,
            questActorCount: questNodeActors.length,
            actorOverrideDetails: questNodeActors.map(actor => ({
                id: actor.actorId,
                type: actor.type,
                overrideType: actor.overrideType
            }))
        });
        
        // Add the quest actors to the node data
        nodeData.actors = questNodeActors;
    }

    logger.debug('Final node data after overrides:', {
        address,
        userId,
        hasActors: !!nodeData.actors,
        actorCount: nodeData.actors?.length || 0,
        actorIds: nodeData.actors?.map(a => a.actorId) || []
    });
    
    return nodeData;
}

async function isRestPoint(nodeAddress) {
    const node = await Node.findOne({ address: nodeAddress });
    if (!node) {
        throw new Error('Node not found');
    }
    return node.isRestPoint;
}

module.exports = {
    moveUser,
    handlePlayerNodeConnection,
    getNode,
    getNodeWithOverrides,
    isRestPoint
}; 