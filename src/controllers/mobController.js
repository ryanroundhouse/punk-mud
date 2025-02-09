const Mob = require('../models/Mob');
const Move = require('../models/Move');
const logger = require('../config/logger');

async function getMobs(req, res) {
    try {
        const mobs = await Mob.find()
            .populate('moves.move')
            .sort({ name: 1 });
        res.json(mobs);
    } catch (error) {
        logger.error('Error fetching mobs:', error);
        res.status(500).json({ error: 'Error fetching mobs' });
    }
}

async function getPublicMobs(req, res) {
    try {
        const mobs = await Mob.find({}, '_id name')
            .sort({ name: 1 });
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

        if (moves) {
            for (const moveRef of moves) {
                if (!moveRef.move || !moveRef.usageChance) {
                    return res.status(400).json({ error: 'Invalid move data' });
                }

                const moveExists = await Move.findById(moveRef.move);
                if (!moveExists) {
                    return res.status(400).json({ error: `Move with ID ${moveRef.move} not found` });
                }

                if (moveRef.usageChance < 0 || moveRef.usageChance > 100) {
                    return res.status(400).json({ error: 'Usage chance must be between 0 and 100' });
                }
            }

            const totalUsage = moves.reduce((sum, move) => sum + move.usageChance, 0);
            if (totalUsage !== 100) {
                return res.status(400).json({ 
                    error: 'Total move usage chance must equal 100%',
                    details: `Current total: ${totalUsage}%`
                });
            }
        }

        const mobData = {
            name,
            description,
            image,
            stats,
            chatMessages,
            moves,
            intent
        };

        if (_id) {
            const existingMob = await Mob.findById(_id);
            if (!existingMob) {
                return res.status(404).json({ error: 'Mob not found' });
            }

            Object.assign(existingMob, mobData);
            const savedMob = await existingMob.save();
            return res.json(await savedMob.populate('moves.move'));
        }

        const mob = new Mob(mobData);
        const savedMob = await mob.save();
        res.status(201).json(await savedMob.populate('moves.move'));

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