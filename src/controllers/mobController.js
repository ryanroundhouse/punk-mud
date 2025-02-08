const Mob = require('../models/Mob');
const logger = require('../config/logger');

async function getMobs(req, res) {
    try {
        const mobs = await Mob.find().sort({ name: 1 });
        res.json(mobs);
    } catch (error) {
        logger.error('Error fetching mobs:', error);
        res.status(500).json({ error: 'Error fetching mobs' });
    }
}

async function getPublicMobs(req, res) {
    try {
        const mobs = await Mob.find({}, 'id name').sort({ name: 1 });
        res.json(mobs);
    } catch (error) {
        logger.error('Error fetching mobs:', error);
        res.status(500).json({ error: 'Error fetching mobs' });
    }
}

async function createOrUpdateMob(req, res) {
    const { 
        id, name, description, image, hitpoints, armor, 
        body, reflexes, agility, tech, luck, chatMessages, moves 
    } = req.body;
    
    try {
        if (!name || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (id) {
            const existingMob = await Mob.findById(id);
            if (!existingMob) {
                return res.status(404).json({ error: 'Mob not found' });
            }

            Object.assign(existingMob, {
                name,
                description,
                image,
                hitpoints,
                armor,
                body,
                reflexes,
                agility,
                tech,
                luck,
                chatMessages,
                moves
            });
            
            await existingMob.save();
            return res.json(existingMob);
        }

        const mob = new Mob({
            name,
            description,
            image,
            hitpoints,
            armor,
            body,
            reflexes,
            agility,
            tech,
            luck,
            chatMessages,
            moves
        });
        
        await mob.save();
        res.status(201).json(mob);
    } catch (error) {
        logger.error('Error saving mob:', error);
        res.status(500).json({ error: 'Error saving mob' });
    }
}

async function deleteMob(req, res) {
    try {
        const mob = await Mob.findByIdAndDelete(req.params.id);
        if (!mob) {
            return res.status(404).json({ error: 'Mob not found' });
        }
        res.json({ message: 'Mob deleted successfully' });
    } catch (error) {
        logger.error('Error deleting mob:', error);
        res.status(500).json({ error: 'Error deleting mob' });
    }
}

module.exports = {
    getMobs,
    getPublicMobs,
    createOrUpdateMob,
    deleteMob
}; 