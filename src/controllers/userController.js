const User = require('../models/User');
const logger = require('../config/logger');

// Use the same level thresholds as characterController
const levelThresholds = [
    0,      // Level 1
    100,    // Level 2
    241,    // Level 3
    465,    // Level 4
    781,    // Level 5
    1202,   // Level 6
    1742,   // Level 7
    2415,   // Level 8
    3236,   // Level 9
    4220,   // Level 10
    5383    // Level 11
];

function calculateExpProgress(experience, level) {
    if (level >= levelThresholds.length) {
        return { current: 0, required: 0, percentage: 100 };
    }
    
    const currentLevelExp = levelThresholds[level - 1] || 0;
    const nextLevelExp = levelThresholds[level] || levelThresholds[levelThresholds.length - 1];
    const expToNext = nextLevelExp - currentLevelExp;
    const currentProgress = experience - currentLevelExp;
    const percentage = Math.min(100, Math.floor((currentProgress / expToNext) * 100));

    return {
        current: currentProgress,
        required: expToNext,
        percentage
    };
}

/**
 * Get all users
 * Accessible only by admin/builder users
 */
async function getAllUsers(req, res) {
    try {
        // Check if user is a builder
        if (!req.user.isBuilder) {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        // Get all users with minimal info for the list view
        const users = await User.find({})
            .select('_id email avatarName stats.level')
            .sort({ createdAt: -1 });

        res.json(users);
    } catch (error) {
        logger.error('Error fetching users:', error);
        res.status(500).json({ error: 'Error fetching users' });
    }
}

/**
 * Get user by ID
 * Accessible only by admin/builder users
 */
async function getUserById(req, res) {
    try {
        // Check if user is a builder
        if (!req.user.isBuilder) {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        const userId = req.params.userId;

        const user = await User.findById(userId)
            .populate('class')
            .populate('moves');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Calculate experience progress
        const expProgress = calculateExpProgress(user.stats.experience, user.stats.level);

        // Format the response to match what the frontend expects and the User model structure
        const formattedUser = {
            _id: user._id,
            email: user.email,
            avatarName: user.avatarName,
            description: user.description,
            image: user.image,
            currentNode: user.currentNode,
            isBuilder: user.isBuilder,
            stats: {
                level: user.stats.level,
                hitpoints: user.stats.hitpoints,
                maxHealth: user.stats.hitpoints, 
                health: user.stats.currentHitpoints,
                armor: user.stats.armor,
                body: user.stats.body,
                reflexes: user.stats.reflexes,
                agility: user.stats.agility,
                charisma: user.stats.charisma,
                tech: user.stats.tech,
                luck: user.stats.luck,
                experience: user.stats.experience,
                energy: user.stats.currentEnergy,
                maxEnergy: user.stats.energy
            },
            class: user.class,
            moves: user.moves,
            expProgress,
            quests: user.quests,
            activeEffects: user.activeEffects,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };

        res.json(formattedUser);
    } catch (error) {
        logger.error('Error fetching user by ID:', error);
        res.status(500).json({ error: 'Error fetching user details' });
    }
}

module.exports = {
    getAllUsers,
    getUserById,
    calculateExpProgress // Exported for testing
}; 