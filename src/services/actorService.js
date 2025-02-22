const Actor = require('../models/Actor');
const logger = require('../config/logger');
const questService = require('./questService');
const User = require('../models/User');

class ActorService {
    async findActorInLocation(actorName, locationId) {
        try {
            return await Actor.findOne({ 
                name: new RegExp(`^${actorName}$`, 'i'), 
                location: locationId 
            });
        } catch (error) {
            logger.error('Error finding actor:', error);
            throw error;
        }
    }

    async getActorsInLocation(locationId) {
        try {
            const actors = await Actor.find({ location: locationId });
            return actors.map(actor => actor.name);
        } catch (error) {
            logger.error('Error getting actors in location:', error);
            return [];
        }
    }

    async getActorChatMessage(actor, stateKey, currentIndex) {
        try {
            const sortedMessages = [...actor.chatMessages].sort((a, b) => a.order - b.order);
            const message = sortedMessages[currentIndex];
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

            return {
                message: message.message,
                nextIndex
            };
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