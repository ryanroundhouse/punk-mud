const logger = require('../config/logger');
const User = require('../models/User');
const stateService = require('./stateService');
const mobService = require('./mobService');
const nodeService = require('./nodeService');
const socketService = require('./socketService');
const userService = require('./userService');
const { publishCombatSystemMessage, publishUserMoveSystemMessage } = require('./systemMessageService');
const questService = require('./questService');
const Move = require('../models/Move');
const messageService = require('./messageService');

class CombatService {
    constructor(deps = {}) {
        this.logger = deps.logger || logger;
        this.User = deps.User || User;
        this.stateService = deps.stateService || stateService;
        this.mobService = deps.mobService || mobService;
        this.nodeService = deps.nodeService || nodeService;
        this.socketService = deps.socketService || socketService;
        this.userService = deps.userService || userService;
        this.questService = deps.questService || questService;
        this.Move = deps.Move || Move;
        this.messageService = deps.messageService || messageService;
        this.publishCombatSystemMessage = deps.publishCombatSystemMessage || publishCombatSystemMessage;
        this.publishUserMoveSystemMessage = deps.publishUserMoveSystemMessage || publishUserMoveSystemMessage;
        
        // For testing purposes
        this._mockRandomValues = null;
        this._mockRandomIndex = 0;
    }

    // For testing: set predetermined random values
    setMockRandomValues(values) {
        this._mockRandomValues = values;
        this._mockRandomIndex = 0;
    }

    // For testing: clear mock random values
    clearMockRandomValues() {
        this._mockRandomValues = null;
        this._mockRandomIndex = 0;
    }

    // For testing: get a random number, using mock values if available
    getRandomNumber(min, max) {
        if (this._mockRandomValues && this._mockRandomIndex < this._mockRandomValues.length) {
            const value = this._mockRandomValues[this._mockRandomIndex++];
            // Make sure the value is within the specified range
            return min + (value * (max - min));
        }
        return Math.random() * (max - min) + min;
    }

    // For testing: get a random integer, using mock values if available
    getRandomInt(min, max) {
        return Math.floor(this.getRandomNumber(min, max + 0.999));
    }

