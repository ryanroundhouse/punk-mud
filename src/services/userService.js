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

    async awardExperience(userId, amount) {
        try {
            let user = await this.User.findById(userId).populate('class');
            if (!user) {
                throw new Error('User not found');
            }

            if (user.stats.currentHitpoints <= 0) {
                await this.handlePlayerDeath(userId); // This might send its own messages
                return {
                    success: false,
                    messages: ['Player was defeated.'],
                    leveledUp: false
                };
            }

            const messagesToReturn = [];
            const oldLevel = user.stats.level;
            const newExperience = user.stats.experience + amount;

            messagesToReturn.push(`You gained ${amount} experience points!`);

            const levelThresholds = [
                0, 100, 241, 465, 781, 1202, 1742, 2415, 3236, 4220, 5383
            ];

            let newLevel = oldLevel;
            while (newLevel < levelThresholds.length && newExperience >= levelThresholds[newLevel]) {
                newLevel++;
            }

            const result = {
                success: true,
                leveledUp: false,
                oldLevel: oldLevel,
                newLevel: newLevel,
                experienceGained: amount,
                totalExperience: newExperience,
                messages: [], // Will be populated
                statIncreasesMessage: '', 
                newMovesMessage: ''       
            };

            if (newLevel > oldLevel) {
                result.leveledUp = true;
                messagesToReturn.push(`Congratulations! You have reached level ${newLevel}!`);

                const userUpdates = {
                    $set: {
                        'stats.experience': newExperience,
                        'stats.level': newLevel,
                        // HP will be set based on new body stat
                    },
                    $inc: {
                        'stats.body': 1,
                        'stats.reflexes': 1,
                        'stats.agility': 1,
                        'stats.charisma': 1,
                        'stats.tech': 1,
                        'stats.luck': 1
                    }
                };
                
                // Calculate new HP based on the incremented body stat
                const newBodyStat = user.stats.body + 1;
                const baseHP = 20; 
                const levelBonusHP = 3 * newLevel; 
                const bodyBonusHP = Math.ceil(newBodyStat * 2.5); 
                const newHitpoints = baseHP + levelBonusHP + bodyBonusHP;

                userUpdates.$set['stats.hitpoints'] = newHitpoints;
                userUpdates.$set['stats.currentHitpoints'] = newHitpoints; // Heal to full

                const updatedUser = await this.User.findByIdAndUpdate(userId, userUpdates, { new: true, runValidators: true });
                if (!updatedUser) {
                    throw new Error("Failed to update user stats on level up.");
                }
                user = updatedUser; // Refresh local user variable

                messagesToReturn.push("Your stats have increased!");
                messagesToReturn.push(`Your maximum health is now ${newHitpoints} points.`);
                result.statIncreasesMessage = `Your stats have increased! Your maximum health is now ${newHitpoints} points.`;

                const moveUpdateResult = await this.updateUserMovesForLevel(userId, newLevel); // userId is updatedUser._id
                if (moveUpdateResult.success && moveUpdateResult.messages.length > 0) {
                    messagesToReturn.push(...moveUpdateResult.messages);
                    if (moveUpdateResult.newMoves.length > 0) {
                         result.newMovesMessage = moveUpdateResult.messages.join(' '); // Use the actual message
                    }
                }
                
                this.messageService.sendPlayerStatusMessage(
                    userId,
                    `HP: ${newHitpoints}/${newHitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
                );

            } else {
                // No level up, just update experience
                user = await this.User.findByIdAndUpdate(userId, { $set: { 'stats.experience': newExperience } }, {new: true });
            }
            
            result.messages = messagesToReturn;
            this.logger.debug('Experience awarded', result);
            return result;

        } catch (error) {
            this.logger.error('Error awarding experience:', error, { userId, amount });
            return {
                success: false,
                messages: [`Error awarding experience: ${error.message}`],
                leveledUp: false,
                error: error.message
            };
        }
    }

    async updateUserMovesForLevel(userId, level) {
        try {
            const user = await this.User.findById(userId).populate('class');
            if (!user) {
                throw new Error('User not found');
            }

            const messagesToReturn = [];
            let newMovesLearned = [];

            if (!user.class) {
                this.logger.debug('User has no class assigned, skipping move update');
                return { success: true, messages: [], newMoves: [], moveCount: user.moves.length };
            }

            const classDoc = await this.Class.findById(user.class._id).populate('moveGrowth.move');
            if (!classDoc) {
                throw new Error('Class not found');
            }

            const currentMoveIds = new Set(user.moves.map(m => m.toString()));
            const allPotentialMovesForLevel = classDoc.moveGrowth
                .filter(mg => mg.level <= level)
                .map(mg => mg.move);

            const finalMoveIds = [];
            for (const move of allPotentialMovesForLevel) {
                if (move && move._id) { // Ensure move and move._id are valid
                    finalMoveIds.push(move._id);
                    if (!currentMoveIds.has(move._id.toString())) {
                        newMovesLearned.push(move);
                    }
                }
            }
            
            user.moves = finalMoveIds;
            await user.save();

            if (newMovesLearned.length > 0) {
                const moveNames = newMovesLearned.map(move => move.name).join(', ');
                messagesToReturn.push(`You've unlocked new ${newMovesLearned.length > 1 ? 'moves' : 'a move'}: ${moveNames}!`);
            }

            this.logger.debug('Updated user moves for level', {
                userId, 
                level, 
                moveCount: user.moves.length,
                newMoveCount: newMovesLearned.length
            });

            return {
                success: true,
                messages: messagesToReturn,
                newMoves: newMovesLearned.map(move => move.name),
                moveCount: user.moves.length
            };
        } catch (error) {
            this.logger.error('Error updating user moves for level:', error);
            return {
                success: false,
                messages: [`Error updating moves: ${error.message}`],
                newMoves: [],
                error: error.message
            };
        }
    }

    async setUserClass(userId, classId) {
        try {
            let user = await this.User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const classDoc = await this.Class.findById(classId).populate('moveGrowth.move');
            if (!classDoc) {
                throw new Error('Class not found');
            }
            
            const messagesToReturn = [];
            messagesToReturn.push(`You have gained the ${classDoc.name} class!`);

            user.class = classDoc._id;
            user.moves = []; // Reset moves, they will be added by updateUserMovesForLevel

            const statsToUpdate = ['body', 'reflexes', 'agility', 'tech', 'luck', 'charisma'];
            statsToUpdate.forEach(stat => {
                user.stats[stat] = 1; // Base stat
            });

            const currentLevel = user.stats.level; // Use user's current level
            statsToUpdate.forEach(stat => {
                let bonus = currentLevel; 
                if (stat === classDoc.primaryStat) {
                    bonus += currentLevel * 2; 
                } else if (classDoc.secondaryStats.includes(stat)) {
                    bonus += currentLevel; 
                }
                user.stats[stat] += bonus;
            });

            const baseHP = classDoc.baseHitpoints;
            const levelBonusHP = classDoc.hpPerLevel * currentLevel;
            const bodyBonusHP = Math.ceil(classDoc.hpPerBod * user.stats.body);
            user.stats.hitpoints = baseHP + levelBonusHP + bodyBonusHP;
            user.stats.currentHitpoints = user.stats.hitpoints; 

            // Save user to persist class and stat changes BEFORE updating moves,
            // so updateUserMovesForLevel reads the correct class.
            await user.save(); 
            user = await this.User.findById(userId).populate('class'); // Re-fetch to ensure populated class for updateUserMovesForLevel

            const moveUpdateResult = await this.updateUserMovesForLevel(userId, currentLevel);
            if (moveUpdateResult.success && moveUpdateResult.messages.length > 0) {
                messagesToReturn.push(...moveUpdateResult.messages);
            }
            // user.moves is already saved by updateUserMovesForLevel

            messagesToReturn.push(`Your maximum health is now ${user.stats.hitpoints} points.`);
            if (moveUpdateResult.success) {
                 if (moveUpdateResult.newMoves.length === 0) { // Only add this if no "new moves" message was added
                    messagesToReturn.push(`You have ${moveUpdateResult.moveCount} class moves.`);
                 }
            }
            
            this.logger.debug('User class set successfully:', {
                userId: user._id,
                className: classDoc.name,
                level: currentLevel,
                hitpoints: user.stats.hitpoints,
                moveCount: user.moves.length
            });

            return {
                success: true,
                messages: messagesToReturn,
                className: classDoc.name,
                stats: user.stats, 
                moveCount: user.moves.length 
            };
        } catch (error) {
            this.logger.error('Error setting user class:', error);
            return {
                success: false,
                messages: [`Error setting class: ${error.message}`],
                error: error.message
            };
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

            this.logger.debug('Node addresses for movement:', {
                oldNode,
                newNode: targetNode.address,
                userIdString: userId.toString(),
                userName: user.avatarName
            });

            await user.save();

            this.stateService.removeUserFromNodeAndUpdateUsernames(userId, oldNode);
            await this.stateService.addUserToNodeAndUpdateUsernames(userId, targetNode.address);
            
            if (oldNode) {
                await this.socketService.unsubscribeFromNodeChat(oldNode);
            }
            await this.socketService.subscribeToNodeChat(targetNode.address);

            await this.systemMessageService.publishUserMoveSystemMessage(
                oldNode,
                targetNode.address,
                user
            );

            this.mobService.clearUserMob(userId);
        } catch (error) {
            this.logger.error('Error moving user to node:', error);
            throw error;
        }
    }

    async resetCharacter(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user) {
                this.logger.warn(`User not found for resetCharacter: ${userId}`);
                return { success: false, error: 'User not found' };
            }
    
            const defaultUser = new this.User(); // Creates a new user instance with defaults
    
            // Preserve specific fields
            const preservedFields = {
                email: user.email,
                avatarName: user.avatarName,
                description: user.description,
                image: user.image, // User's avatar image, not node image
                authCode: user.authCode,
                isBuilder: user.isBuilder,
                // Preserve existing inventory, gold, quests, and completed events
                inventory: user.inventory,
                gold: user.gold,
                roles: user.roles, // Preserve roles
                // _id, createdAt, updatedAt are inherently preserved or managed by mongoose
            };
    
            // Reset stats, class, moves, current node, etc., to defaults
            user.stats = defaultUser.stats;
            user.class = defaultUser.class; // This will be null or ObjectId if there's a default class
            user.quests = defaultUser.quests;
            user.moves = ["67e5ee92505d5890de625149"];
            user.currentNode = defaultUser.currentNode; // Reset to default starting node
            user.state = defaultUser.state;
            
            // Re-apply preserved fields
            for (const key in preservedFields) {
                if (preservedFields.hasOwnProperty(key)) {
                    user[key] = preservedFields[key];
                }
            }

            // If there's a default class defined in the schema, try to apply it
            // (Assuming defaultUser.class might be set by schema defaults if applicable)
            if (user.class) { // if a default class ID was set
                const classUpdateResult = await this.setUserClass(userId, user.class);
                // setUserClass now returns messages, but for resetCharacter, we have a generic message.
                // We could potentially incorporate class specific messages if desired in future.
                if (!classUpdateResult.success) {
                     this.logger.warn(`Failed to apply default class during resetCharacter for user ${userId}: ${classUpdateResult.error}`);
                     // Continue with reset even if class application fails
                }
            } else {
                 // Ensure stats are set correctly even if no default class (e.g. level 1 stats)
                user.stats.level = 1;
                user.stats.experience = 0;
                const baseStatValue = 1; // Default for level 1, no class
                ['body', 'reflexes', 'agility', 'tech', 'luck', 'charisma'].forEach(stat => {
                    user.stats[stat] = baseStatValue + user.stats.level; // Each stat = base + level (1+1 = 2 for level 1)
                });
                const baseHP = 20;
                const levelBonusHP = 3 * user.stats.level;
                const bodyBonusHP = Math.ceil(user.stats.body * 2.5);
                user.stats.hitpoints = baseHP + levelBonusHP + bodyBonusHP;
                user.stats.currentHitpoints = user.stats.hitpoints;
                user.stats.energy = 20 + user.stats.level; // Default energy
                user.stats.currentEnergy = user.stats.energy;
            }
    
            await user.save();
    
            // After saving, refresh the player's node data
            if (this.questService && typeof this.questService.refreshPlayerNode === 'function') {
                 await this.questService.refreshPlayerNode(userId);
            } else if (this.nodeService && typeof this.nodeService.getNodeDataForUser === 'function') { // Fallback if direct questService is tricky
                const socket = this.stateService.getClient(userId);
                if (socket && user.currentNode) {
                    const nodeData = await this.nodeService.getNodeDataForUser(user.currentNode, userId);
                    if (nodeData) {
                        nodeData.suppressImageDisplay = true; // Prevent image flicker
                        socket.emit('node data', nodeData);
                    }
                }
            }
            
            this.logger.info(`Character reset for user: ${userId}`);
            return { success: true };
    
        } catch (error) {
            this.logger.error(`Error resetting character for user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }
}

// Create a singleton instance
const userService = new UserService();

// Export the singleton instance as the main export (for backward compatibility)
module.exports = userService;

// Add the class constructor as a property for new code that wants to instantiate directly
module.exports.UserService = UserService; 