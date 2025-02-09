const User = require('../models/User');
const Move = require('../models/Move');
const logger = require('../config/logger');

class UserService {
    async getUser(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            logger.error('Error getting user:', error);
            throw error;
        }
    }

    async getUserMoves(userId) {
        try {
            const user = await User.findById(userId).populate('moves');
            if (!user) {
                throw new Error('User not found');
            }
            return user.moves || [];
        } catch (error) {
            logger.error('Error getting user moves:', error);
            return [];
        }
    }

    async formatCombatHelp(userId) {
        const moves = await this.getUserMoves(userId);
        
        const movesList = moves
            .map(move => `${move.name} ...........${move.type === 'attack' ? 'Combat move' : 'Special move'}: ${move.helpDescription}`)
            .join('\n');

        return `
Combat Commands:
---------------
${movesList}
flee.............Attempt to escape combat
?.................Display this help message
`.trim();
    }

    async healUser(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            user.stats.currentHitpoints = user.stats.hitpoints;
            await user.save();
            
            return {
                success: true,
                healed: user.stats.hitpoints
            };
        } catch (error) {
            logger.error('Error healing user:', error);
            throw error;
        }
    }

    validateUser(user) {
        return user && user.avatarName && user.currentNode;
    }
}

const userService = new UserService();
module.exports = userService; 