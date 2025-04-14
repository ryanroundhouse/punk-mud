const logger = require('../config/logger');
const systemMessageService = require('./systemMessageService');

class NodeService {
    constructor(deps = {}) {
        // Inject dependencies or use defaults (for backward compatibility)
        this.Node = deps.Node || require('../models/Node');
        this.User = deps.User || require('../models/User');
        this.Event = deps.Event || require('../models/Event');
        this.questService = deps.questService || require('./questService');
        this.stateService = deps.stateService || require('./stateService');
        this.mobService = deps.mobService || require('./mobService');
        this.eventService = deps.eventService || require('./eventService');
        this.messageService = deps.messageService || require('./messageService');
        this.chatService = deps.chatService || require('./chatService');
        this.systemMessageService = deps.systemMessageService || systemMessageService;
        
        // For testing to override Math.random
        this.randomGenerator = deps.randomGenerator || Math.random;
    }

    // Get a node by direction without moving the user
    async getNodeByDirection(userId, direction, userQuestInfo) {
        const user = await this.User.findById(userId);
        if (!user || !user.currentNode) {
            throw new Error('User not found or missing location');
        }

        const currentNode = await this.Node.findOne({ address: user.currentNode });
        if (!currentNode) {
            throw new Error('Current location not found');
        }

        const exit = currentNode.exits.find(e => e.direction.toLowerCase() === direction.toLowerCase());
        if (!exit) {
            throw new Error(`No exit to the ${direction}`);
        }

        // Check if the exit is accessible based on quest requirements
        if (!this.isExitAccessible(exit, userQuestInfo)) {
            throw new Error(`No exit to the ${direction}`);
        }

        // Get the target node with any quest overrides
        const targetNode = await this.getNodeWithOverrides(exit.target, userId);
        if (!targetNode) {
            throw new Error('Target location not found');
        }

        return targetNode;
    }

