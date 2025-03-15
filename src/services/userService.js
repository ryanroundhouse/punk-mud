class UserService {
    constructor(deps = {}) {
        // Models
        this.User = deps.User || require('../models/User');
        this.Class = deps.Class || require('../models/Class');
        this.Event = deps.Event || require('../models/Event');
        
        // Services
        this.logger = deps.logger || require('../config/logger');
        this.socketService = deps.socketService || require('./socketService');
        this.stateService = deps.stateService || require('./stateService');
        this.messageService = deps.messageService || require('./messageService');
        this.nodeService = deps.nodeService || require('./nodeService');
        this.mobService = deps.mobService || require('./mobService');
        this.eventService = deps.eventService || require('./eventService');
        this.questService = deps.questService || require('./questService');
        
        // Functions
        const chatService = deps.chatService || require('./chatService');
        this.publishSystemMessage = deps.publishSystemMessage || chatService.publishSystemMessage;
    }

    async getUser(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            this.logger.error('Error getting user:', error);
            throw error;
        }
    }

    async getUserMoves(userId) {
        try {
            const user = await this.User.findById(userId).populate('moves');
            if (!user) {
                throw new Error('User not found');
            }
            return user.moves || [];
        } catch (error) {
            this.logger.error('Error getting user moves:', error);
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
            const user = await this.User.findById(userId);
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
            this.logger.error('Error healing user:', error);
            throw error;
        }
    }

    validateUser(user) {
        // Cast the result to a boolean to ensure we return true/false
        return Boolean(user && user.avatarName && user.currentNode);
    }

    async handlePlayerDeath(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Heal the player
            user.stats.currentHitpoints = user.stats.hitpoints;

            // Move player to Neon Plaza
            const oldNode = user.currentNode;
            user.currentNode = '122.124.10.10';

            await user.save();

            // Handle node subscriptions
            if (oldNode) {
                this.stateService.removeUserFromNode(userId, oldNode);
                await this.socketService.unsubscribeFromNodeChat(oldNode);
            }
            this.stateService.addUserToNode(userId, user.currentNode);
            await this.socketService.subscribeToNodeChat(user.currentNode);

            // Clear ALL combat-related states
            this.stateService.clearUserCombatState(userId);
            this.stateService.clearCombatDelay(userId);
            this.stateService.clearCombatantEffects(userId);
            this.mobService.clearUserMob(userId);

            // Send the player death event through the message service
            this.messageService.sendConsoleResponse(userId, {
                type: 'player death',
                newLocation: user.currentNode
            });

            return {
                success: true,
                newLocation: user.currentNode,
                playerDied: true
            };
        } catch (error) {
            this.logger.error('Error handling player death:', error);
            throw error;
        }
    }

    async awardExperience(userId, amount, suppressMessage = false) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Check if player is dead
            if (user.stats.currentHitpoints <= 0) {
                await this.handlePlayerDeath(userId);
                return {
                    success: false,
                    message: 'Player was defeated'
                };
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

            // Initialize result object
            const result = {
                success: true,
                levelUp: false,
                oldLevel: oldLevel,
                newLevel: newLevel
            };

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

                // Update result object with level up info
                result.levelUp = true;
                result.newHP = user.stats.hitpoints;
                
                this.logger.debug('Level up detected', {
                    userId,
                    oldLevel,
                    newLevel,
                    newHP: user.stats.hitpoints
                });

                // Send level up message using messageService if not suppressed
                if (!suppressMessage) {
                    try {
                        this.logger.debug('Sending level up message for user:', userId);
                        
                        this.messageService.sendSuccessMessage(
                            userId,
                            `Congratulations! You have reached level ${user.stats.level}!\n` +
                            `All your stats have increased by 1!\n` +
                            `Your maximum health is now ${user.stats.hitpoints} points.`
                        );
                        
                        this.logger.debug('Level up message sent');
                    } catch (error) {
                        this.logger.error('Error sending level up message:', error);
                    }
                }
            }

            await user.save();

            // Add additional information to the result
            result.experienceGained = amount;
            result.totalExperience = user.stats.experience;
            
            this.logger.debug('Returning experience result', {
                userId,
                success: result.success,
                levelUp: result.levelUp,
                oldLevel: result.oldLevel,
                newLevel: result.newLevel,
                newHP: result.newHP
            });
            
            return result;
        } catch (error) {
            this.logger.error('Error awarding experience:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async setUserClass(userId, classId) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const classDoc = await this.Class.findById(classId).populate('moveGrowth.move');
            if (!classDoc) {
                throw new Error('Class not found');
            }

            // Store the class
            user.class = classDoc._id;

            // Reset all stats to 1 first
            const stats = ['body', 'reflexes', 'agility', 'tech', 'luck', 'charisma'];
            stats.forEach(stat => {
                user.stats[stat] = 1;
            });

            // Calculate level-based stat bonuses
            const level = user.stats.level;
            stats.forEach(stat => {
                let bonus = level; // Base +1 per level for all stats

                if (stat === classDoc.primaryStat) {
                    bonus += level * 2; // Additional +2 for primary stat (+3 total)
                } else if (classDoc.secondaryStats.includes(stat)) {
                    bonus += level; // Additional +1 for secondary stats (+2 total)
                }

                user.stats[stat] += bonus;
            });

            // Calculate hitpoints
            const baseHP = classDoc.baseHitpoints;
            const levelBonus = classDoc.hpPerLevel * level;
            const bodyBonus = Math.ceil(classDoc.hpPerBod * user.stats.body);
            user.stats.hitpoints = baseHP + levelBonus + bodyBonus;
            user.stats.currentHitpoints = user.stats.hitpoints;

            // Set moves based on level
            const availableMoves = classDoc.moveGrowth
                .filter(mg => mg.level <= level)
                .map(mg => mg.move._id);
            user.moves = availableMoves;

            await user.save();

            this.logger.debug('User class set successfully:', {
                userId: user._id,
                className: classDoc.name,
                level: level,
                hitpoints: user.stats.hitpoints,
                primaryStat: classDoc.primaryStat,
                secondaryStats: classDoc.secondaryStats,
                moveCount: availableMoves.length
            });

            return {
                success: true,
                className: classDoc.name,
                stats: user.stats,
                moveCount: availableMoves.length
            };
        } catch (error) {
            this.logger.error('Error setting user class:', error);
            throw error;
        }
    }

    async getUserLevel(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }
            return user.stats.level;
        } catch (error) {
            this.logger.error('Error getting user level:', error);
            throw error;
        }
    }

    async moveUserToNode(userId, direction, targetNode) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            this.logger.debug('Moving user to node:', {
                userId,
                fromNode: user.currentNode,
                toNode: targetNode.address,
                hasActorOverrides: !!targetNode.actors,
                actorOverrideCount: targetNode.actors?.length || 0,
                actorIds: targetNode.actors?.map(a => a.actorId) || []
            });

            const oldNode = user.currentNode;
            user.currentNode = targetNode.address;

            await user.save();

            // Handle node client management
            this.stateService.removeUserFromNode(userId, oldNode);
            this.stateService.addUserToNode(userId, targetNode.address);

            // Send movement messages
            await this.publishSystemMessage(oldNode, `${user.avatarName} has left.`);
            await this.publishSystemMessage(
                targetNode.address,
                `${user.avatarName} has arrived.`,
                `You have entered ${targetNode.name}.`,
                userId
            );

            // Clear any existing mob and check for new spawn
            this.mobService.clearUserMob(userId);
        } catch (error) {
            this.logger.error('Error moving user to node:', error);
            throw error;
        }
    }
}

// Export a singleton instance with default dependencies
const userService = new UserService();
module.exports = userService;

// Also export the class for testing purposes
module.exports.UserService = UserService; 