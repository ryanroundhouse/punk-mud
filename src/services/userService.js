const User = require('../models/User');
const Move = require('../models/Move');
const logger = require('../config/logger');
const socketService = require('./socketService');
const stateService = require('./stateService');
const messageService = require('./messageService');

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

    async awardExperience(userId, amount) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const oldLevel = user.stats.level;
            user.stats.experience += amount;

            // Level thresholds
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

            // Check for level up
            let newLevel = oldLevel;
            while (newLevel < levelThresholds.length && user.stats.experience >= levelThresholds[newLevel]) {
                newLevel++;
            }

            // If level changed, update stats
            if (newLevel > oldLevel) {
                user.stats.level = newLevel;
                
                // Increase all stats by 1
                user.stats.body += 1;
                user.stats.reflexes += 1;
                user.stats.agility += 1;
                user.stats.charisma += 1;
                user.stats.tech += 1;
                user.stats.luck += 1;
                
                // Calculate new hitpoints using formula:
                // baseHP (20) + 3 * level + body * 2.5
                const baseHP = 20;
                const levelBonus = 3 * user.stats.level;
                const bodyBonus = Math.ceil(user.stats.body * 2.5);
                user.stats.hitpoints = baseHP + levelBonus + bodyBonus;
                user.stats.currentHitpoints = user.stats.hitpoints;

                // Send level up message using messageService
                try {
                    logger.debug('Sending level up message for user:', userId);
                    
                    messageService.sendSuccessMessage(
                        userId,
                        `Congratulations! You have reached level ${user.stats.level}!\n` +
                        `All your stats have increased by 1!\n` +
                        `Your maximum health is now ${user.stats.hitpoints} points.`
                    );
                    
                    logger.debug('Level up message sent');
                } catch (error) {
                    logger.error('Error sending level up message:', error);
                }
            }

            await user.save();

            return {
                success: true,
                experienceGained: amount,
                totalExperience: user.stats.experience,
                leveledUp: newLevel > oldLevel,
                newLevel: user.stats.level
            };
        } catch (error) {
            logger.error('Error awarding experience:', error);
            throw error;
        }
    }
}

const userService = new UserService();
module.exports = userService; 