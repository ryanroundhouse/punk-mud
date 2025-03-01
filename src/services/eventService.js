const logger = require('../config/logger');
const Event = require('../models/Event');
const stateService = require('./stateService');
const messageService = require('./messageService');
const questService = require('./questService');
const User = require('../models/User');

class EventService {
    async handleActorChat(user, actor) {
        try {
            logger.debug('handleActorChat called:', {
                userId: user._id.toString(),
                actorId: actor._id,
                actorName: actor.name
            });

            // Check if user is already in an event
            const activeEvent = stateService.getActiveEvent(user._id.toString());
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
                    stateService.clearActiveEvent(user._id.toString());
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
                    hasRequiredQuest
                });

                return hasRequiredQuest;
            });

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
            const rootNode = event.rootNode;
            
            logger.debug('Starting event:', {
                userId,
                eventId: event._id,
                hasActivateQuest: !!rootNode.activateQuestId,
                activateQuestId: rootNode.activateQuestId?._id?.toString()
            });

            // Store event state using stateService
            stateService.setActiveEvent(
                userId, 
                event._id, 
                rootNode,
                event.actorId
            );

            // Handle quest activation if specified
            if (rootNode.activateQuestId) {
                // Get the user object first
                const user = await User.findById(userId);
                if (!user) {
                    logger.error('User not found when starting event:', { userId });
                    return null;
                }
                
                logger.debug('Activating quest from event:', {
                    userId: user._id.toString(),
                    questId: rootNode.activateQuestId._id.toString(),
                    questTitle: rootNode.activateQuestId.title
                });

                // Pass the correct parameters
                await questService.handleQuestProgression(
                    user,
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

    async handleEventChoice(userId, activeEvent, choice) {
        try {
            logger.debug('handleEventChoice called:', {
                userId,
                choice,
                activeEvent: {
                    eventId: activeEvent.eventId,
                    hasCurrentNode: !!activeEvent.currentNode,
                    actorId: activeEvent.actorId,
                    isStoryEvent: activeEvent.isStoryEvent
                }
            });

            const currentNode = activeEvent.currentNode;

            // If no choices available, end event and allow new one to start
            if (!currentNode.choices || currentNode.choices.length === 0) {
                logger.debug('No choices available, ending event', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
                return null;
            }

            // If we get a non-numeric input in an event with choices, 
            // return an error message instead of clearing the event
            if (isNaN(parseInt(choice)) && currentNode.choices.length > 0) {
                logger.debug('Non-numeric input received, prompting for valid choice', {
                    userId,
                    input: choice,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                return {
                    error: true,
                    message: `Please enter a number between 1 and ${currentNode.choices.length} to choose your response.`
                };
            }

            // Get user data to check quests
            let user = await User.findById(userId);
            
            // Filter choices first
            const validChoices = currentNode.choices
                .map((choice, index) => ({ choice, originalIndex: index }))
                .filter(({ choice }) => {
                    // Check quest activation restriction
                    if (choice.nextNode?.activateQuestId) {
                        const hasQuest = user.quests?.some(userQuest => 
                            userQuest.questId.toString() === choice.nextNode.activateQuestId.toString()
                        );
                        if (hasQuest) return false;
                    }

                    // Check node restrictions
                    if (choice.nextNode?.restrictions?.length > 0) {
                        for (const restriction of choice.nextNode.restrictions) {
                            // 'noClass' restriction - only show if user has no class
                            if (restriction === 'noClass' && user.class) {
                                return false;
                            }
                            // 'enforcerOnly' restriction - only show if user is enforcer class
                            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                                return false;
                            }
                        }
                    }

                    return true;
                });

            logger.debug('Filtered choices:', {
                userId,
                totalChoices: currentNode.choices.length,
                validChoices: validChoices.length,
                isStoryEvent: activeEvent.isStoryEvent
            });

            // End event if no valid choices remain
            if (validChoices.length === 0) {
                logger.debug('No valid choices available after filtering, ending event', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
                return null;
            }

            // Now validate the choice against valid choices
            const selectedIndex = parseInt(choice) - 1;
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= validChoices.length) {
                logger.debug('Invalid choice provided', {
                    userId,
                    choice,
                    validChoiceRange: `1-${validChoices.length}`,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                return {
                    error: true,
                    message: `Invalid choice. Please choose 1-${validChoices.length}.`
                };
            }

            const selectedChoice = validChoices[selectedIndex].choice;
            
            logger.debug('Selected choice:', {
                userId,
                text: selectedChoice.text,
                hasNextNode: !!selectedChoice.nextNode,
                hasActivateQuest: !!selectedChoice.nextNode?.activateQuestId,
                hasQuestCompletionEvents: !!selectedChoice.nextNode?.questCompletionEvents?.length,
                isStoryEvent: activeEvent.isStoryEvent
            });

            // Process quest completion events BEFORE updating state or ending event
            if (selectedChoice.nextNode?.questCompletionEvents?.length > 0) {
                logger.debug('Processing quest completion events:', {
                    events: selectedChoice.nextNode.questCompletionEvents,
                    userId: user._id.toString(),
                    isStoryEvent: activeEvent.isStoryEvent
                });

                const result = await questService.handleQuestProgression(
                    user,
                    activeEvent.actorId,
                    selectedChoice.nextNode.questCompletionEvents
                );

                // Refresh user after quest progression
                user = await User.findById(userId);
                
                logger.debug('Quest completion result:', { result });
            }

            // Handle quest activation if specified in the choice's next node
            if (selectedChoice.nextNode?.activateQuestId) {
                if (!user) {
                    logger.error('User not found for quest activation:', { userId });
                    return null;
                }

                await questService.handleQuestProgression(
                    user,
                    activeEvent.actorId,
                    [],  // No completion events
                    selectedChoice.nextNode.activateQuestId // Pass the quest to activate
                );
            }

            if (!selectedChoice.nextNode) {
                logger.debug('End of event branch reached', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
                return {
                    message: selectedChoice.text,
                    isEnd: true
                };
            }

            // Update event state
            logger.debug('Updating event state with next node', {
                userId,
                isStoryEvent: activeEvent.isStoryEvent,
                nextNodePrompt: selectedChoice.nextNode.prompt,
                nextNodeChoices: selectedChoice.nextNode.choices?.length || 0
            });

            stateService.setActiveEvent(
                userId, 
                activeEvent.eventId, 
                selectedChoice.nextNode,
                activeEvent.actorId,
                activeEvent.isStoryEvent
            );

            // Return the formatted response
            const response = await this.formatEventResponse(selectedChoice.nextNode, userId);
            logger.debug('Formatted response:', {
                userId,
                message: response.message,
                hasChoices: response.hasChoices,
                isEnd: response.isEnd,
                isStoryEvent: activeEvent.isStoryEvent
            });

            // Clear event state if there are no more choices
            if (!response.hasChoices) {
                logger.debug('No more choices available, ending event', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
            }

            return {
                message: response.message,
                hasChoices: response.hasChoices,
                isEnd: response.isEnd,
                error: false
            };
        } catch (error) {
            logger.error('Error in handleEventChoice:', error);
            return null;
        }
    }

    async formatEventResponse(node, userId) {
        let response = node.prompt + '\n\n';
        
        if (node.choices && node.choices.length > 0) {
            // Get user data to check quests and class
            const user = await User.findById(userId);
            
            // Filter choices based on restrictions and quests
            const validChoices = node.choices
                .map((choice, index) => ({ choice, originalIndex: index }))
                .filter(({ choice }) => {
                    // Check quest activation restriction
                    if (choice.nextNode?.activateQuestId) {
                        const hasQuest = user.quests?.some(userQuest => 
                            userQuest.questId.toString() === choice.nextNode.activateQuestId.toString()
                        );
                        if (hasQuest) return false;
                    }

                    // Check node restrictions
                    if (choice.nextNode?.restrictions?.length > 0) {
                        for (const restriction of choice.nextNode.restrictions) {
                            // 'noClass' restriction - only show if user has no class
                            if (restriction === 'noClass' && user.class) {
                                return false;
                            }
                            // 'enforcerOnly' restriction - only show if user is enforcer class
                            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                                return false;
                            }
                        }
                    }

                    return true;
                });

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
        return stateService.isInEvent(userId);
    }

    async processEventInput(userId, input) {
        logger.debug('processEventInput called:', { userId, input });
        
        const activeEvent = stateService.getActiveEvent(userId);
        logger.debug('Active event state:', { exists: !!activeEvent, activeEvent });
        
        if (!activeEvent) {
            logger.debug('No active event found');
            return null;
        }

        return this.handleEventChoice(userId, activeEvent, input);
    }
}

const eventService = new EventService();
module.exports = eventService; 