    calculateAttackResult(move, attacker, defender) {
        // Roll d20 for both attacker and defender
        const attackerRoll = this.getRandomInt(1, 20);
        const defenderRoll = this.getRandomInt(1, 20);
    
        // Get the base stats from attacker and defender
        const attackerBaseStatValue = attacker.stats[move.attackStat] || 0;
        const defenderBaseStatValue = defender.stats[move.defenceStat] || 0;
    
        // Get active effects for both combatants
        const attackerEffects = this.stateService.getCombatantEffects(attacker._id?.toString() || attacker.instanceId) || [];
        const defenderEffects = this.stateService.getCombatantEffects(defender._id?.toString() || defender.instanceId) || [];
    
        // Calculate effective stats using the new method
        const attackerStatValue = this.Move.calculateEffectiveStat(attackerBaseStatValue, attackerEffects, move.attackStat);
        const defenderStatValue = this.Move.calculateEffectiveStat(defenderBaseStatValue, defenderEffects, move.defenceStat);
    
        // Calculate total scores
        const attackerTotal = attackerStatValue + attackerRoll;
        const defenderTotal = defenderStatValue + defenderRoll;
    
        const success = attackerTotal > defenderTotal;
    
        // Helper function to format messages
        const formatMessage = (message) => {
            return message
                .replace(/\[name\]/g, attacker.avatarName || attacker.name)
                .replace(/\[opponent\]/g, defender.avatarName || defender.name)
                .replace(/\[Self\]/g, attacker.avatarName || attacker.name)
                .replace(/\[Opponent\]/g, defender.avatarName || defender.name);
        };
    
        let effects = [];
        let messages = [];
        
        // Add stat modification details to the roll message
        const attackerModifier = attackerStatValue - attackerBaseStatValue;
        const defenderModifier = defenderStatValue - defenderBaseStatValue;
        
        messages.push(
            `(${attackerBaseStatValue}${attackerModifier ? `${attackerModifier >= 0 ? '+' : ''}${attackerModifier}` : ''}+${attackerRoll} vs ` +
            `${defenderBaseStatValue}${defenderModifier ? `${defenderModifier >= 0 ? '+' : ''}${defenderModifier}` : ''}+${defenderRoll})`
        );
        
        let damage = 0;
    
        if (success) {
            // Get attacker's level, defaulting to 1 if not found
            const attackerLevel = attacker.stats?.level || 1;
            
            // Base damage calculation
            const basePower = move.basePower || 3;
            const scalingFactor = move.scalingFactor || 0.6;
            const levelScalingMultiplier = 0.1; // 10% increase per level
            const weaponBonus = attacker.equipment?.weapon?.damage || 0;
            const targetArmor = defender.stats?.armor || 0;
            const randomRoll = this.getRandomInt(1, move.damageDice || 6);
            
            // Calculate raw damage
            const rawDamage = (
                basePower + 
                (attackerStatValue * scalingFactor) + 
                weaponBonus + 
                randomRoll
            ) - (targetArmor / 2);
    
            // Apply level scaling and delay multiplier
            const levelMultiplier = 1 + (attackerLevel * levelScalingMultiplier);
            const delayMultiplier = move.delay / 5;
            damage = Math.max(1, Math.floor(rawDamage * levelMultiplier * delayMultiplier));
    
            // Calculate DPR for debugging
            const dpr = damage / (move.delay || 1);
            
            messages.push(`The attack hits for ${damage} damage! (DPR: ${dpr.toFixed(2)})`);
    
            // Debug log for damage calculation
            this.logger.debug('Damage calculation:', {
                basePower,
                attackerStat: attackerStatValue,
                scalingFactor,
                weaponBonus,
                randomRoll,
                targetArmor,
                rawDamage,
                level: attackerLevel,
                levelMultiplier,
                delayMultiplier,
                finalDamage: damage,
                dpr
            });
    
            // Add any success effects from the move
            if (move.success && Array.isArray(move.success)) {
                move.success.forEach(effect => {
                    // For stun effects, we'll add them to a separate array
                    if (effect.effect === 'stun') {
                        // Add delay increase message
                        messages.push(formatMessage(
                            `[opponent] staggers from the attack!`
                        ));
                        // The delay increase will be handled by applyStunEffect
                    } else {
                        const effectCopy = {
                            target: effect.target,
                            effect: effect.effect,
                            stat: effect.stat,
                            amount: effect.amount,
                            rounds: effect.rounds,
                            message: effect.message,
                            initiator: attacker.avatarName || attacker.name
                        };
                        effects.push(effectCopy);
                        if (effect.message) {
                            messages.push(formatMessage(effect.message));
                        }
                    }
                });
            }
        } else {
            messages.push('The attack fails!');
            // Apply failure effects if the attack failed
            if (move.failure && Array.isArray(move.failure)) {
                move.failure.forEach(effect => {
                    const effectCopy = {
                        target: effect.target,
                        effect: effect.effect,
                        rounds: effect.rounds,
                        message: effect.message,
                        initiator: attacker.avatarName || attacker.name
                    };
                    effects.push(effectCopy);
                    if (effect.message) {
                        messages.push(formatMessage(effect.message));
                    }
                });
            }
        }
    
        return {
            success,
            effects,
            damage,
            message: messages.join(' ')
        };
    }
    
    // Helper function to check for stun effects
    isStunned(effects) {
        return effects && effects.some(effect => effect.effect === 'stun' && effect.rounds > 0);
    }
    
    // Modify the applyEffect function to handle stun differently
    async applyEffect(effect, user, mobInstance) {
        if (!effect) return;
    
        // For stun effects, we don't store them anymore since they just modify delays
        if (effect.effect === 'stun') {
            return;
        }
    
        // Handle other status effects
        if (effect.effect) {
            const targetId = effect.target === 'self' 
                ? (effect.initiator === user.avatarName ? user._id.toString() : mobInstance.instanceId)
                : (effect.initiator === user.avatarName ? mobInstance.instanceId : user._id.toString());
            
            this.stateService.addCombatantEffect(targetId, {
                effect: effect.effect,
                rounds: effect.rounds || 1,
                initialRounds: effect.rounds || 1,
                stat: effect.stat,
                amount: effect.amount,
                target: effect.target
            });
        }
    }
    
