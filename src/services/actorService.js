class ActorService {
    constructor(deps = {}) {
        // Models
        this.Actor = deps.Actor || require('../models/Actor');
        this.User = deps.User || require('../models/User');
        
        // Services
        this.logger = deps.logger || require('../config/logger');
        
        // Avoid circular dependency with questService by using lazy loading
        this._questService = null;
    }
    
    // Getter for questService to avoid circular dependency
    get questService() {
        if (!this._questService) {
            this._questService = require('./questService');
        }
        return this._questService;
    }

    async findActorInLocation(actorName, locationId, userId = null) {
        try {
            const actors = await this.getActorsInLocation(locationId, userId);
            return actors.find(actor => 
                actor.name.toLowerCase() === actorName.toLowerCase()
            );
        } catch (error) {
            this.logger.error('Error finding actor:', error);
            throw error;
        }
    }

    async getActorsInLocation(locationId, userId = null) {
        try {
            // If userId is provided, check for quest actor overrides first
            if (userId) {
                const questActorOverrides = await this.questService.getQuestNodeActorOverrides(userId, locationId);
                
                this.logger.debug('Checking quest actor overrides for location', {
                    userId,
                    locationId,
                    hasQuestOverrides: !!questActorOverrides,
                    questOverrideCount: questActorOverrides?.length || 0
                });

                if (questActorOverrides && questActorOverrides.length > 0) {
                    const overrideActors = await this.Actor.find({
                        _id: { $in: questActorOverrides }
                    });

                    this.logger.debug('Found quest override actors', {
                        userId,
                        locationId,
                        overrideActorCount: overrideActors.length,
                        overrideActorNames: overrideActors.map(a => a.name)
                    });

                    return overrideActors;
                }
            }

            // If no overrides found or no userId provided, return regular location actors
            const regularActors = await this.Actor.find({ location: locationId });
            
            this.logger.debug('Returning regular actors for location', {
                locationId,
                userId: userId || 'none',
                actorCount: regularActors.length,
                actorNames: regularActors.map(a => a.name)
            });

            return regularActors;
        } catch (error) {
            this.logger.error('Error getting actors in location:', error);
            return [];
        }
    }

    async getActorChatMessage(actor, stateKey, currentIndex) {
        try {
            this.logger.debug('Getting chat message for actor:', {
                actorId: actor._id,
                actorName: actor.name,
                stateKey,
                currentIndex,
                chatMessagesCount: actor.chatMessages?.length || 0
            });

            const sortedMessages = [...actor.chatMessages].sort((a, b) => a.order - b.order);
            this.logger.debug('Sorted messages:', {
                messagesCount: sortedMessages.length,
                messages: sortedMessages.map(m => ({ order: m.order, message: m.message }))
            });

            const message = sortedMessages[currentIndex];
            this.logger.debug('Selected message:', {
                currentIndex,
                message: message ? {
                    order: message.order,
                    message: message.message,
                    hasQuestEvents: message.questCompletionEvents?.length > 0
                } : 'undefined'
            });

            const nextIndex = (currentIndex + 1) % sortedMessages.length;
            
            if (message.questCompletionEvents && message.questCompletionEvents.length > 0) {
                this.logger.debug('Chat message has quest completion events:', {
                    actorId: actor._id,
                    actorName: actor.name,
                    messageIndex: currentIndex,
                    completionEvents: message.questCompletionEvents
                });

                const userId = stateKey.split('_').pop();
                const user = await this.User.findById(userId);
                
                if (user) {
                    this.logger.debug('Processing chat quest completion events:', {
                        userId: user._id.toString(),
                        events: message.questCompletionEvents
                    });

                    const questUpdates = await this.questService.handleQuestProgression(
                        user,
                        actor._id.toString(),
                        message.questCompletionEvents,
                        null
                    );

                    this.logger.debug('Quest progression result:', {
                        questUpdates,
                        actorId: actor._id
                    });
                }
            }

            const result = {
                message: message?.message,
                nextIndex,
                image: actor.image
            };
            
            this.logger.debug('Returning chat message result:', {
                messageContent: result.message,
                nextIndex: result.nextIndex,
                isMessageDefined: result.message !== undefined,
                messageType: typeof result.message,
                hasImage: !!result.image
            });
            
            return result;
        } catch (error) {
            this.logger.error('Error processing actor chat message:', error);
            throw error;
        }
    }

    async findActorById(actorId) {
        try {
            return await this.Actor.findById(actorId);
        } catch (error) {
            this.logger.error('Error finding actor by ID:', error);
            throw error;
        }
    }
}

// Create a singleton instance with default dependencies
const actorService = new ActorService();

// Export both the class and the singleton instance
module.exports = actorService;
module.exports.ActorService = ActorService; 