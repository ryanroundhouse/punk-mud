const logger = require('../config/logger');
const Event = require('../models/Event');
const stateService = require('./stateService');
const messageService = require('./messageService');
const questService = require('./questService');
const User = require('../models/User');
const mongoose = require('mongoose');
const util = require('util');

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
                    const socket = stateService.getClient(user._id.toString());
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
            const rootNode = event.rootNode;
            
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

            // Debug the current node structure to verify questCompletionEvents
            logger.debug('Current node in handleEventChoice:', {
                prompt: currentNode.prompt?.substring(0, 30) + '...',
                choicesCount: currentNode.choices?.length || 0,
                hasDirectQuestCompletionEvents: currentNode.questCompletionEvents?.length > 0
            });

            // Log details of each choice to debug questCompletionEvents
            if (currentNode.choices && Array.isArray(currentNode.choices)) {
                currentNode.choices.forEach((choiceItem, idx) => {
                    const nextNodeEvents = choiceItem.nextNode?.questCompletionEvents || [];
                    logger.debug(`Choice ${idx+1} nextNode questCompletionEvents:`, {
                        text: choiceItem.text?.substring(0, 30) + '...',
                        questCompletionEventsCount: nextNodeEvents.length,
                        questCompletionEvents: nextNodeEvents,
                        hasNextNode: !!choiceItem.nextNode
                    });
                });
            }

            // Ensure the current node has consistent questCompletionEvents in all choices
            // This fixes scenarios where some choices might be missing them
            if (currentNode.choices && Array.isArray(currentNode.choices) && currentNode.choices.length > 0) {
                // Find a choice with questCompletionEvents to use as a reference
                const referenceChoice = currentNode.choices.find(c => 
                    c.nextNode && c.nextNode.questCompletionEvents && c.nextNode.questCompletionEvents.length > 0
                );
                
                if (referenceChoice) {
                    const refEvents = referenceChoice.nextNode.questCompletionEvents;
                    logger.debug('Found reference questCompletionEvents:', {
                        events: refEvents,
                        refChoiceText: referenceChoice.text.substring(0, 30) + '...'
                    });
                    
                    // Apply the same questCompletionEvents to all choices that don't have them
                    let fixedCount = 0;
                    currentNode.choices.forEach(c => {
                        if (c.nextNode && (!c.nextNode.questCompletionEvents || c.nextNode.questCompletionEvents.length === 0)) {
                            // Deep clone the reference events array
                            c.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(refEvents));
                            fixedCount++;
                        }
                    });
                    
                    if (fixedCount > 0) {
                        logger.debug(`Fixed questCompletionEvents for ${fixedCount} choices`, {
                            nodeChoicesCount: currentNode.choices.length,
                            eventsApplied: refEvents
                        });
                        
                        // Log the choices again after fixing
                        currentNode.choices.forEach((choiceItem, idx) => {
                            const nextNodeEvents = choiceItem.nextNode?.questCompletionEvents || [];
                            logger.debug(`Choice ${idx+1} nextNode questCompletionEvents after fix:`, {
                                text: choiceItem.text?.substring(0, 30) + '...',
                                questCompletionEventsCount: nextNodeEvents.length,
                                questCompletionEvents: nextNodeEvents
                            });
                        });
                    }
                }
            }

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
            
            // Deep clone the selected choice to avoid reference issues
            const clonedChoice = JSON.parse(JSON.stringify(selectedChoice));
            
            // Add more comprehensive logging
            logger.debug('Selected choice details:', {
                userId,
                text: clonedChoice.text,
                hasNextNode: !!clonedChoice.nextNode,
                nextNodeId: clonedChoice.nextNode?._id?.toString(),
                nextNodeHasChoices: clonedChoice.nextNode?.choices?.length > 0,
                questCompletionEvents: clonedChoice.nextNode?.questCompletionEvents || [],
                hasActivateQuest: !!clonedChoice.nextNode?.activateQuestId,
            });

            // Validate the next node structure
            if (clonedChoice.nextNode) {
                // Add this to check if the node already has an ID
                if (!clonedChoice.nextNode._id) {
                    logger.debug('Next node has no ID, generating one', {
                        choiceText: clonedChoice.text.substring(0, 30),
                        nextNodePrompt: clonedChoice.nextNode.prompt?.substring(0, 30)
                    });
                } else {
                    logger.debug('Next node already has ID', {
                        nextNodeId: clonedChoice.nextNode._id.toString()
                    });
                }
                
                // Make sure choices array is properly initialized
                if (clonedChoice.nextNode.choices === undefined) {
                    clonedChoice.nextNode.choices = [];
                    logger.debug('Initialized empty choices array for next node');
                }
            }

            // Process quest completion events BEFORE updating state or ending event
            if (clonedChoice.nextNode?.questCompletionEvents?.length > 0) {
                logger.debug('Processing quest completion events:', {
                    events: clonedChoice.nextNode.questCompletionEvents,
                    userId: user._id.toString(),
                    isStoryEvent: activeEvent.isStoryEvent,
                    selectedChoiceText: clonedChoice.text,
                    nextNodeId: clonedChoice.nextNode._id?.toString()
                });

                const result = await questService.handleQuestProgression(
                    user,
                    activeEvent.actorId,
                    clonedChoice.nextNode.questCompletionEvents
                );

                logger.debug('Quest progression result:', {
                    userId: user._id.toString(),
                    result,
                    questCompletionEvents: clonedChoice.nextNode.questCompletionEvents,
                    actorId: activeEvent.actorId
                });

                // Refresh user after quest progression
                user = await User.findById(userId);
                
                logger.debug('Quest completion result:', { result });
            }

            // Handle quest activation if specified in the choice's next node
            if (clonedChoice.nextNode?.activateQuestId) {
                if (!user) {
                    logger.error('User not found for quest activation:', { userId });
                    return null;
                }

                await questService.handleQuestProgression(
                    user,
                    activeEvent.actorId,
                    [],  // No completion events
                    clonedChoice.nextNode.activateQuestId // Pass the quest to activate
                );
            }

            if (!clonedChoice.nextNode) {
                logger.debug('End of event branch reached', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
                return {
                    message: clonedChoice.text,
                    isEnd: true
                };
            }

            // Ensure the next node has an ID for proper tracking
            if (!clonedChoice.nextNode._id) {
                // Generate a predictable ID if none exists
                const timestamp = Date.now();
                clonedChoice.nextNode._id = `generated_${timestamp}_${Math.random().toString(36).substring(2, 10)}`;
                logger.debug('Generated ID for next node', { 
                    generatedId: clonedChoice.nextNode._id,
                    nodePrompt: clonedChoice.nextNode.prompt?.substring(0, 30) + '...'
                });
            }

            // Update event state
            logger.debug('Updating event state with next node', {
                userId,
                isStoryEvent: activeEvent.isStoryEvent,
                nextNodeId: clonedChoice.nextNode._id?.toString(),
                nextNodePrompt: clonedChoice.nextNode.prompt?.substring(0, 30) + '...',
                nextNodeChoices: clonedChoice.nextNode.choices?.length || 0
            });

            // Ensure consistent questCompletionEvents before storing
            if (clonedChoice.nextNode.choices && clonedChoice.nextNode.choices.length > 0) {
                let questEventsFound = false;
                let referenceEvents = null;
                
                // Find a questCompletionEvents reference
                for (const choice of clonedChoice.nextNode.choices) {
                    if (choice.nextNode?.questCompletionEvents?.length > 0) {
                        referenceEvents = choice.nextNode.questCompletionEvents;
                        questEventsFound = true;
                        break;
                    }
                }
                
                // Apply reference to all choices
                if (questEventsFound && referenceEvents) {
                    logger.debug('Applying consistent questCompletionEvents to next node choices', {
                        referenceEvents,
                        choiceCount: clonedChoice.nextNode.choices.length
                    });
                    
                    for (const choice of clonedChoice.nextNode.choices) {
                        if (choice.nextNode && (!choice.nextNode.questCompletionEvents || choice.nextNode.questCompletionEvents.length === 0)) {
                            choice.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(referenceEvents));
                        }
                    }
                }
            }

            stateService.setActiveEvent(
                userId, 
                activeEvent.eventId, 
                clonedChoice.nextNode,
                activeEvent.actorId,
                activeEvent.isStoryEvent
            );

            // Format and return response for client
            const response = await this.formatEventResponse(clonedChoice.nextNode, userId);
            
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

        // Load the full event from the database to get the latest data
        let fullEvent;
        try {
            // Always use the Event model since there is no separate StoryEvent model
            const Event = mongoose.model('Event');
            fullEvent = await Event.findById(activeEvent.eventId).lean();
            
            if (!fullEvent) {
                logger.error('Event not found in database:', { 
                    eventId: activeEvent.eventId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                stateService.clearActiveEvent(userId);
                return null;
            }

            logger.debug('Loaded event from database:', {
                eventId: fullEvent._id.toString(),
                title: fullEvent.title,
                isStoryEvent: activeEvent.isStoryEvent,
                hasRootNode: !!fullEvent.rootNode
            });

            // Find the current node in the full event structure that matches the one in stateService
            const currentNodeId = activeEvent.currentNode._id?.toString();
            
            logger.debug('Finding current node in full event:', {
                eventId: fullEvent._id.toString(),
                currentNodeId,
                rootNodeChoicesCount: fullEvent.rootNode?.choices?.length || 0
            });

            // Find the current node based on the current position in the event tree
            const currentNodeFromDb = findNodeInEventTree(fullEvent, currentNodeId);
            
            if (!currentNodeFromDb) {
                logger.error('Current node not found in event tree:', {
                    eventId: fullEvent._id.toString(),
                    currentNodeId
                });
                // Fall back to stored node if we can't find it in the database
                return this.handleEventChoice(userId, activeEvent, input);
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

            // Ensure all choices have consistent questCompletionEvents before merging
            if (currentNodeFromDb.choices && Array.isArray(currentNodeFromDb.choices) && currentNodeFromDb.choices.length > 0) {
                // Find if any choice has questCompletionEvents
                const choiceWithEvents = currentNodeFromDb.choices.find(
                    c => c.nextNode && c.nextNode.questCompletionEvents && c.nextNode.questCompletionEvents.length > 0
                );
                
                if (choiceWithEvents) {
                    const refEvents = choiceWithEvents.nextNode.questCompletionEvents;
                    logger.debug('Reference questCompletionEvents from database:', {
                        events: refEvents,
                        choiceText: choiceWithEvents.text.substring(0, 30) + '...'
                    });
                    
                    // Apply to all choices that don't have questCompletionEvents
                    let fixCount = 0;
                    currentNodeFromDb.choices.forEach(choice => {
                        if (choice.nextNode && (!choice.nextNode.questCompletionEvents || choice.nextNode.questCompletionEvents.length === 0)) {
                            choice.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(refEvents));
                            fixCount++;
                        }
                    });
                    
                    if (fixCount > 0) {
                        logger.debug(`Fixed questCompletionEvents on ${fixCount} choices in database node before merging`, {
                            totalChoices: currentNodeFromDb.choices.length
                        });
                    }
                }
            }

            // Create a merged event state for processing
            const mergedEvent = {
                ...activeEvent,
                // Replace the currentNode with the one from the database
                currentNode: currentNodeFromDb
            };

            return this.handleEventChoice(userId, mergedEvent, input);
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

// Helper function to find a node in the event tree by ID
function findNodeInEventTree(event, nodeId) {
    if (!nodeId) {
        return event.rootNode;
    }
    
    // For deep nested structures, we need a more robust approach
    // Use a queue for breadth-first search with path tracking
    const queue = [{
        node: event.rootNode,
        path: 'rootNode'
    }];
    
    logger.debug('Starting node search in event tree', {
        eventId: event._id?.toString(),
        targetNodeId: nodeId,
        rootNodeHasChoices: event.rootNode.choices?.length > 0
    });
    
    while (queue.length > 0) {
        const { node, path } = queue.shift();
        
        // More robust ID comparison, handling both string and ObjectId
        const nodeIdStr = node._id?.toString();
        
        // Check if this is the node we're looking for
        if (nodeIdStr === nodeId || 
            (node._id && nodeId === node._id) || 
            (node._id?.$oid && nodeId === node._id.$oid)) {
            logger.debug('Found node in event tree', {
                path,
                nodeId: nodeIdStr
            });
            return node;
        }
        
        // Add child nodes to the queue with their paths
        if (node.choices && Array.isArray(node.choices)) {
            node.choices.forEach((choice, choiceIndex) => {
                if (choice.nextNode) {
                    const choicePath = `${path}.choices[${choiceIndex}].nextNode`;
                    queue.push({
                        node: choice.nextNode,
                        path: choicePath
                    });
                    
                    // Ensure the node has an ID for future lookups
                    if (!choice.nextNode._id) {
                        // Generate a stable ID based on the path
                        choice.nextNode._id = `generated_${choicePath.replace(/\./g, '_')}`;
                        logger.debug('Generated ID for node without _id', {
                            generatedId: choice.nextNode._id,
                            path: choicePath
                        });
                    }
                }
            });
        }
    }
    
    logger.warn('Node not found in event tree', {
        targetNodeId: nodeId,
        eventId: event._id?.toString(),
        queueProcessed: true
    });
    return null;
}

const eventService = new EventService();
module.exports = eventService; 