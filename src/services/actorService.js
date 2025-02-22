const Actor = require('../models/Actor');
const logger = require('../config/logger');

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

    getActorChatMessage(actor, stateKey, currentIndex) {
        const sortedMessages = [...actor.chatMessages].sort((a, b) => a.order - b.order);
        const message = sortedMessages[currentIndex];
        const nextIndex = (currentIndex + 1) % sortedMessages.length;
        
        return {
            message: message.message,
            nextIndex
        };
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