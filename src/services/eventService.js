const logger = require('../config/logger');
const Event = require('../models/Event');
const stateService = require('./stateService');
const User = require('../models/User');
const mongoose = require('mongoose');
const eventNodeService = require('./eventNodeService');
const eventStateManager = require('./eventStateManager');
const eventChoiceProcessor = require('./eventChoiceProcessor');

// Add a function to get questService when needed
function getQuestService() {
    return require('./questService');
}

class EventService {
    async handleActorChat(user, actor) {
        try {
            logger.debug('handleActorChat called:', {
                userId: user._id.toString(),
                actorId: actor._id,
                actorName: actor.name
            });

            // Check if user is already in an event
            const activeEvent = eventStateManager.getActiveEvent(user._id.toString());
            logger.debug('Active event state:', {
                exists: !!activeEvent,
                activeEvent
            });

            if (activeEvent) {
                logger.debug('Processing existing event');
                const result = await this.handleEventChoice(user._id.toString(), activeEvent, null);
                logger.debug('Event choice result:', { result });
                
                if (!result) {
                    logger.debug('Clearing event state due to null result');
                    eventStateManager.clearActiveEvent(user._id.toString());
                }
                return result;
            }

            // Find events for this actor
            const events = await Event.find({ actorId: actor._id })
                .populate('rootNode.requiredQuestId')
                .populate('rootNode.activateQuestId');

            logger.debug('Found events for actor:', {
                count: events.length,
                events: events.map(e => ({
                    id: e._id,
                    title: e.title,
                    hasRequiredQuest: !!e.rootNode.requiredQuestId
                }))
            });

            // Filter events by quest requirements
            const availableEvents = events.filter(event => {
                if (!event.rootNode.requiredQuestId) return true;
                
                // Check if user has the required quest active
                const hasRequiredQuest = user.quests?.some(userQuest => 
                    userQuest.questId === event.rootNode.requiredQuestId._id.toString() &&
                    !userQuest.completed
                );

                logger.debug('Quest requirement check:', {
                    eventId: event._id,
                    requiredQuestId: event.rootNode.requiredQuestId._id,
                    hasRequiredQuest,
                    requiredQuestEventId: event.rootNode.requiredQuestEventId
                });

                // If quest is required but not active, event is not available
                if (!hasRequiredQuest) {
                    logger.debug('Event filtered out - required quest not active:', {
                        eventId: event._id,
                        requiredQuestId: event.rootNode.requiredQuestId._id
                    });
                    return false;
                }

                // If quest event ID is required, check if user is on that event
                if (event.rootNode.requiredQuestEventId) {
                    const userQuest = user.quests.find(q => 
                        q.questId === event.rootNode.requiredQuestId._id.toString()
                    );
                    
                    const isOnRequiredEvent = userQuest?.currentEventId === event.rootNode.requiredQuestEventId;
                    
                    logger.debug('Quest event ID check:', {
                        eventId: event._id,
                        requiredQuestEventId: event.rootNode.requiredQuestEventId,
                        userCurrentEventId: userQuest?.currentEventId,
                        isOnRequiredEvent
                    });

                    if (!isOnRequiredEvent) {
                        logger.debug('Event filtered out - user not on required quest event:', {
                            eventId: event._id,
                            requiredQuestEventId: event.rootNode.requiredQuestEventId,
                            userCurrentEventId: userQuest?.currentEventId
                        });
                        return false;
                    }
                }

                return true;
            });

            // If there are available events but user doesn't have energy, show tired message and return false
            // BUT only if the event requires energy
            if (availableEvents.length > 0 && user.stats.currentEnergy < 1) {
                // Get the first available event (the one that would trigger)
                const event = availableEvents[0];
                
                // Only block the event if it requires energy
                if (event.requiresEnergy !== false) {  // Check explicitly against false since default is true
                    logger.debug('User has insufficient energy for available event that requires energy', {
                        userId: user._id.toString(),
                        currentEnergy: user.stats.currentEnergy,
                        eventId: event._id,
                        eventTitle: event.title,
                        requiresEnergy: event.requiresEnergy
                    });

                    // Get the socket to send the tired message
                    const socket = eventStateManager.getClientSocket(user._id.toString());
                    if (socket) {
                        socket.emit('console response', {
                            type: 'info',
                            message: "You notice something interesting might happen, but you're too tired to engage fully right now. Get some sleep."
                        });
                    }
                    
                    // Return false to allow fallback to regular chat
                    return false;
                }
                
                logger.debug('Allowing energy-free event to proceed', {
                    userId: user._id.toString(),
                    currentEnergy: user.stats.currentEnergy,
                    eventId: event._id,
                    eventTitle: event.title,
                    requiresEnergy: event.requiresEnergy
                });
            }

            logger.debug('Available events after filtering:', {
                count: availableEvents.length
            });

            if (availableEvents.length === 0) {
                logger.debug('No available events found');
                return null;
            }

            // Start the first available event
            const event = availableEvents[0];
            logger.debug('Starting new event:', {
                eventId: event._id,
                title: event.title
            });

            return this.startEvent(user._id.toString(), event);
        } catch (error) {
            logger.error('Error handling actor chat:', error);
            return null;
        }
    }