    async handleCombatCommand(user, moveName) {
        try {
            const userMoves = await this.userService.getUserMoves(user._id);
            const selectedMove = userMoves.find(move => 
                move.name.toLowerCase() === moveName.toLowerCase()
            );
    
            if (!selectedMove) {
                this.messageService.sendErrorMessage(user._id.toString(), `You don't know the move "${moveName}"`);
                return;
            }
    
            const combatState = this.stateService.userCombatStates.get(user._id.toString());
            const mobInstance = this.stateService.playerMobs.get(user._id.toString());
    
            if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
                this.messageService.sendErrorMessage(user._id.toString(), 'Your target is no longer available.');
                this.stateService.userCombatStates.delete(user._id.toString());
                return;
            }
    
            // Check if player already has a move in progress
            if (this.stateService.getCombatDelay(user._id.toString())) {
                this.messageService.sendCombatMessage(user._id.toString(), 'You are still executing your previous move.');
                return;
            }
    
            // Set player's move with delay
            this.stateService.setCombatDelay(user._id.toString(), {
                delay: selectedMove.delay,
                move: selectedMove,
                target: mobInstance
            });
    
            // If mob doesn't have a move queued, select one
            if (!this.stateService.getCombatDelay(mobInstance.instanceId)) {
                const mobMove = this.selectMobMove(mobInstance);
                this.stateService.setCombatDelay(mobInstance.instanceId, {
                    delay: mobMove.delay,
                    move: mobMove,
                    target: user
                });
            }
    
            // Process combat until player needs to select a new move
            await this.processCombatUntilInput(user, mobInstance);
    
        } catch (error) {
            this.logger.error('Error handling combat command:', error);
            this.messageService.sendErrorMessage(user._id.toString(), 'Error processing combat command');
        }
    }
    
    // Update processCombatUntilInput to properly handle move delays
    async processCombatUntilInput(user, mobInstance) {
        while (true) {
            const playerDelay = this.stateService.getCombatDelay(user._id.toString());
            const mobDelay = this.stateService.getCombatDelay(mobInstance.instanceId);
    
            // If either combatant doesn't have a move selected, break
            if (!playerDelay || !mobDelay) {
                break;
            }
    
            // Get the actual move delays, defaulting to 1 if not found
            const playerMoveDelay = playerDelay.move?.delay || 1;
            const mobMoveDelay = mobDelay.move?.delay || 1;
    
            // Apply stun effects to current delays
            const playerEffectiveDelay = this.applyStunEffect([], playerDelay.delay, mobDelay.move);
            const mobEffectiveDelay = this.applyStunEffect([], mobDelay.delay, playerDelay.move);
    
            // Find the minimum delay to process
            const minDelay = Math.min(playerEffectiveDelay, mobEffectiveDelay);
    
            // Reduce delays by the minimum amount
            playerDelay.delay = Math.max(0, playerEffectiveDelay - minDelay);
            mobDelay.delay = Math.max(0, mobEffectiveDelay - minDelay);
    
            // Get any moves that are ready to execute
            const readyMoves = [];
            if (playerDelay.delay <= 0) {
                readyMoves.push({ type: 'player', ...playerDelay });
                this.stateService.clearCombatDelay(user._id.toString());
            }
            if (mobDelay.delay <= 0) {
                readyMoves.push({ type: 'mob', ...mobDelay });
                this.stateService.clearCombatDelay(mobInstance.instanceId);
            }
    
            // Execute ready moves if any
            if (readyMoves.length > 0) {
                await this.executeCombatMoves(readyMoves, user, mobInstance);
                
                // If mob's move executed and they're still alive, select new move
                if (readyMoves.some(move => move.type === 'mob') && 
                    mobInstance.stats.currentHitpoints > 0) {
                    const mobMove = this.selectMobMove(mobInstance);
                    this.stateService.setCombatDelay(mobInstance.instanceId, {
                        delay: mobMove.delay,
                        move: mobMove,
                        target: user
                    });
                }
            } else {
                // Show current state of moves with effective delays
                this.messageService.sendCombatMessage(
                    user._id.toString(),
                    `You prepare ${playerDelay.move.name} (${playerEffectiveDelay} delay${playerEffectiveDelay > playerDelay.delay ? ' - stunned!' : ''})\n` +
                    `${mobInstance.name} is preparing ${mobDelay.move.name} (${mobEffectiveDelay} delay${mobEffectiveDelay > mobDelay.delay ? ' - stunned!' : ''})`
                );
                break;
            }
    
            // If player needs to select a new move, break the loop
            if (!this.stateService.getCombatDelay(user._id.toString())) {
                break;
            }
        }
    }
    
    // Update selectMobMove to properly handle move delays
    selectMobMove(mobInstance) {
        const mobMoves = mobInstance.moves;
        const totalChance = mobMoves.reduce((sum, move) => sum + move.usageChance, 0);
        let random = this.getRandomNumber(0, totalChance);
        
        for (const move of mobMoves) {
            random -= move.usageChance;
            if (random <= 0) {
                // Ensure the move has a delay value
                return {
                    ...move,
                    delay: move.delay || 1
                };
            }
        }
        // Ensure the fallback move has a delay value
        return {
            ...mobMoves[0],
            delay: mobMoves[0]?.delay || 1
        };
    }
    
    // Helper function to send HP status update
    sendHPStatus(userId, currentHP, maxHP, currentEnergy, maxEnergy) {
        this.messageService.sendPlayerStatusMessage(userId, `HP: ${currentHP}/${maxHP} | Energy: ${currentEnergy}/${maxEnergy}`);
    }
    
    // New function to execute combat moves
    async executeCombatMoves(readyMoves, user, mobInstance) {
        let deathHandled = false;
    
        // Add initial health logging
        this.logger.debug('Combat starting health levels:', {
            player: {
                name: user.avatarName,
                currentHP: user.stats.currentHitpoints,
                maxHP: user.stats.hitpoints
            },
            mob: {
                name: mobInstance.name,
                currentHP: mobInstance.stats.currentHitpoints,
                maxHP: mobInstance.stats.hitpoints
            }
        });
    
        // Initialize results with default values
        let playerResult = {
            success: false,
            effects: [],
            damage: 0,
            message: '',
            move: null
        };
        
        let mobResult = {
            success: false,
            effects: [],
            damage: 0,
            message: '',
            move: null
        };
    
        // Get current effects
        const userEffects = this.stateService.getCombatantEffects(user._id.toString()) || [];
        const mobEffects = this.stateService.getCombatantEffects(mobInstance.instanceId) || [];
    
        // Execute each ready move
        for (const moveInfo of readyMoves) {
            // Check if either combatant is already dead before processing move
            if (user.stats.currentHitpoints <= 0) {
                this.logger.debug('Skipping move execution - player is already dead', {
                    playerHP: user.stats.currentHitpoints,
                    skippedMove: moveInfo.move.name
                });
                
                // If player just died from the previous move, handle death
                if (!deathHandled) {
                    deathHandled = true;
                    
                    // Clear ALL combat states immediately
                    this.stateService.clearUserCombatState(user._id.toString());
                    this.stateService.clearCombatDelay(user._id.toString());
                    this.stateService.clearCombatantEffects(user._id.toString());
                    this.mobService.clearUserMob(user._id.toString());
    
                    // First handle death
                    await this.userService.handlePlayerDeath(user._id.toString());
    
                    // Announce defeat to the room
                    this.publishCombatSystemMessage(
                        user.currentNode,
                        {
                            message: `${user.avatarName} has been defeated by ${mobInstance.name}!`
                        },
                        user
                    );
                    
                    // Update user presence between nodes
                    await this.publishUserMoveSystemMessage(user.currentNode, '122.124.10.10', user);

                    // Send the complete death sequence message
                    this.messageService.sendCombatMessage(
                        user._id.toString(),
                        `${mobInstance.name} uses ${mobResult.move.name}! ${mobResult.message}\n\n` +
                        `*** YOU HAVE BEEN DEFEATED ***\n` +
                        `Everything goes dark...\n\n` +
                        `You wake up in Neon Plaza with a splitting headache, unsure how you got here. ` +
                        `Your wounds have been treated, but the memory of your defeat lingers.`,
                        null,
                        mobInstance.image
                    );
                }
                return; // Exit immediately after death
            }
            if (mobInstance.stats.currentHitpoints <= 0) {
                this.logger.debug('Skipping move execution - mob is already dead', {
                    mobHP: mobInstance.stats.currentHitpoints,
                    skippedMove: moveInfo.move.name
                });
                break;
            }
    
            if (moveInfo.type === 'player') {
                playerResult = this.calculateAttackResult(moveInfo.move, user, mobInstance);
                playerResult.move = moveInfo.move;
                
                // Log player attack
                this.logger.debug('Player attack result:', {
                    moveName: moveInfo.move.name,
                    success: playerResult.success,
                    damage: playerResult.damage,
                    mobHPBefore: mobInstance.stats.currentHitpoints,
                    mobHPAfter: Math.max(0, mobInstance.stats.currentHitpoints - playerResult.damage)
                });
    
                // Apply effects and damage from player's move
                for (const effect of playerResult.effects) {
                    await this.applyEffect(effect, user, mobInstance);
                }
                if (playerResult.damage > 0) {
                    mobInstance.stats.currentHitpoints -= playerResult.damage;
                }
            } else if (moveInfo.type === 'mob') {
                mobResult = this.calculateAttackResult(moveInfo.move, mobInstance, user);
                mobResult.move = moveInfo.move;
    
                // Log mob attack
                this.logger.debug('Mob attack result:', {
                    moveName: moveInfo.move.name,
                    success: mobResult.success,
                    damage: mobResult.damage,
                    playerHPBefore: user.stats.currentHitpoints,
                    playerHPAfter: Math.max(0, user.stats.currentHitpoints - mobResult.damage)
                });
    
                // Apply effects and damage from mob's move
                for (const effect of mobResult.effects) {
                    await this.applyEffect(effect, user, mobInstance);
                }
                if (mobResult.damage > 0) {
                    user.stats.currentHitpoints -= mobResult.damage;
                    // Send HP status update after taking damage
                    this.sendHPStatus(user._id.toString(), user.stats.currentHitpoints, user.stats.hitpoints, user.stats.currentEnergy, user.stats.energy);
                    
                    // Check for player death immediately after taking damage
                    if (user.stats.currentHitpoints <= 0) {
                        this.logger.debug('Player died from mob attack', {
                            finalPlayerHP: user.stats.currentHitpoints,
                            killingMove: moveInfo.move.name,
                            killingDamage: mobResult.damage
                        });
                        await this.User.findByIdAndUpdate(user._id, {
                            'stats.currentHitpoints': user.stats.currentHitpoints
                        });
                        break; // Stop processing any further moves
                    }
                    await this.User.findByIdAndUpdate(user._id, {
                        'stats.currentHitpoints': user.stats.currentHitpoints
                    });
                }
            }
        }
    
        // Log final health status
        this.logger.debug('Combat ending health levels:', {
            player: {
                name: user.avatarName,
                finalHP: user.stats.currentHitpoints,
                maxHP: user.stats.hitpoints
            },
            mob: {
                name: mobInstance.name,
                finalHP: mobInstance.stats.currentHitpoints,
                maxHP: mobInstance.stats.hitpoints
            }
        });
    
        // Decrement rounds on existing effects AFTER all damage is applied
        this.stateService.updateCombatantEffects(user._id.toString(), true);
        this.stateService.updateCombatantEffects(mobInstance.instanceId, true);
    
        // Process mob's action if they're still alive
        if (mobInstance.stats.currentHitpoints <= 0) {
            this.logger.debug('Mob defeated - Starting victory sequence', {
                userId: user._id.toString(),
                mobId: mobInstance.mobId || mobInstance._id,
                mobName: mobInstance.name,
                mobHP: mobInstance.stats.currentHitpoints
            });

            // Construct the combat result message
            let victoryMessage = '';
            if (playerResult.move) {
                victoryMessage = `You use ${playerResult.move.name}! ${playerResult.message}\n`;
            }
            
            // Add defeat message
            victoryMessage += ` ${mobInstance.name} has been defeated!`;
            
            // Add victory declaration
            victoryMessage += `\n\nVictory! You have defeated ${mobInstance.name}!`;
            
            // Determine images for the final message
            const imageToSend = mobInstance.hurtImage || mobInstance.image; // Use hurt image since the mob was just damaged
            const fallbackMoveImage = "/assets/moves/move-1744936855322-679154253.png";
            // Use the image from the final player move, if one exists
            const moveImageToSend = playerResult.move?.image || fallbackMoveImage;

            // Send the victory message first - Pass the correct images
            this.messageService.sendCombatMessage(
                user._id.toString(), 
                victoryMessage, 
                null, // helpText
                imageToSend,      // Mob's image (preferably hurt)
                moveImageToSend   // Player's move image
            );
            
            this.logger.debug('Processing quest updates and XP', {
                userId: user._id.toString(),
                mobId: mobInstance.mobId || mobInstance._id,
                hasCombatState: Boolean(this.stateService.userCombatStates.get(user._id.toString())),
                hasDelayState: Boolean(this.stateService.getCombatDelay(user._id.toString()))
            });

            // Process quest updates without including them in the victory message
            const questUpdates = await this.questService.handleMobKill(user, mobInstance._id || mobInstance.mobId);

            this.logger.debug('Quest updates complete, clearing combat state', {
                userId: user._id.toString(),
                questUpdates,
                hasCombatState: Boolean(this.stateService.userCombatStates.get(user._id.toString())),
                hasDelayState: Boolean(this.stateService.getCombatDelay(user._id.toString()))
            });

            // Clear combat state AFTER all processing is complete
            this.stateService.clearUserCombatState(user._id.toString());
            this.stateService.clearCombatDelay(user._id.toString());
            this.stateService.clearCombatantEffects(user._id.toString());
            this.mobService.clearUserMob(user._id.toString());

            this.logger.debug('Combat state cleared, processing experience', {
                userId: user._id.toString(),
                hasCombatState: Boolean(this.stateService.userCombatStates.get(user._id.toString())),
                hasDelayState: Boolean(this.stateService.getCombatDelay(user._id.toString()))
            });
            
            // Then award experience points and send as a separate success message
            try {
                const experiencePoints = mobInstance.experiencePoints || 10;
                this.logger.debug('Awarding experience points:', { 
                    userId: user._id.toString(), 
                    amount: experiencePoints,
                    hasCombatState: Boolean(this.stateService.userCombatStates.get(user._id.toString())),
                    hasDelayState: Boolean(this.stateService.getCombatDelay(user._id.toString()))
                });
                
                const experienceResult = await this.userService.awardExperience(user._id.toString(), experiencePoints, true);
                this.logger.debug('Experience result:', {
                    ...experienceResult,
                    userId: user._id.toString(),
                    hasCombatState: Boolean(this.stateService.userCombatStates.get(user._id.toString())),
                    hasDelayState: Boolean(this.stateService.getCombatDelay(user._id.toString()))
                });
                
                if (experienceResult.success) {
                    // Send XP gain as a success message
                    this.logger.debug('Sending XP gain message');
                    this.messageService.sendSuccessMessage(
                        user._id.toString(), 
                        `You gained ${experiencePoints} experience points!`
                    );
                    
                    // If there was a level up, send that as a separate success message
                    if (experienceResult.levelUp === true) {
                        this.logger.debug('Sending level up message', { 
                            newLevel: experienceResult.newLevel,
                            newHP: experienceResult.newHP
                        });
                        
                        // Add a small delay to ensure messages appear in the right order
                        setTimeout(() => {
                            // Send level up message directly
                            const levelUpMessage = `Congratulations! You have reached level ${experienceResult.newLevel}!\n` +
                                                 `All your stats have increased by 1!\n` +
                                                 `Your maximum health is now ${experienceResult.newHP} points.`;
                            
                            // Use sendConsoleResponse directly to ensure the message type is set correctly
                            this.messageService.sendConsoleResponse(
                                user._id.toString(),
                                levelUpMessage,
                                'success'
                            );
                        }, 100);
                    } else {
                        this.logger.debug('No level up occurred');
                    }
                } else {
                    this.logger.debug('Experience award was not successful', { result: experienceResult });
                }
            } catch (error) {
                this.logger.error('Error awarding experience points:', error);
            }
            
            // Announce victory to the room
            this.publishCombatSystemMessage(
                user.currentNode,
                {
                    message: `${user.avatarName} has defeated ${mobInstance.name}!`
                },
                user
            );
            return;
        } else if (user.stats.currentHitpoints <= 0) {
            this.logger.debug('Combat ended - Player defeated', {
                finalPlayerHP: user.stats.currentHitpoints,
                finalMobHP: mobInstance.stats.currentHitpoints
            });
    
            // First handle death
            await this.userService.handlePlayerDeath(user._id.toString());
    
            // Announce defeat to the room
            this.publishCombatSystemMessage(
                user.currentNode,
                {
                    message: `${user.avatarName} has been defeated by ${mobInstance.name}!`
                },
                user
            );
            
            // Update user presence between nodes
            await this.publishUserMoveSystemMessage(user.currentNode, '122.124.10.10', user);

            // Send the complete death sequence message
            this.messageService.sendCombatMessage(
                user._id.toString(),
                `${mobInstance.name} uses ${mobResult.move.name}! ${mobResult.message}\n\n` +
                `*** YOU HAVE BEEN DEFEATED ***\n` +
                `Everything goes dark...\n\n` +
                `You wake up in Neon Plaza with a splitting headache, unsure how you got here. ` +
                `Your wounds have been treated, but the memory of your defeat lingers.`,
                null,
                mobInstance.image
            );
            return; // Exit before sending regular combat message
        }
    
        // Only construct and send combat message if player is still alive
        if (user.stats.currentHitpoints > 0) {
            // Construct combat message
            let combatMessage = '';
            let imageToSend = mobInstance.image; // Default image
            let moveImageToSend = null; // Initialize moveImageToSend
            const fallbackMoveImage = "/assets/moves/move-1744936855322-679154253.png"; // Define fallback
    
            if (playerResult.move) {
                combatMessage += `You use ${playerResult.move.name}! ${playerResult.message}\n`;
                
                // If player hit, use hurtImage and set moveImageToSend
                if (playerResult.damage > 0) {
                    imageToSend = mobInstance.hurtImage || mobInstance.image; // Use hurtImage if available, fallback to default
                    moveImageToSend = playerResult.move.image || fallbackMoveImage; // Use move image or fallback
                }
                
                // Only show status after player moves
                combatMessage += `\nStatus:\n` +
                                `${user.avatarName}: ${user.stats.currentHitpoints} HP\n` +
                                `${mobInstance.name}: ${mobInstance.stats.currentHitpoints} HP`;
            }
            if (mobResult.move) {
                // If there was also a player move, add a newline
                if (playerResult.move) {
                    combatMessage += '\n\n';
                }
                combatMessage += `${mobInstance.name} uses ${mobResult.move.name}! ${mobResult.message}`;
            }
    
            // Pass moveImageToSend to sendCombatMessage
            this.messageService.sendCombatMessage(user._id.toString(), combatMessage, null, imageToSend, moveImageToSend);
        }
    }
    
    async handleFleeCommand(user) {
        try {
            const combatState = this.stateService.userCombatStates.get(user._id.toString());
            if (!combatState) {
                this.messageService.sendErrorMessage(user._id.toString(), 'You are not in combat!');
                return;
            }
    
            const mobInstance = this.stateService.playerMobs.get(user._id.toString());
            if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
                this.messageService.sendErrorMessage(user._id.toString(), 'Your target is no longer available.');
                this.stateService.userCombatStates.delete(user._id.toString());
                return;
            }
    
            // Mob always gets their attack when player tries to flee
            const mobMove = mobInstance.moves[0];
            const mobResult = this.calculateAttackResult(mobMove, mobInstance, user);
    
            // Apply mob's effects
            for (const effect of mobResult.effects) {
                await this.applyEffect(effect, user, mobInstance);
            }
    
            // Apply mob's damage
            if (mobResult.damage > 0) {
                user.stats.currentHitpoints -= mobResult.damage;
                // Send HP status update after taking damage during flee
                this.sendHPStatus(user._id.toString(), user.stats.currentHitpoints, user.stats.hitpoints, user.stats.currentEnergy, user.stats.energy);
                
                await this.User.findByIdAndUpdate(user._id, {
                    'stats.currentHitpoints': user.stats.currentHitpoints
                });
            }
    
            // Decrement rounds on existing effects
            this.stateService.updateCombatantEffects(user._id.toString());
            this.stateService.updateCombatantEffects(mobInstance.instanceId);
    
            // 50% chance to escape
            const fleeSuccess = this.getRandomNumber(0, 1) < 0.5;
    
            // Get current HP for status display
            const userCurrentHP = user.stats.currentHitpoints;
            const mobCurrentHP = mobInstance.stats.currentHitpoints;
    
            // Add status to both success and fail messages
            const statusMessage = `\nStatus:\n` +
                                `${user.avatarName}: ${userCurrentHP} HP\n` +
                                `${mobInstance.name}: ${mobCurrentHP} HP`;
    
            if (fleeSuccess) {
                const currentNode = await this.nodeService.getNodeByAddress(user.currentNode);
                const exits = currentNode.exits || [];
                
                if (exits.length === 0) {
                    this.messageService.sendErrorMessage(user._id.toString(), 'There is nowhere to flee to!');
                    return;
                }
    
                this.stateService.clearUserCombatState(user._id.toString());
                this.mobService.clearUserMob(user._id.toString());
    
                const randomExit = exits[Math.floor(this.getRandomNumber(0, exits.length))];
                const oldNode = user.currentNode;
                
                // Get the target node first
                const targetNode = await this.nodeService.getNodeByDirection(user._id.toString(), randomExit.direction);
                // Then move the user to that node
                await this.userService.moveUserToNode(user._id.toString(), randomExit.direction, targetNode);
    
                this.messageService.sendCombatMessage(
                    user._id.toString(),
                    `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                    `You successfully flee from combat!${statusMessage}`,
                    null,
                    mobInstance.image
                );
    
                this.publishCombatSystemMessage(
                    oldNode,
                    {
                        message: `${user.avatarName} flees from combat with ${mobInstance.name}!`
                    },
                    user
                );
            } else {
                this.messageService.sendCombatMessage(
                    user._id.toString(),
                    `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                    `You fail to escape!${statusMessage}`,
                    null,
                    mobInstance.image
                );
            }
        } catch (error) {
            this.logger.error('Error handling flee command:', error);
            this.messageService.sendErrorMessage(user._id.toString(), 'Error processing flee command');
        }
    }
    
    async handleFightCommand(user, target) {
        if (!target) {
            this.messageService.sendErrorMessage(user._id.toString(), 'Usage: fight <mob name>');
            return;
        }
    
        if (this.stateService.userCombatStates.get(user._id.toString())) {
            this.messageService.sendErrorMessage(user._id.toString(), 'You are already in combat!');
            return;
        }
    
        const mobInstance = this.stateService.playerMobs.get(user._id.toString());
        if (!mobInstance || mobInstance.name.toLowerCase() !== target.toLowerCase()) {
            this.messageService.sendErrorMessage(user._id.toString(), `No mob named "${target}" found in current location.`);
            return;
        }
    
        // Update combat state to include health values
        this.stateService.userCombatStates.set(user._id.toString(), {
            mobInstanceId: mobInstance.instanceId,
            mobName: mobInstance.name
        });
    
        this.messageService.sendCombatMessage(
            user._id.toString(),
            `You engage in combat with ${mobInstance.name}!`,
            'Type ? to see available combat commands.',
            mobInstance.image
        );

        this.publishCombatSystemMessage(
            user.currentNode,
            {
                message: `${user.avatarName} engages in combat with ${mobInstance.name}!`
            },
            user
        );
    }
    
    async getCombatStatus(userId) {
        try {
            const combatState = this.stateService.userCombatStates.get(userId);
            if (!combatState) {
                return { inCombat: false };
            }
    
            const user = await this.userService.getUser(userId);
            const mobInstance = this.stateService.playerMobs.get(userId);
    
            if (!user || !mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
                // Combat state is invalid, clean it up
                this.stateService.userCombatStates.delete(userId);
                return { inCombat: false };
            }
    
            return {
                inCombat: true,
                playerHealth: user.stats.currentHitpoints,
                enemyHealth: mobInstance.stats.currentHitpoints,
                enemyName: mobInstance.name
            };
        } catch (error) {
            this.logger.error('Error getting combat status:', error);
            throw error;
        }
    }
    
    // Update applyStunEffect to look at the move's effects
    applyStunEffect(effects, delay, move) {
        let totalStunDelay = 0;
        
        // If this move has stun effects that succeeded, apply their delay
        if (move.success) {
            move.success.forEach(effect => {
                if (effect.effect === 'stun') {
                    totalStunDelay += 2 * (effect.rounds || 1);
                }
            });
        }
        
        return delay + totalStunDelay;
    }
}

// Create a singleton instance with default dependencies
const combatService = new CombatService();

// Export the singleton instance as the default export
// But also attach the CombatService class to it
module.exports = combatService;
module.exports.CombatService = CombatService; 