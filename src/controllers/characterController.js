const User = require('../models/User');
const logger = require('../config/logger');

// Add these level thresholds at the top of the file
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

async function registerAvatar(req, res) {
    try {
        const { avatarName } = req.body;
        const email = req.user.email;
        logger.info(`Registering avatar name "${avatarName}" for email: ${email}`);

        // Basic validation
        if (!avatarName || avatarName.trim() === '') {
            return res.status(400).json({ error: 'Avatar name is required' });
        }

        // Check if trying to use reserved name "SYSTEM" (case insensitive)
        if (avatarName.toUpperCase() === 'SYSTEM') {
            return res.status(400).json({ error: 'This avatar name is reserved' });
        }

        // Check if avatar name is already taken (case insensitive)
        const existingAvatar = await User.findOne({ 
            avatarName: { $regex: new RegExp(`^${avatarName}$`, 'i') } 
        });
        
        if (existingAvatar) {
            return res.status(400).json({ error: 'Avatar name already taken' });
        }

        // Update user with avatar name
        const user = await User.findOneAndUpdate(
            { email },
            { avatarName },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'Avatar registered successfully' });
    } catch (error) {
        logger.error('Avatar registration error:', error);
        res.status(500).json({ error: 'Failed to register avatar' });
    }
}

async function getCharacterData(req, res) {
    try {
        const user = await User.findById(req.user.userId).populate('class').populate('moves');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const expProgress = calculateExpProgress(user.stats.experience, user.stats.level);

        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image,
            stats: user.stats,
            class: user.class ? user.class.name : null,
            moves: user.moves,
            expProgress
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
}

async function getCharacterByUsername(req, res) {
    try {
        const character = await User.findOne({ avatarName: req.params.username }).populate('class').populate('moves');
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }

        const expProgress = calculateExpProgress(character.stats.experience, character.stats.level);
        
        res.json({
            avatarName: character.avatarName,
            description: character.description,
            image: character.image,
            stats: character.stats,
            class: character.class ? character.class.name : null,
            moves: character.moves,
            expProgress
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
}

async function updateCharacter(req, res) {
    try {
        const { description, image } = req.body;
        
        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { description, image },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image
        });
    } catch (error) {
        logger.error('Error updating character:', error);
        res.status(500).json({ error: 'Error updating character' });
    }
}

module.exports = {
    registerAvatar,
    getCharacterData,
    getCharacterByUsername,
    updateCharacter
}; 