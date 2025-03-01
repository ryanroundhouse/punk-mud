const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const stateService = require('./stateService');
const mobService = require('./mobService');
const questService = require('./questService');
const { publishSystemMessage } = require('./chatService');
const Event = require('../models/Event');
const eventService = require('./eventService');

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

    const targetNode = await Node.findOne({ address: exit.target });
    if (!targetNode) {
        throw new Error('Target location not found');
    }

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
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const node = await Node.findOne({ address: nodeAddress });
    if (!node) {
        throw new Error('Node not found');
    }

    logger.debug('handlePlayerNodeConnection called', {
        userId,
        nodeAddress,
        inCombat: stateService.isUserInCombat(userId),
        nodeEvents: node.events?.length || 0
    });

    // Only process events if not in combat
    if (!stateService.isUserInCombat(userId)) {
        mobService.clearUserMob(userId);
        
        // Check for quest-specific node event overrides
        const questNodeEvents = await questService.getQuestNodeEventOverrides(userId, nodeAddress);
        
        logger.debug('Quest node event override check result', {
            userId,
            nodeAddress,
            hasQuestOverrides: !!questNodeEvents,
            questEventCount: questNodeEvents?.length || 0,
            originalNodeEventCount: node.events?.length || 0
        });
        
        let result = { mobSpawn: null, storyEvent: null };

        // Determine which events to use
        const eventsToUse = questNodeEvents && questNodeEvents.length > 0 ? 
            questNodeEvents : 
            node.events || [];

        // Calculate total spawn chance
        const totalChance = eventsToUse.reduce((sum, event) => sum + event.chance, 0);
        
        if (totalChance === 100) {
            // When total chance is 100%, ensure one event triggers
            const roll = Math.random() * 100;
            let chanceSum = 0;
            
            // Find which event should trigger based on the roll
            for (const event of eventsToUse) {
                chanceSum += event.chance;
                if (roll < chanceSum) {
                    if (event.mobId) {
                        // Handle mob spawn
                        const mobInstance = await mobService.loadMobFromEvent(event);
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
                    } else if (event.eventId) {
                        // Handle story event
                        const storyEvent = await Event.findById(event.eventId);
                        if (storyEvent) {
                            logger.debug(`Starting story event ${storyEvent._id} (${storyEvent.title}) for user ${userId}`);
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
                        logger.debug(`Starting story event ${storyEvent._id} (${storyEvent.title}) for user ${userId}`);
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