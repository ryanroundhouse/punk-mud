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
        const systemMessageService = deps.systemMessageService || require('./systemMessageService');
        this.publishSystemMessage = deps.publishSystemMessage || systemMessageService.publishSystemMessage;
        this.systemMessageService = deps.systemMessageService || systemMessageService;
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
            
            const updates = {
                $set: {
                    'stats.currentHitpoints': user.stats.hitpoints
                }
            };

            const updatedUser = await this.User.findByIdAndUpdate(
                userId,
                updates,
                { new: true, runValidators: true }
            );

            if (!updatedUser) {
                throw new Error('Failed to heal user');
            }
            
            return {
                success: true,
                healed: updatedUser.stats.hitpoints
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
            const updates = {
                $set: {
                    'stats.currentHitpoints': user.stats.hitpoints,
                    'currentNode': '122.124.10.10'
                }
            };

            // Update the user with proper options
            const updatedUser = await this.User.findByIdAndUpdate(
                userId,
                updates,
                { new: true, runValidators: true }
            );

            if (!updatedUser) {
                throw new Error('Failed to update user after death');
            }

            // Store old node for cleanup
            const oldNode = user.currentNode;

            // Handle node subscriptions
            if (oldNode) {
                this.stateService.removeUserFromNodeAndUpdateUsernames(userId, oldNode);
                await this.socketService.unsubscribeFromNodeChat(oldNode);
            }
            await this.stateService.addUserToNodeAndUpdateUsernames(userId, updatedUser.currentNode);
            await this.socketService.subscribeToNodeChat(updatedUser.currentNode);

            // Clear ALL combat-related states
            this.stateService.clearUserCombatState(userId);
            this.stateService.clearCombatDelay(userId);
            this.stateService.clearCombatantEffects(userId);
            this.mobService.clearUserMob(userId);

            // Send the player death event through the message service
            this.messageService.sendConsoleResponse(userId, {
                type: 'player death',
                newLocation: updatedUser.currentNode
            });

            // Send player status update to update health/energy bars
            this.messageService.sendPlayerStatusMessage(
                userId,
                `HP: ${updatedUser.stats.currentHitpoints}/${updatedUser.stats.hitpoints} | Energy: ${updatedUser.stats.currentEnergy}/${updatedUser.stats.energy}`
            );

            return {
                success: true,
                newLocation: updatedUser.currentNode,
                playerDied: true
            };
        } catch (error) {
            this.logger.error('Error handling player death:', error);
            throw error;
        }
    }

    async awardExperience(userId, amount, suppressMessage = false) {
        try {
            const user = await this.User.findById(userId).populate('class');
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
            const newExperience = user.stats.experience + amount;

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
            while (newLevel < levelThresholds.length && newExperience >= levelThresholds[newLevel]) {
                newLevel++;
            }

            // Initialize result object
            const result = {
                success: true,
                levelUp: false,
                oldLevel: oldLevel,
                newLevel: newLevel,
                experienceGained: amount,
                totalExperience: newExperience
            };

            // If level changed, update stats
            if (newLevel > oldLevel) {
                // Calculate stat increases
                const updates = {
                    $set: {
                        'stats.experience': newExperience,
                        'stats.level': newLevel,
                        'stats.body': user.stats.body + 1,
                        'stats.reflexes': user.stats.reflexes + 1,
                        'stats.agility': user.stats.agility + 1,
                        'stats.charisma': user.stats.charisma + 1,
                        'stats.tech': user.stats.tech + 1,
                        'stats.luck': user.stats.luck + 1
                    }
                };

                // Calculate new hitpoints
                const baseHP = 20;
                const levelBonus = 3 * newLevel;
                const bodyBonus = Math.ceil((user.stats.body + 1) * 2.5);
                const newHitpoints = baseHP + levelBonus + bodyBonus;

                updates.$set['stats.hitpoints'] = newHitpoints;
                updates.$set['stats.currentHitpoints'] = newHitpoints;

                // Update the user with all new stats
                const updatedUser = await this.User.findByIdAndUpdate(
                    userId,
                    updates,
                    { new: true, runValidators: true }
                );

                if (!updatedUser) {
                    throw new Error('Failed to update user stats');
                }

                // Update moves for the new level
                await this.updateUserMovesForLevel(userId, newLevel);

                // Update result object with level up info
                result.levelUp = true;
                result.newHP = newHitpoints;
                
                this.logger.debug('Level up detected', {
                    userId,
                    oldLevel,
                    newLevel,
                    newHP: newHitpoints
                });

                // Send level up message using messageService if not suppressed
                if (!suppressMessage) {
                    try {
                        this.logger.debug('Sending level up message for user:', userId);
                        
                        this.messageService.sendSuccessMessage(
                            userId,
                            `Congratulations! You have reached level ${updatedUser.stats.level}!\n` +
                            `Your stats have increased!\n` +
                            `Your maximum health is now ${updatedUser.stats.hitpoints} points.`
                        );
                        
                        this.logger.debug('Level up message sent');
                    } catch (error) {
                        this.logger.error('Error sending level up message:', error);
                    }
                }
            } else {
                // Just update experience if no level up
                const updates = {
                    $set: {
                        'stats.experience': newExperience
                    }
                };

                const updatedUser = await this.User.findByIdAndUpdate(
                    userId,
                    updates,
                    { new: true, runValidators: true }
                );

                if (!updatedUser) {
                    throw new Error('Failed to update user experience');
                }
            }

            // Send player status update to update health/energy bars
            // This should be sent after the user is saved and regardless of suppressMessage
            try {
                const finalUser = await this.User.findById(userId);
                if (finalUser) {
                    this.messageService.sendPlayerStatusMessage(
                        userId,
                        `HP: ${finalUser.stats.currentHitpoints}/${finalUser.stats.hitpoints} | Energy: ${finalUser.stats.currentEnergy}/${finalUser.stats.energy}`
                    );
                }
            } catch (error) {
                this.logger.error('Error sending player status update:', error);
                // Continue execution, don't throw here
            }
            
            return result;
        } catch (error) {
            this.logger.error('Error awarding experience:', error);
            throw error;
        }
    }

    /**
     * Updates a user's moves based on their current level
     * @param {string} userId - The user's ID
     * @param {number} level - The user's new level
     * @returns {Promise<Object>} - Result of the operation
     */
    async updateUserMovesForLevel(userId, level) {
        try {
            const user = await this.User.findById(userId).populate('class');
            if (!user) {
                throw new Error('User not found');
            }

            if (!user.class) {
                this.logger.debug('User has no class assigned, skipping move update');
                return { success: false, message: 'No class assigned' };
            }

            // Get the class with populated moveGrowth
            const classDoc = await this.Class.findById(user.class).populate('moveGrowth.move');
            if (!classDoc) {
                throw new Error('Class not found');
            }

            // Get all moves the user should have at their current level
            const availableMoves = classDoc.moveGrowth
                .filter(mg => mg.level <= level)
                .map(mg => mg.move._id);

            // Get newly unlocked moves
            const newMoves = classDoc.moveGrowth
                .filter(mg => mg.level <= level && mg.level > (level - 1))
                .map(mg => mg.move);

            // Update the user's moves
            user.moves = availableMoves;
            await user.save();

            // Send notification about new moves if any were unlocked
            if (newMoves.length > 0) {
                const moveNames = newMoves.map(move => move.name).join(', ');
                this.messageService.sendSuccessMessage(
                    userId,
                    `You've unlocked new ${newMoves.length > 1 ? 'moves' : 'a move'}: ${moveNames}!`
                );
            }

            this.logger.debug('Updated user moves for level', {
                userId, 
                level, 
                moveCount: availableMoves.length,
                newMoveCount: newMoves.length
            });

            return {
                success: true,
                moveCount: availableMoves.length,
                newMoves: newMoves.map(move => move.name)
            };
        } catch (error) {
            this.logger.error('Error updating user moves for level:', error);
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

            // Log the node addresses
            this.logger.debug('Node addresses for movement:', {
                oldNode,
                newNode: targetNode.address,
                userIdString: userId.toString(),
                userName: user.avatarName
            });

            await user.save();

            // Handle node client management
            this.stateService.removeUserFromNodeAndUpdateUsernames(userId, oldNode);
            await this.stateService.addUserToNodeAndUpdateUsernames(userId, targetNode.address);
            
            // Update chat subscriptions - unsubscribe from old node and subscribe to new one
            if (oldNode) {
                await this.socketService.unsubscribeFromNodeChat(oldNode);
            }
            await this.socketService.subscribeToNodeChat(targetNode.address);

            // Send movement messages using the new dedicated function
            await this.systemMessageService.publishUserMoveSystemMessage(
                oldNode,
                targetNode.address,
                user
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