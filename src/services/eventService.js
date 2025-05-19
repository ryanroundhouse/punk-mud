const logger = require('../config/logger');
const Event = require('../models/Event');
const stateService = require('./stateService');
const User = require('../models/User');
const mongoose = require('mongoose');
const eventNodeService = require('./eventNodeService');
const eventStateManager = require('./eventStateManager');
const eventChoiceProcessor = require('./eventChoiceProcessor');
const systemMessageService = require('./systemMessageService');
const actorService = require('./actorService');

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
        this.systemMessageService = dependencies.systemMessageService || systemMessageService;
        this.actorService = dependencies.actorService || actorService;
        
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
        // Check for blockIfQuestEventIds first - if any are completed, the event is blocked
        if (event.rootNode.blockIfQuestEventIds && event.rootNode.blockIfQuestEventIds.length > 0) {
            // Collect all completed quest event IDs from the user
            const completedQuestEventIds = [];
            const currentQuestEventIds = [];
            
            if (user.quests && Array.isArray(user.quests)) {
                user.quests.forEach(userQuest => {
                    // Add completed event IDs
                    if (userQuest.completedEventIds && Array.isArray(userQuest.completedEventIds)) {
                        completedQuestEventIds.push(...userQuest.completedEventIds);
                    }
                    
                    // Add current event ID if it exists
                    if (userQuest.currentEventId) {
                        currentQuestEventIds.push(userQuest.currentEventId);
                    }
                });
            }
            
            // Check if user has completed any of the blocking quest events
            // or if user's current event ID matches any blocking quest event
            const hasCompletedBlockingEvent = event.rootNode.blockIfQuestEventIds.some(eventId => 
                completedQuestEventIds.includes(eventId) || currentQuestEventIds.includes(eventId)
            );
            
            if (hasCompletedBlockingEvent) {
                this.logger.debug('Event filtered out - blocked by completed or current quest events:', {
                    eventId: event._id,
                    eventTitle: event.title,
                    blockingEventIds: event.rootNode.blockIfQuestEventIds,
                    userCompletedEvents: completedQuestEventIds.filter(id => 
                        event.rootNode.blockIfQuestEventIds.includes(id)
                    ),
                    userCurrentEvents: currentQuestEventIds.filter(id =>
                        event.rootNode.blockIfQuestEventIds.includes(id)
                    )
                });
                return false;
            }
        }

        // If there's no required quest, the event is available
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
            // rootNode is directly from the event object, assumed to be pristine from DB
            const rootNode = event.rootNode; 
            
            if (!rootNode || !rootNode._id) {
                this.logger.error('Event has no rootNode or rootNode._id, cannot start', { eventId: event._id });
                return null;
            }
            const rootNodeId = rootNode._id.toString();

            this.logger.debug('Starting event with rootNodeId:', {
                userId,
                eventId: event._id,
                rootNodeId,
                hasActivateQuest: !!rootNode.activateQuestId,
                activateQuestId: rootNode.activateQuestId?._id?.toString()
            });

            const user = await this.User.findById(userId);
            if (!user) {
                this.logger.error('User not found when starting event:', { userId });
                return null;
            }

            // Pass rootNode (object) for initial restriction checks
            if (!this.passesNodeRestrictions(rootNode, user)) {
                return null;
            }

            // Store event state using eventStateManager with IDs
            this.eventStateManager.setActiveEvent(
                userId, 
                event._id.toString(), 
                rootNodeId, // Pass rootNodeId
                event.actorId ? event.actorId.toString() : null
                // isStoryEvent can be added if it's part of the 'event' object schema
            );

            // Pass rootNode (object) for quest activation
            await this.handleQuestActivation(userId, rootNode, event.actorId);

            // rootNode.questCompletionEvents would be checked here if starting an event
            // could immediately complete a quest step (usually not the case for rootNode).
            // This logic might need to be in eventChoiceProcessor if choices from root can complete quests.

            if (this.actorService && this.systemMessageService && 
                typeof this.actorService.findActorById === 'function' && 
                typeof this.systemMessageService.publishEventSystemMessage === 'function') {
                
                try {
                    const actor = await this.actorService.findActorById(event.actorId);
                    if (actor && user.currentNode) {
                        await this.systemMessageService.publishEventSystemMessage(
                            user.currentNode,
                            {
                                message: `${user.avatarName || 'Someone'} is engaged in a conversation with ${actor.name}.`
                            },
                            user,
                            actor.name,
                            event.title
                        );
                    }
                } catch (err) {
                    this.logger.error('Error publishing system message for event start:', err);
                }
            }

            // Pass rootNode (object) for initial response formatting
            return await this.eventChoiceProcessor.formatEventResponse(rootNode, userId);
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
        
        // Check blockIfQuestEventIds - block event if user has completed any of these quest events
        if (node.blockIfQuestEventIds && node.blockIfQuestEventIds.length > 0) {
            // Collect all completed quest event IDs from the user
            const completedQuestEventIds = [];
            const currentQuestEventIds = [];
            
            if (user.quests && Array.isArray(user.quests)) {
                user.quests.forEach(userQuest => {
                    // Add completed event IDs
                    if (userQuest.completedEventIds && Array.isArray(userQuest.completedEventIds)) {
                        completedQuestEventIds.push(...userQuest.completedEventIds);
                    }
                    
                    // Add current event ID if it exists
                    if (userQuest.currentEventId) {
                        currentQuestEventIds.push(userQuest.currentEventId);
                    }
                });
            }
            
            // Check if user has completed any of the blocking quest events
            // or if user's current event ID matches any blocking quest event
            const hasBlockingEvent = node.blockIfQuestEventIds.some(eventId => 
                completedQuestEventIds.includes(eventId) || currentQuestEventIds.includes(eventId)
            );
            
            if (hasBlockingEvent) {
                this.logger.debug('Event blocked by blockIfQuestEventIds:', {
                    userId: user._id.toString(),
                    blockingEventIds: node.blockIfQuestEventIds,
                    userCompletedEvents: completedQuestEventIds.filter(id => 
                        node.blockIfQuestEventIds.includes(id)
                    ),
                    userCurrentEvents: currentQuestEventIds.filter(id =>
                        node.blockIfQuestEventIds.includes(id)
                    )
                });
                return false;
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

    async handleEventChoice(userId, choiceInput) {
        try {
            // Get active event IDs from state manager
            const activeEventState = this.eventStateManager.getActiveEvent(userId);
            
            if (!activeEventState) {
                this.logger.debug('No active event found for user', { userId });
                return null;
            }
            
            // Delegate to the EventChoiceProcessor, passing the activeEventState (with IDs)
            // and the user's choiceInput.
            return await this.eventChoiceProcessor.processEventChoice(userId, activeEventState, choiceInput);
        } catch (error) {
            this.logger.error('Error in handleEventChoice:', { 
                error: error.message, 
                stack: error.stack,
                userId
            });
            return null;
        }
    }

    isInEvent(userId) {
        return this.eventStateManager.isInEvent(userId);
    }

    async processEventInput(userId, input) {
        this.logger.debug('processEventInput called:', { userId, input });
        
        // activeEventState now contains { eventId, currentNodeId, actorId, nodeHistory, isStoryEvent }
        const activeEventState = this.eventStateManager.getActiveEvent(userId);
        this.logger.debug('Active event state from manager:', { exists: !!activeEventState, activeEventState });
        
        if (!activeEventState) {
            this.logger.debug('No active event found in processEventInput');
            return null;
        }

        try {
            // eventId and currentNodeId are from activeEventState
            const { eventId, currentNodeId } = activeEventState;

            this.logger.debug('Processing input for node from database:', {
                eventId,
                currentNodeId,
                isStoryEvent: activeEventState.isStoryEvent
            });

            // Directly call handleEventChoice which will now internally load the node if needed
            // or be refactored to accept the loaded node.
            // For now, we assume processEventChoice in eventChoiceProcessor will handle loading.
            return await this.handleEventChoice(userId, input);

        } catch (error) {
            this.logger.error('Error processing event input:', { 
                error: error.message, 
                stack: error.stack,
                eventId: activeEventState ? activeEventState.eventId : 'unknown'
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