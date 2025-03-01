const Mob = require('../models/Mob');
const Move = require('../models/Move');
const logger = require('../config/logger');
const Node = require('../models/Node');
const stateService = require('../services/stateService');

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
            intent,
            experiencePoints
        } = req.body;

        if (!name || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (stats && (stats.level < 1)) {
            return res.status(400).json({ error: 'Level must be at least 1' });
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
            stats: {
                ...stats,
                level: stats.level || 1,
                charisma: stats.charisma || 10
            },
            chatMessages,
            moves: moves || [],
            intent,
            experiencePoints
        };

        let savedMob;
        
        const nameConflict = await Mob.findOne({ 
            name: { $regex: new RegExp(`^${name}$`, 'i') },
            ..._id ? { _id: { $ne: _id } } : {}
        });

        if (nameConflict) {
            return res.status(400).json({ 
                error: 'A mob with this name already exists',
                code: 'DUPLICATE_NAME'
            });
        }

        if (_id) {
            savedMob = await Mob.findByIdAndUpdate(
                _id,
                mobData,
                { 
                    new: true,
                    runValidators: true
                }
            );
            
            if (!savedMob) {
                return res.status(404).json({ error: 'Mob not found' });
            }
        } else {
            const mob = new Mob(mobData);
            savedMob = await mob.save();
        }

        await savedMob.populate('moves.move');
        res.json(savedMob);

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

async function getMobsAtNode(req, res) {
    try {
        const { address } = req.params;
        logger.debug(`Attempting to find mobs at node address: ${address}`);
        logger.debug('Auth user data:', {
            user: req.user,
            avatar: req.user?.avatar,
            stats: req.user?.avatar?.stats
        });

        // Get the player's mob if they have one in this node
        const playerMob = stateService.getPlayerMob(req.user.userId);
        logger.debug('Player mob data:', {
            hasMob: !!playerMob,
            mobDetails: playerMob
        });

        let enemies = [];
        if (playerMob) {
            enemies.push({
                name: playerMob.name,
                level: playerMob.stats?.level || 1
            });
        }

        // Get player level from the authenticated user
        const playerLevel = req.user?.avatar?.stats?.level || 1;
        logger.debug('Final response data:', {
            enemyCount: enemies.length,
            enemies,
            playerLevel
        });

        res.json({
            type: 'list',
            enemies,
            playerLevel
        });
    } catch (error) {
        logger.error('Error fetching mobs at node:', error);
        logger.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error fetching mobs at node',
            details: error.message
        });
    }
}

module.exports = {
    getMobs,
    getPublicMobs,
    createOrUpdateMob,
    deleteMob,
    getMobsAtNode
}; 