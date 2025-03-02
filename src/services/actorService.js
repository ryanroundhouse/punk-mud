const Actor = require('../models/Actor');
const logger = require('../config/logger');
const questService = require('./questService');
const User = require('../models/User');

class ActorService {
    async findActorInLocation(actorName, locationId, userId = null) {
        try {
            const actors = await this.getActorsInLocation(locationId, userId);
            return actors.find(actor => 
                actor.name.toLowerCase() === actorName.toLowerCase()
            );
        } catch (error) {
            logger.error('Error finding actor:', error);
            throw error;
        }
    }

    async getActorsInLocation(locationId, userId = null) {
        try {
            // If userId is provided, check for quest actor overrides first
            if (userId) {
                const questActorOverrides = await questService.getQuestNodeActorOverrides(userId, locationId);
                
                logger.debug('Checking quest actor overrides for location', {
                    userId,
                    locationId,
                    hasQuestOverrides: !!questActorOverrides,
                    questOverrideCount: questActorOverrides?.length || 0
                });

                if (questActorOverrides && questActorOverrides.length > 0) {
                    const overrideActors = await Actor.find({
                        _id: { $in: questActorOverrides }
                    });

                    logger.debug('Found quest override actors', {
                        userId,
                        locationId,
                        overrideActorCount: overrideActors.length,
                        overrideActorNames: overrideActors.map(a => a.name)
                    });

                    return overrideActors;
                }
            }

            // If no overrides found or no userId provided, return regular location actors
            const regularActors = await Actor.find({ location: locationId });
            
            logger.debug('Returning regular actors for location', {
                locationId,
                userId: userId || 'none',
                actorCount: regularActors.length,
                actorNames: regularActors.map(a => a.name)
            });

            return regularActors;
        } catch (error) {
            logger.error('Error getting actors in location:', error);
            return [];
        }
    }

    async getActorChatMessage(actor, stateKey, currentIndex) {
        try {
            logger.debug('Getting chat message for actor:', {
                actorId: actor._id,
                actorName: actor.name,
                stateKey,
                currentIndex,
                chatMessagesCount: actor.chatMessages?.length || 0
            });

            const sortedMessages = [...actor.chatMessages].sort((a, b) => a.order - b.order);
            logger.debug('Sorted messages:', {
                messagesCount: sortedMessages.length,
                messages: sortedMessages.map(m => ({ order: m.order, message: m.message }))
            });

            const message = sortedMessages[currentIndex];
            logger.debug('Selected message:', {
                currentIndex,
                message: message ? {
                    order: message.order,
                    message: message.message,
                    hasQuestEvents: message.questCompletionEvents?.length > 0
                } : 'undefined'
            });

            const nextIndex = (currentIndex + 1) % sortedMessages.length;
            
            if (message.questCompletionEvents && message.questCompletionEvents.length > 0) {
                logger.debug('Chat message has quest completion events:', {
                    actorId: actor._id,
                    actorName: actor.name,
                    messageIndex: currentIndex,
                    completionEvents: message.questCompletionEvents
                });

                const userId = stateKey.split('_').pop();
                const user = await User.findById(userId);
                
                if (user) {
                    logger.debug('Processing chat quest completion events:', {
                        userId: user._id.toString(),
                        events: message.questCompletionEvents
                    });

                    const questUpdates = await questService.handleQuestProgression(
                        user,
                        actor._id.toString(),
                        message.questCompletionEvents,
                        null
                    );

                    logger.debug('Quest progression result:', {
                        questUpdates,
                        actorId: actor._id
                    });
                }
            }

            const result = {
                message: message?.message,
                nextIndex
            };
            
            logger.debug('Returning chat message result:', {
                messageContent: result.message,
                nextIndex: result.nextIndex,
                isMessageDefined: result.message !== undefined,
                messageType: typeof result.message
            });
            
            return result;
        } catch (error) {
            logger.error('Error processing actor chat message:', error);
            throw error;
        }
    }

    async findActorById(actorId) {
        try {
            return await Actor.findById(actorId);
        } catch (error) {
            logger.error('Error finding actor by ID:', error);
            throw error;
        }
    }
}

const actorService = new ActorService();
module.exports = actorService; 