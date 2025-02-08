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
        const mobs = await Mob.find({}, '_id name').sort({ name: 1 });
        res.json(mobs);
    } catch (error) {
        logger.error('Error fetching mobs:', error);
        res.status(500).json({ error: 'Error fetching mobs' });
    }
}

async function createOrUpdateMob(req, res) {
    try {
        const { 
            _id,
            name,
            description,
            image,
            stats,
            chatMessages,
            moves,
            intent 
        } = req.body;

        if (!name || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const mobData = {
            name,
            description,
            image,
            stats,
            chatMessages,
            moves: moves.map(move => ({
                name: move.name,
                type: move.type,
                usageChance: Number(move.usageChance),
                successChance: Number(move.successChance),
                success: {
                    message: move.success.message,
                    target: move.success.target,
                    stat: move.success.stat,
                    amount: Number(move.success.amount)
                },
                failure: {
                    message: move.failure.message,
                    target: move.failure.target,
                    stat: move.failure.stat,
                    amount: Number(move.failure.amount)
                }
            })),
            intent
        };

        if (_id) {
            const existingMob = await Mob.findById(_id);
            if (!existingMob) {
                return res.status(404).json({ error: 'Mob not found' });
            }

            Object.assign(existingMob, mobData);
            const savedMob = await existingMob.save();
            return res.json(savedMob);
        }

        const mob = new Mob(mobData);
        const savedMob = await mob.save();
        res.status(201).json(savedMob);

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