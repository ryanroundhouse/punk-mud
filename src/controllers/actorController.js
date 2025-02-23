const Actor = require('../models/Actor');
const logger = require('../config/logger');

async function getActors(req, res) {
    try {
        const actors = await Actor.find()
            .select('_id name description image location chatMessages')
            .sort({ name: 1 });
        res.json(actors);
    } catch (error) {
        logger.error('Error fetching actors:', error);
        res.status(500).json({ error: 'Error fetching actors' });
    }
}

async function getPublicActors(req, res) {
    try {
        const actors = await Actor.find()
            .select('_id name')
            .sort({ name: 1 });
        res.json(actors);
    } catch (error) {
        logger.error('Error fetching actors:', error);
        res.status(500).json({ error: 'Error fetching actors' });
    }
}

async function createOrUpdateActor(req, res) {
    try {
        const { _id, name, description, image, location, chatMessages } = req.body;
        
        if (!name || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const actorData = {
            name,
            description,
            image,
            location,
            chatMessages
        };

        let actor;
        if (_id) {
            // Update existing actor
            actor = await Actor.findByIdAndUpdate(
                _id,
                actorData,
                { new: true, runValidators: true }
            );
            if (!actor) {
                return res.status(404).json({ error: 'Actor not found' });
            }
        } else {
            // Create new actor
            actor = new Actor(actorData);
            await actor.save();
        }
        
        res.json(actor);
    } catch (error) {
        logger.error('Error saving actor:', error);
        res.status(500).json({ error: 'Error saving actor' });
    }
}

async function deleteActor(req, res) {
    try {
        const actor = await Actor.findByIdAndDelete(req.params.id);
        if (!actor) {
            return res.status(404).json({ error: 'Actor not found' });
        }
        res.json({ message: 'Actor deleted successfully' });
    } catch (error) {
        logger.error('Error deleting actor:', error);
        res.status(500).json({ error: 'Error deleting actor' });
    }
}

module.exports = {
    getActors,
    getPublicActors,
    createOrUpdateActor,
    deleteActor
}; 