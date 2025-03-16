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
    constructor(dependencies = {}) {
        // Allow dependency injection for testability
        this.logger = dependencies.logger || logger;
        this.Event = dependencies.Event || Event;
        this.User = dependencies.User || User;
        this.eventNodeService = dependencies.eventNodeService || eventNodeService;
        this.eventStateManager = dependencies.eventStateManager || eventStateManager;
        this.eventChoiceProcessor = dependencies.eventChoiceProcessor || eventChoiceProcessor;
        this.stateService = dependencies.stateService || stateService;
        
        // Avoid circular dependency with questService
        this._questService = dependencies.questService || null;
    }
    
    // Getter for questService to avoid circular dependency
    get questService() {
        if (!this._questService) {
            this._questService = getQuestService();
        }
        return this._questService;
    }

    async handleActorChat(user, actor) {
        try {
            this.logger.debug('handleActorChat called:', {
                userId: user._id.toString(),
                actorId: actor._id,
                actorName: actor.name
            });

            // Check if user is already in an event
            const activeEvent = this.eventStateManager.getActiveEvent(user._id.toString());
            this.logger.debug('Active event state:', {
                exists: !!activeEvent,
                activeEvent
            });

            if (activeEvent) {
                return this.handleExistingEvent(user._id.toString(), activeEvent);
            }

            const availableEvents = await this.findAvailableEvents(user, actor);
            
            // Check energy requirements
            if (availableEvents.length > 0 && !this.hasEnoughEnergyForEvent(user, availableEvents[0])) {
                return this.handleInsufficientEnergy(user);
            }

            this.logger.debug('Available events after filtering:', {
                count: availableEvents.length
            });

            if (availableEvents.length === 0) {
                this.logger.debug('No available events found');
                return null;
            }

            // Start the first available event
            const event = availableEvents[0];
            this.logger.debug('Starting new event:', {
                eventId: event._id,
                title: event.title
            });

            return this.startEvent(user._id.toString(), event);
        } catch (error) {
            this.logger.error('Error handling actor chat:', error);
            return null;
        }
    }
    
    async handleExistingEvent(userId, activeEvent) {
        this.logger.debug('Processing existing event');
        const result = await this.eventChoiceProcessor.processEventChoice(userId, activeEvent, null);
        this.logger.debug('Event choice result:', { result });
        
        if (!result) {
            this.logger.debug('Clearing event state due to null result');
            this.eventStateManager.clearActiveEvent(userId);
        }
        return result;
    }
    
    hasEnoughEnergyForEvent(user, event) {
        // Only block the event if it requires energy
        if (event.requiresEnergy !== false && user.stats.currentEnergy < 1) {
            this.logger.debug('User has insufficient energy for available event that requires energy', {
                userId: user._id.toString(),
                currentEnergy: user.stats.currentEnergy,
                eventId: event._id,
                eventTitle: event.title,
                requiresEnergy: event.requiresEnergy
            });
            return false;
        }
        return true;
    }
    
    handleInsufficientEnergy(user) {
        // Get the socket to send the tired message
        const socket = this.eventStateManager.getClientSocket(user._id.toString());
        if (socket) {
            socket.emit('console response', {
                type: 'info',
                message: "You notice something interesting might happen, but you're too tired to engage fully right now. Get some sleep."
            });
        }
        
        // Return false to allow fallback to regular chat
        return false;
    }

    async findAvailableEvents(user, actor) {
        // Find events for this actor
        const events = await this.Event.find({ actorId: actor._id })
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');

        this.logger.debug('Found events for actor:', {
            count: events.length,
            events: events.map(e => ({
                id: e._id,
                title: e.title,
                hasRequiredQuest: !!e.rootNode.requiredQuestId
            }))
        });

        // Filter events by quest requirements
        return events.filter(event => this.isEventAvailable(event, user));
    }
    
    isEventAvailable(event, user) {
        if (!event.rootNode.requiredQuestId) return true;
        
        // Check if user has the required quest active
        const hasRequiredQuest = user.quests?.some(userQuest => 
            userQuest.questId === event.rootNode.requiredQuestId._id.toString() &&
            !userQuest.completed
        );

        this.logger.debug('Quest requirement check:', {
            eventId: event._id,
            requiredQuestId: event.rootNode.requiredQuestId._id,
            hasRequiredQuest,
            requiredQuestEventId: event.rootNode.requiredQuestEventId
        });

        // If quest is required but not active, event is not available
        if (!hasRequiredQuest) {
            this.logger.debug('Event filtered out - required quest not active:', {
                eventId: event._id,
                requiredQuestId: event.rootNode.requiredQuestId._id
            });
            return false;
        }

        // If quest event ID is required, check if user is on that event
        if (event.rootNode.requiredQuestEventId) {
            return this.isUserOnRequiredQuestEvent(user, event);
        }

        return true;
    }
    
    isUserOnRequiredQuestEvent(user, event) {
        const userQuest = user.quests.find(q => 
            q.questId === event.rootNode.requiredQuestId._id.toString()
        );
        
        const isOnRequiredEvent = userQuest?.currentEventId === event.rootNode.requiredQuestEventId;
        
        this.logger.debug('Quest event ID check:', {
            eventId: event._id,
            requiredQuestEventId: event.rootNode.requiredQuestEventId,
            userCurrentEventId: userQuest?.currentEventId,
            isOnRequiredEvent
        });

        if (!isOnRequiredEvent) {
            this.logger.debug('Event filtered out - user not on required quest event:', {
                eventId: event._id,
                requiredQuestEventId: event.rootNode.requiredQuestEventId,
                userCurrentEventId: userQuest?.currentEventId
            });
            return false;
        }
        
        return true;
    }

    async startEvent(userId, event) {
        try {
            // Validate and ensure consistent quest events in the root node
            const rootNode = this.eventNodeService.validateNodeStructure(event.rootNode);
            this.eventNodeService.ensureConsistentQuestEvents(rootNode);
            
            this.logger.debug('Starting event:', {
                userId,
                eventId: event._id,
                hasActivateQuest: !!rootNode.activateQuestId,
                activateQuestId: rootNode.activateQuestId?._id?.toString()
            });

            // Get user data to check restrictions
            const user = await this.User.findById(userId);
            if (!user) {
                this.logger.error('User not found when starting event:', { userId });
                return null;
            }

            if (!this.passesNodeRestrictions(rootNode, user)) {
                return null;
            }

            // Store event state using eventStateManager
            this.eventStateManager.setActiveEvent(
                userId, 
                event._id, 
                rootNode,
                event.actorId
            );

            await this.handleQuestActivation(userId, rootNode, event.actorId);

            // Handle quest completion events
            if (rootNode.questCompletionEvents?.length > 0) {
                // Implement quest completion logic here
                // This would need to be coordinated with questService
            }

            // Pass userId to formatEventResponse
            return await this.formatEventResponse(rootNode, userId);
        } catch (error) {
            this.logger.error('Error starting event:', error);
            return null;
        }
    }
    
    passesNodeRestrictions(node, user) {
        // Check node restrictions
        if (node.restrictions?.length > 0) {
            for (const restriction of node.restrictions) {
                // 'noClass' restriction - only show if user has no class
                if (restriction === 'noClass' && user.class) {
                    this.logger.debug('Event blocked by noClass restriction:', {
                        userId: user._id.toString(),
                        userHasClass: !!user.class
                    });
                    return false;
                }
                // 'enforcerOnly' restriction - only show if user is enforcer class
                if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                    this.logger.debug('Event blocked by enforcerOnly restriction:', {
                        userId: user._id.toString(),
                        userClass: user.class?.name
                    });
                    return false;
                }
            }
        }
        return true;
    }
    
    async handleQuestActivation(userId, rootNode, actorId) {
        // Handle quest activation if specified
        if (rootNode.activateQuestId) {
            // Get the user object first
            const updatedUser = await this.User.findById(userId);
            if (!updatedUser) {
                this.logger.error('User not found when activating quest:', { userId });
                return null;
            }
            
            this.logger.debug('Activating quest from event:', {
                userId: updatedUser._id.toString(),
                questId: rootNode.activateQuestId._id.toString(),
                questTitle: rootNode.activateQuestId.title
            });

            // Pass the correct parameters
            await this.questService.handleQuestProgression(
                updatedUser,
                actorId,
                [],  // No completion events
                rootNode.activateQuestId._id  // Pass the actual quest ID
            );
        }
    }

    async handleEventChoice(userId, choice) {
        try {
            // Get active event
            const activeEvent = this.eventStateManager.getActiveEvent(userId);
            
            if (!activeEvent) {
                this.logger.debug('No active event found for user', { userId });
                return null;
            }
            
            // Delegate to the EventChoiceProcessor
            return await this.eventChoiceProcessor.processEventChoice(userId, activeEvent, choice);
        } catch (error) {
            this.logger.error('Error in handleEventChoice:', { 
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
            const user = await this.User.findById(userId);
            
            // Use the EventChoiceProcessor to filter choices
            const validChoices = this.eventChoiceProcessor.filterChoicesByRestrictions(node.choices, user);

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
        return this.eventStateManager.isInEvent(userId);
    }

    async processEventInput(userId, input) {
        this.logger.debug('processEventInput called:', { userId, input });
        
        const activeEvent = this.eventStateManager.getActiveEvent(userId);
        this.logger.debug('Active event state:', { exists: !!activeEvent, activeEvent });
        
        if (!activeEvent) {
            this.logger.debug('No active event found');
            return null;
        }

        // Load the full event from the database to get the latest data
        try {
            // Always use the Event model since there is no separate StoryEvent model
            const currentNodeId = activeEvent.currentNode._id?.toString();
            
            this.logger.debug('Finding current node from database:', {
                eventId: activeEvent.eventId,
                currentNodeId,
                isStoryEvent: activeEvent.isStoryEvent
            });

            // Use EventNodeService to load node from database
            const currentNodeFromDb = await this.eventNodeService.loadNodeFromDatabase(
                activeEvent.eventId, 
                currentNodeId
            );
            
            if (!currentNodeFromDb) {
                this.logger.error('Current node not found in event tree:', {
                    eventId: activeEvent.eventId,
                    currentNodeId
                });
                // Fall back to stored node if we can't find it in the database
                return this.handleEventChoice(userId, input);
            }
            
            this.logger.debug('Found node in database:', {
                nodeId: currentNodeFromDb._id?.toString(),
                prompt: currentNodeFromDb.prompt?.substring(0, 30) + '...',
                choicesCount: currentNodeFromDb.choices?.length || 0,
                hasQuestCompletionEvents: currentNodeFromDb.questCompletionEvents?.length > 0
            });

            // Log first few choices for debugging
            if (currentNodeFromDb.choices && currentNodeFromDb.choices.length > 0) {
                currentNodeFromDb.choices.slice(0, 3).forEach((choice, idx) => {
                    this.logger.debug(`Choice ${idx + 1} details:`, {
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
            this.logger.error('Error loading event from database:', { 
                error: error.message, 
                stack: error.stack,
                eventId: activeEvent.eventId
            });
            return null;
        }
    }
}

// Create and export an instance with default dependencies
const eventService = new EventService();
module.exports = eventService; 

// Also export the class for testing
module.exports.EventService = EventService; 