    async startEvent(userId, event) {
        try {
            // Validate and ensure consistent quest events in the root node
            const rootNode = eventNodeService.validateNodeStructure(event.rootNode);
            eventNodeService.ensureConsistentQuestEvents(rootNode);
            
            logger.debug('Starting event:', {
                userId,
                eventId: event._id,
                hasActivateQuest: !!rootNode.activateQuestId,
                activateQuestId: rootNode.activateQuestId?._id?.toString()
            });

            // Get user data to check restrictions
            const user = await User.findById(userId);
            if (!user) {
                logger.error('User not found when starting event:', { userId });
                return null;
            }

            // Check node restrictions
            if (rootNode.restrictions?.length > 0) {
                for (const restriction of rootNode.restrictions) {
                    // 'noClass' restriction - only show if user has no class
                    if (restriction === 'noClass' && user.class) {
                        logger.debug('Event blocked by noClass restriction:', {
                            userId,
                            eventId: event._id,
                            userHasClass: !!user.class
                        });
                        return null;
                    }
                    // 'enforcerOnly' restriction - only show if user is enforcer class
                    if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                        logger.debug('Event blocked by enforcerOnly restriction:', {
                            userId,
                            eventId: event._id,
                            userClass: user.class?.name
                        });
                        return null;
                    }
                }
            }

            // Store event state using eventStateManager
            eventStateManager.setActiveEvent(
                userId, 
                event._id, 
                rootNode,
                event.actorId
            );

            // Handle quest activation if specified
            if (rootNode.activateQuestId) {
                // Get the user object first
                const updatedUser = await User.findById(userId);
                if (!updatedUser) {
                    logger.error('User not found when activating quest:', { userId });
                    return null;
                }
                
                logger.debug('Activating quest from event:', {
                    userId: updatedUser._id.toString(),
                    questId: rootNode.activateQuestId._id.toString(),
                    questTitle: rootNode.activateQuestId.title
                });

                // Pass the correct parameters
                await getQuestService().handleQuestProgression(
                    updatedUser,
                    event.actorId,
                    [],  // No completion events
                    rootNode.activateQuestId._id  // Pass the actual quest ID
                );
            }

            // Handle quest completion events
            if (rootNode.questCompletionEvents?.length > 0) {
                // Implement quest completion logic here
                // This would need to be coordinated with questService
            }

            // Pass userId to formatEventResponse
            return await this.formatEventResponse(rootNode, userId);
        } catch (error) {
            logger.error('Error starting event:', error);
            return null;
        }
    }

    async handleEventChoice(userId, choice) {
        try {
            // Get active event
            const activeEvent = eventStateManager.getActiveEvent(userId);
            
            if (!activeEvent) {
                logger.debug('No active event found for user', { userId });
                return null;
            }
            
            // Delegate to the EventChoiceProcessor
            return await eventChoiceProcessor.processEventChoice(userId, activeEvent, choice);
        } catch (error) {
            logger.error('Error in handleEventChoice:', { 
                error: error.message, 
                stack: error.stack,
                userId
            });
            return null;
        }
    }

    async formatEventResponse(node, userId) {
        let response = node.prompt + '\n\n';
        
        if (node.choices && node.choices.length > 0) {
            // Get user data to check quests and class
            const user = await User.findById(userId);
            
            // Use the EventChoiceProcessor to filter choices
            const validChoices = eventChoiceProcessor.filterChoicesByRestrictions(node.choices, user);

            if (validChoices.length > 0) {
                response += 'Responses:\n';
                validChoices.forEach(({ choice }, index) => {
                    response += `${index + 1}. ${choice.text}\n`;
                });
            }

            return {
                message: response.trim(),
                hasChoices: validChoices.length > 0,
                isEnd: validChoices.length === 0
            };
        }

        return {
            message: response.trim(),
            hasChoices: false,
            isEnd: true
        };
    }

    isInEvent(userId) {
        return eventStateManager.isInEvent(userId);
    }

    async processEventInput(userId, input) {
        logger.debug('processEventInput called:', { userId, input });
        
        const activeEvent = eventStateManager.getActiveEvent(userId);
        logger.debug('Active event state:', { exists: !!activeEvent, activeEvent });
        
        if (!activeEvent) {
            logger.debug('No active event found');
            return null;
        }

        // Load the full event from the database to get the latest data
        try {
            // Always use the Event model since there is no separate StoryEvent model
            const currentNodeId = activeEvent.currentNode._id?.toString();
            
            logger.debug('Finding current node from database:', {
                eventId: activeEvent.eventId,
                currentNodeId,
                isStoryEvent: activeEvent.isStoryEvent
            });

            // Use EventNodeService to load node from database
            const currentNodeFromDb = await eventNodeService.loadNodeFromDatabase(
                activeEvent.eventId, 
                currentNodeId
            );
            
            if (!currentNodeFromDb) {
                logger.error('Current node not found in event tree:', {
                    eventId: activeEvent.eventId,
                    currentNodeId
                });
                // Fall back to stored node if we can't find it in the database
                return this.handleEventChoice(userId, input);
            }
            
            logger.debug('Found node in database:', {
                nodeId: currentNodeFromDb._id?.toString(),
                prompt: currentNodeFromDb.prompt?.substring(0, 30) + '...',
                choicesCount: currentNodeFromDb.choices?.length || 0,
                hasQuestCompletionEvents: currentNodeFromDb.questCompletionEvents?.length > 0
            });

            // Log first few choices for debugging
            if (currentNodeFromDb.choices && currentNodeFromDb.choices.length > 0) {
                currentNodeFromDb.choices.slice(0, 3).forEach((choice, idx) => {
                    logger.debug(`Choice ${idx + 1} details:`, {
                        text: choice.text.substring(0, 30) + '...',
                        hasNextNode: !!choice.nextNode,
                        nextNodeQuestCompletionEvents: choice.nextNode?.questCompletionEvents?.length,
                        nextNodeHasActivateQuest: !!choice.nextNode?.activateQuestId
                    });
                });
            }

            // Create a merged event state for processing
            const mergedEvent = {
                ...activeEvent,
                // Replace the currentNode with the one from the database
                currentNode: currentNodeFromDb
            };

            return this.handleEventChoice(userId, input);
        } catch (error) {
            logger.error('Error loading event from database:', { 
                error: error.message, 
                stack: error.stack,
                eventId: activeEvent.eventId
            });
            return null;
        }
    }
}

const eventService = new EventService();
module.exports = eventService; 