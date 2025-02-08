const User = require('../models/User');
const logger = require('../config/logger');

async function registerAvatar(req, res) {
    try {
        const { avatarName } = req.body;
        const email = req.user.email;
        logger.info(`Registering avatar name "${avatarName}" for email: ${email}`);

        // Check if avatar name is already taken
        const existingAvatar = await User.findOne({ avatarName });
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
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image,
            stats: user.stats
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
}

async function getCharacterByUsername(req, res) {
    try {
        const character = await User.findOne({ avatarName: req.params.username });
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        res.json({
            avatarName: character.avatarName,
            description: character.description,
            image: character.image,
            stats: character.stats
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