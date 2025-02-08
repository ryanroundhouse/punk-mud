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
    const { id, name, description, image, location, chatMessages } = req.body;
    
    try {
        if (!name || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (id) {
            const existingActor = await Actor.findById(id);
            if (!existingActor) {
                return res.status(404).json({ error: 'Actor not found' });
            }

            existingActor.name = name;
            existingActor.description = description;
            existingActor.image = image;
            existingActor.location = location;
            existingActor.chatMessages = chatMessages;
            
            await existingActor.save();
            return res.json(existingActor);
        }

        const actor = new Actor({
            name,
            description,
            image,
            location,
            chatMessages
        });
        
        await actor.save();
        res.status(201).json(actor);
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