    // Add a new method to get node with quest overrides if applicable
    async getNodeWithOverrides(address, userId) {
        const node = await this.Node.findOne({ address });
        if (!node) {
            throw new Error('Node not found');
        }
        
        // Check for quest-specific node event overrides
        const questNodeEvents = await this.questService.getQuestNodeEventOverrides(userId, address);
        
        // Check for quest-specific node actor overrides
        const questNodeActors = await this.questService.getQuestNodeActorOverrides(userId, address);
        
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

    async isRestPoint(nodeAddress) {
        const node = await this.Node.findOne({ address: nodeAddress });
        if (!node) {
            throw new Error('Node not found');
        }
        return node.isRestPoint;
    }

    // Function to get a node by its address
    async getNodeByAddress(address) {
        try {
            const node = await this.Node.findOne({ address });
            if (!node) {
                logger.error('Node not found with address:', address);
                return null;
            }
            return node;
        } catch (error) {
            logger.error('Error getting node by address:', error, { address });
            return null;
        }
    }

    // Extracted helper method to select an event based on chance - makes testing easier
    selectEventByChance(events, rollValue) {
        let chanceSum = 0;
        
        for (const event of events) {
            chanceSum += event.chance;
            if (rollValue < chanceSum) {
                return event;
            }
        }
        
        return null;
    }

    // Extracted method to handle energy deduction for story events
    async handleStoryEventEnergy(userId, storyEvent) {
        if (!storyEvent.requiresEnergy) {
            return true;
        }
        
        const user = await this.User.findById(userId);
        
        // Check if user has enough energy
        if (user.stats.currentEnergy < 1) {
            logger.debug('User has insufficient energy for story event that requires energy', {
                userId,
                currentEnergy: user.stats.currentEnergy,
                eventId: storyEvent._id,
                eventTitle: storyEvent.title,
                requiresEnergy: storyEvent.requiresEnergy
            });

            // Get the socket to send the tired message
            const socket = this.stateService.getClient(userId);
            if (socket) {
                socket.emit('console response', {
                    type: 'info',
                    message: "You notice something interesting might happen, but you're too tired to engage fully right now. Get some sleep."
                });
            }
            
            return false;
        }
        
        // Deduct energy if the event requires it
        user.stats.currentEnergy -= 1;
        await this.User.findByIdAndUpdate(userId, {
            'stats.currentEnergy': user.stats.currentEnergy
        });
        
        // Send status update after energy deduction
        this.messageService.sendPlayerStatusMessage(
            userId, 
            `HP: ${user.stats.currentHitpoints}/${user.stats.hitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
        );
        
        logger.debug('Deducted energy for story event:', {
            userId,
            eventId: storyEvent._id,
            newEnergyLevel: user.stats.currentEnergy
        });
        
        return true;
    }

    async getNodeEvent(userId, nodeAddress) {
        logger.debug('Starting handlePlayerNodeConnection', {
            userId,
            nodeAddress,
            timestamp: new Date().toISOString()
        });

        // Use getNodeWithOverrides from nodeService
        const node = await this.getNodeWithOverrides(nodeAddress, userId);
        if (!node) {
            throw new Error('Node not found');
        }

        logger.debug('handlePlayerNodeConnection called', {
            userId,
            nodeAddress,
            inCombat: this.stateService.isUserInCombat(userId),
            nodeEvents: node.events?.length || 0,
            hasActors: !!node.actors,
            actorCount: node.actors?.length || 0,
            timestamp: new Date().toISOString()
        });

        // Initialize result
        let result = { mobSpawn: null, storyEvent: null };

        // Only process events if not in combat
        if (!this.stateService.isUserInCombat(userId)) {
            logger.debug('Clearing previous mob before spawn check', {
                userId,
                hadPreviousMob: this.stateService.playerMobs.has(userId),
                timestamp: new Date().toISOString()
            });
            
            this.mobService.clearUserMob(userId);
            
            // Check for quest-specific node event overrides
            const questNodeEvents = await this.questService.getQuestNodeEventOverrides(userId, nodeAddress);
            
            logger.debug('Quest node event override check result', {
                userId,
                nodeAddress,
                hasQuestOverrides: !!questNodeEvents,
                questEventCount: questNodeEvents?.length || 0,
                originalNodeEventCount: node.events?.length || 0,
                timestamp: new Date().toISOString()
            });
            
            // Determine which events to use
            const eventsToUse = questNodeEvents && questNodeEvents.length > 0 ? 
                questNodeEvents : 
                node.events || [];
            
            // Skip if no events are available
            if (eventsToUse.length === 0) {
                return result;
            }
            
            // Always treat as 100% total chance - select one event based on weighted probability
            const roll = this.randomGenerator() * 100;
            
            logger.debug('Processing events with weighted probability:', {
                userId,
                roll,
                eventCount: eventsToUse.length,
                timestamp: new Date().toISOString()
            });
            
            // Find which event should trigger based on the roll
            const selectedEvent = this.selectEventByChance(eventsToUse, roll);
            
            if (selectedEvent) {
                if (selectedEvent.mobId) {
                    // Handle mob spawn
                    logger.debug('Attempting to spawn mob:', {
                        userId,
                        mobEventId: selectedEvent.mobId,
                        roll,
                        timestamp: new Date().toISOString()
                    });
                    
                    const mobInstance = await this.mobService.loadMobFromEvent(selectedEvent);
                    logger.debug('Mob load result:', {
                        userId,
                        mobEventId: selectedEvent.mobId,
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
                        this.stateService.playerMobs.set(userId, mobInstance);
                        result.mobSpawn = mobInstance;
                    }
                } else if (selectedEvent.eventId) {
                    // Handle story event
                    const storyEvent = await this.Event.findById(selectedEvent.eventId);
                    if (storyEvent) {
                        // Check if user has enough energy and handle deduction
                        const hasEnoughEnergy = await this.handleStoryEventEnergy(userId, storyEvent);
                        
                        if (hasEnoughEnergy) {
                            logger.debug(`Starting story event ${storyEvent._id} (${storyEvent.title}) for user ${userId}`);
                            
                            // Set the story event as active
                            this.stateService.setActiveEvent(
                                userId,
                                storyEvent._id,
                                storyEvent.rootNode,
                                null, // No actor for story events
                                true // Mark as story event
                            );
                            result.storyEvent = storyEvent;

                            // Get the user data for the system message
                            const user = await this.User.findById(userId);
                            
                            if (user) {
                                // Publish event system message for the story event
                                await this.systemMessageService.publishEventSystemMessage(
                                    nodeAddress,
                                    {
                                        message: `${user.avatarName} has encountered something interesting.`
                                    },
                                    user,
                                    'environment', // Use 'environment' as the actor for story events
                                    storyEvent.title
                                );
                            }

                            // Get the socket for this user to send initial prompt
                            const socket = this.stateService.getClient(userId);
                            if (socket) {
                                // Format and send initial story prompt
                                const formattedResponse = await this.eventService.formatEventResponse(storyEvent.rootNode, userId);
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
        } else {
            logger.debug('Skipping event processing because user is in combat', {
                userId,
                nodeAddress
            });
        }
        
        return result;
    }

    /**
     * Get all publicly visible nodes (for exits)
     */
    async getAllPublicNodes() {
        try {
            // Only fetch id, address, name - we don't need the complete node data
            const nodes = await this.Node.find({}, 'address name');
            return nodes;
        } catch (error) {
            logger.error('Error getting public nodes:', error);
            return [];
        }
    }

    // Centralized method to check if an exit is accessible based on quest requirements
    isExitAccessible(exit, userQuestInfo) {
        logger.debug('Checking exit accessibility', {
            exitDetails: {
                direction: exit.direction,
                requiredQuestId: exit.requiredQuestId,
                requiredQuestEventId: exit.requiredQuestEventId
            },
            userQuestInfoStructure: {
                hasQuests: !!userQuestInfo?.quests,
                questCount: userQuestInfo?.quests?.length || 0,
                quests: userQuestInfo?.quests?.map(q => ({
                    questId: q.questId,
                    currentEventId: q.currentEventId,
                    completedEventCount: q.completedEventIds?.length || 0
                }))
            }
        });

        // Check quest requirement
        if (exit.requiredQuestId) {
            const hasRequiredQuest = userQuestInfo.activeQuestIds && 
                userQuestInfo.activeQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
            
            const hasCompletedQuest = userQuestInfo.completedQuestIds && 
                userQuestInfo.completedQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
            
            if (!hasRequiredQuest && !hasCompletedQuest) {
                logger.debug('Exit not accessible - missing required quest', {
                    direction: exit.direction,
                    requiredQuestId: exit.requiredQuestId
                });
                return false;
            }
        }
        
        // Check quest event requirement
        if (exit.requiredQuestEventId) {
            logger.debug('Checking quest event requirement', {
                requiredEventId: exit.requiredQuestEventId,
                questDetails: userQuestInfo.quests?.map(q => ({
                    questId: q.questId,
                    currentEventId: q.currentEventId,
                    currentEventMatches: q.currentEventId?.toString() === exit.requiredQuestEventId.toString(),
                    completedEventIds: q.completedEventIds,
                    hasCompletedEvent: q.completedEventIds?.some(id => id.toString() === exit.requiredQuestEventId.toString())
                }))
            });

            // Check if the event is either completed or is the current event in any quest
            const hasRequiredQuestEvent = userQuestInfo.quests && userQuestInfo.quests.some(quest => {
                const isCurrentEvent = quest.currentEventId && quest.currentEventId.toString() === exit.requiredQuestEventId.toString();
                const isCompletedEvent = quest.completedEventIds && quest.completedEventIds.some(id => id.toString() === exit.requiredQuestEventId.toString());
                
                logger.debug('Quest event check details', {
                    questId: quest.questId,
                    currentEventId: quest.currentEventId,
                    isCurrentEvent,
                    completedEventCount: quest.completedEventIds?.length || 0,
                    isCompletedEvent,
                    overallResult: isCurrentEvent || isCompletedEvent
                });
                
                return isCurrentEvent || isCompletedEvent;
            });
            
            if (!hasRequiredQuestEvent) {
                logger.debug('Exit not accessible - missing required quest event', {
                    direction: exit.direction,
                    requiredQuestEventId: exit.requiredQuestEventId,
                    userQuestInfo: {
                        questCount: userQuestInfo.quests?.length || 0,
                        questDetails: userQuestInfo.quests?.map(q => ({
                            questId: q.questId,
                            currentEventId: q.currentEventId,
                            completedEventCount: q.completedEventIds?.length || 0
                        }))
                    }
                });
                return false;
            }
        }
        
        return true;
    }

    // Method to filter exits based on quest requirements
    filterAccessibleExits(exits, userQuestInfo) {
        if (!exits) return [];
        return exits.filter(exit => this.isExitAccessible(exit, userQuestInfo));
    }
}

// Create a singleton instance with default dependencies
const nodeServiceInstance = new NodeService();

// Export both the class and the singleton instance
module.exports = nodeServiceInstance;
module.exports.NodeService = NodeService; 