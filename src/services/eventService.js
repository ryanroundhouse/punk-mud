const logger = require('../config/logger');
const Event = require('../models/Event');
const stateService = require('./stateService');
const User = require('../models/User');
const mongoose = require('mongoose');
const eventNodeService = require('./eventNodeService');
const eventStateManager = require('./eventStateManager');

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

            // Use eventNodeService to ensure consistent questCompletionEvents
            eventNodeService.ensureConsistentQuestEvents(currentNode);

            // If no choices available, end event and allow new one to start
            if (!currentNode.choices || currentNode.choices.length === 0) {
                logger.debug('No choices available, ending event', {
                    userId,
                    isStoryEvent: activeEvent.isStoryEvent
                });
                eventStateManager.clearActiveEvent(userId);
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
                eventStateManager.clearActiveEvent(userId);
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
            
            // Use eventNodeService to clone the selected choice
            const clonedChoice = eventNodeService.cloneNode(selectedChoice);
            
            // Add more comprehensive logging
            logger.debug('Selected choice details:', {
                userId,
                text: clonedChoice.text,
                hasNextNode: !!clonedChoice.nextNode,
                nextNodeId: clonedChoice.nextNode?._id?.toString(),
                nextNodeHasChoices: clonedChoice.nextNode?.choices?.length > 0,
                questCompletionEvents: clonedChoice.nextNode?.questCompletionEvents || [],
                hasActivateQuest: !!clonedChoice.nextNode?.activateQuestId,
                hasMobId: !!clonedChoice.mobId
            });

            // Check if this choice has a mobId for combat
            if (clonedChoice.mobId) {
                logger.debug('Combat mob choice selected', {
                    userId,
                    mobId: clonedChoice.mobId,
                    choiceText: clonedChoice.text
                });

                // Clear the active event since we're transitioning to combat
                eventStateManager.clearActiveEvent(userId);

                // Create a mock event object with the mobId for the loadMobFromEvent function
                const mockEvent = {
                    mobId: clonedChoice.mobId
                };

                // Import required services
                const mobService = require('./mobService');
                const combatService = require('./combatService');
                const messageService = require('./messageService');

                try {
                    // Load the mob from the event
                    const mobInstance = await mobService.loadMobFromEvent(mockEvent);
                    
                    if (!mobInstance) {
                        logger.error('Failed to load mob for combat', {
                            userId,
                            mobId: clonedChoice.mobId
                        });
                        return {
                            message: clonedChoice.text + "\n\nYou were going to encounter a creature, but it seems to have fled.",
                            isEnd: true
                        };
                    }

                    // Store the mob instance for the user
                    stateService.setPlayerMob(userId, mobInstance);

                    // Set the user's combat state
                    stateService.setUserCombatState(userId, {
                        mobInstanceId: mobInstance.instanceId,
                        mobName: mobInstance.name
                    });

                    // Send combat initiation messages - don't include the mob name in the message
                    // since it will be displayed by the combat system
                    messageService.sendCombatMessage(
                        userId,
                        `${clonedChoice.text}\n\nA hostile creature attacks you!`,
                        'Type ? to see available combat commands.'
                    );

                    // Announce combat to the room
                    messageService.sendConsoleResponse(
                        user.currentNode,
                        {
                            type: 'chat',
                            username: 'SYSTEM',
                            message: `${user.avatarName} engages in combat with ${mobInstance.name}!`,
                            timestamp: new Date()
                        }
                    );

                    try {
                        // Process combat until user input is required
                        await combatService.processCombatUntilInput(user, mobInstance);
                    } catch (combatError) {
                        // Log detailed error information but continue - don't fail the entire event
                        logger.error('Error in processCombatUntilInput:', {
                            error: combatError.message,
                            stack: combatError.stack,
                            userId: userId,
                            mobId: mobInstance.mobId,
                            mobName: mobInstance.name
                        });
                        // We don't return an error here, just log it and continue
                    }

                    // Return success even if processCombatUntilInput had an error
                    // The combat state is already set up, so the player can continue
                    return {
                        message: null, // Don't send an additional message, the combat message was already sent
                        isEnd: true,
                        combatInitiated: true
                    };
                } catch (error) {
                    logger.error('Error initiating combat from event choice', {
                        error: error.message,
                        stack: error.stack,
                        userId: userId,
                        mobId: clonedChoice.mobId
                    });
                    
                    // Clean up any partial combat state
                    stateService.clearPlayerMob(userId);
                    stateService.clearUserCombatState(userId);
                    
                    return {
                        message: clonedChoice.text + "\n\nSomething went wrong with the encounter.",
                        isEnd: true
                    };
                }
            }
            
            // Check if this choice has a teleportToNode for location teleportation
            let teleportAction = null;
            if (clonedChoice.teleportToNode) {
                logger.debug('Teleport choice selected', {
                    userId,
                    teleportToNode: clonedChoice.teleportToNode,
                    choiceText: clonedChoice.text
                });
                
                // Store the teleport information to return to the caller
                teleportAction = {
                    targetNode: clonedChoice.teleportToNode
                };
            }

            // Check if this choice has a skill check
            if (clonedChoice.skillCheckStat && clonedChoice.skillCheckTargetNumber) {
                logger.debug('Skill check choice selected', {
                    userId,
                    stat: clonedChoice.skillCheckStat,
                    targetNumber: clonedChoice.skillCheckTargetNumber,
                    choiceText: clonedChoice.text
                });
                
                // Import required services
                const messageService = require('./messageService');
                
                // Get the user's stat value for the skill check
                const userStatValue = user.stats[clonedChoice.skillCheckStat];
                
                // Roll a d20
                const diceRoll = Math.floor(Math.random() * 20) + 1;
                
                // Calculate the total check result
                const checkResult = userStatValue + diceRoll;
                
                // Determine if the check passed or failed
                const passed = checkResult >= clonedChoice.skillCheckTargetNumber;
                
                // Format the skill check result message
                let resultMessage = `${clonedChoice.text}\n\n`;
                resultMessage += `SKILL CHECK: ${clonedChoice.skillCheckStat.toUpperCase()} (${userStatValue}) + D20 (${diceRoll}) = ${checkResult} vs ${clonedChoice.skillCheckTargetNumber}\n`;
                
                if (passed) {
                    resultMessage += `SUCCESS! You passed the ${clonedChoice.skillCheckStat} check.\n`;
                    
                    // If there's no nextNode (success path), end the event
                    if (!clonedChoice.nextNode) {
                        logger.debug('Skill check passed but no success path found, ending event', {
                            userId,
                            stat: clonedChoice.skillCheckStat,
                            roll: diceRoll,
                            total: checkResult,
                            target: clonedChoice.skillCheckTargetNumber
                        });
                        
                        eventStateManager.clearActiveEvent(userId);
                        
                        // Send the result message
                        messageService.sendSuccessMessage(userId, resultMessage);
                        
                        return {
                            message: null, // Message already sent
                            isEnd: true
                        };
                    }
                    
                    // Continue with the success path (nextNode)
                    logger.debug('Skill check passed, continuing with success path', {
                        userId,
                        stat: clonedChoice.skillCheckStat,
                        roll: diceRoll,
                        total: checkResult,
                        target: clonedChoice.skillCheckTargetNumber
                    });
                    
                    // Send the result message
                    messageService.sendSuccessMessage(userId, resultMessage);
                    
                    // Continue with the nextNode (success path)
                    // The rest of the function will handle this
                } else {
                    resultMessage += `FAILURE! You failed the ${clonedChoice.skillCheckStat} check.\n`;
                    
                    // If there's no failureNode, end the event
                    if (!clonedChoice.failureNode) {
                        logger.debug('Skill check failed but no failure path found, ending event', {
                            userId,
                            stat: clonedChoice.skillCheckStat,
                            roll: diceRoll,
                            total: checkResult,
                            target: clonedChoice.skillCheckTargetNumber
                        });
                        
                        eventStateManager.clearActiveEvent(userId);
                        
                        // Send the result message
                        messageService.sendErrorMessage(userId, resultMessage);
                        
                        return {
                            message: null, // Message already sent
                            isEnd: true
                        };
                    }
                    
                    // Continue with the failure path
                    logger.debug('Skill check failed, continuing with failure path', {
                        userId,
                        stat: clonedChoice.skillCheckStat,
                        roll: diceRoll,
                        total: checkResult,
                        target: clonedChoice.skillCheckTargetNumber
                    });
                    
                    // Send the result message
                    messageService.sendErrorMessage(userId, resultMessage);
                    
                    // Replace the nextNode with the failureNode
                    clonedChoice.nextNode = clonedChoice.failureNode;
                    
                    // The rest of the function will handle this
                }
            }

            // Validate the next node structure using eventNodeService
            if (clonedChoice.nextNode) {
                // Validate and ensure the next node has proper structure
                clonedChoice.nextNode = eventNodeService.validateNodeStructure(clonedChoice.nextNode);
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

                const result = await getQuestService().handleQuestProgression(
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

                await getQuestService().handleQuestProgression(
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
                eventStateManager.clearActiveEvent(userId);
                return {
                    message: clonedChoice.text,
                    isEnd: true
                };
            }

            // Ensure the next node has an ID using eventNodeService
            eventNodeService.ensureNodeHasId(clonedChoice.nextNode);

            // Update event state
            logger.debug('Updating event state with next node', {
                userId,
                isStoryEvent: activeEvent.isStoryEvent,
                nextNodeId: clonedChoice.nextNode._id?.toString(),
                nextNodePrompt: clonedChoice.nextNode.prompt?.substring(0, 30) + '...',
                nextNodeChoices: clonedChoice.nextNode.choices?.length || 0
            });

            // Ensure consistent questCompletionEvents before storing
            clonedChoice.nextNode = eventNodeService.ensureConsistentQuestEvents(clonedChoice.nextNode);

            eventStateManager.setActiveEvent(
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
                eventStateManager.clearActiveEvent(userId);
            }

            return {
                message: response.message,
                hasChoices: response.hasChoices,
                isEnd: response.isEnd,
                error: false,
                teleportAction: teleportAction
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

const eventService = new EventService();
module.exports = eventService; 