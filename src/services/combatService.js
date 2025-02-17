const logger = require('../config/logger');
const User = require('../models/User');
const stateService = require('./stateService');
const mobService = require('./mobService');
const nodeService = require('./nodeService');
const socketService = require('./socketService');
const userService = require('./userService');
const { publishSystemMessage } = require('./chatService');
const questService = require('./questService');
const Move = require('../models/Move');

function calculateAttackResult(move, attacker, defender) {
    // Roll d20 for both attacker and defender
    const attackerRoll = Math.floor(Math.random() * 20) + 1;
    const defenderRoll = Math.floor(Math.random() * 20) + 1;

    // Get the base stats from attacker and defender
    const attackerBaseStatValue = attacker.stats[move.attackStat] || 0;
    const defenderBaseStatValue = defender.stats[move.defenceStat] || 0;

    // Get active effects for both combatants
    const attackerEffects = stateService.getCombatantEffects(attacker._id?.toString() || attacker.instanceId) || [];
    const defenderEffects = stateService.getCombatantEffects(defender._id?.toString() || defender.instanceId) || [];

    // Calculate effective stats using the new method
    const attackerStatValue = Move.calculateEffectiveStat(attackerBaseStatValue, attackerEffects, move.attackStat);
    const defenderStatValue = Move.calculateEffectiveStat(defenderBaseStatValue, defenderEffects, move.defenceStat);

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
        // Set base damage
        damage = 5;
        messages.push('The attack succeeds and deals 5 damage!');

        // Add any success effects from the move
        if (move.success && Array.isArray(move.success)) {
            move.success.forEach(effect => {
                const effectCopy = {
                    target: effect.target,
                    effect: effect.effect,
                    stat: effect.stat,     // Make sure we copy the stat
                    amount: effect.amount,  // Make sure we copy the amount
                    rounds: effect.rounds,
                    message: effect.message,
                    initiator: attacker.avatarName || attacker.name
                };
                logger.debug('Creating effect copy:', effectCopy);
                effects.push(effectCopy);
                if (effect.message) {
                    messages.push(formatMessage(effect.message));
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

// Add this helper function to check for stun effects
function isStunned(effects) {
    return effects && effects.some(effect => effect.effect === 'stun' && effect.rounds > 0);
}

// Add this helper at the top
function logCombatEffects(prefix, userName, userEffects, mobName, mobEffects) {
    logger.debug(`${prefix} Effects:`, {
        [`${userName}`]: userEffects.map(e => `${e.effect} (${e.rounds})`),
        [`${mobName}`]: mobEffects.map(e => `${e.effect} (${e.rounds})`)
    });
}

// Modify the applyBleedEffects function to handle rounds correctly
function applyBleedEffects(effects, target, excludeNew = false) {
    if (!effects) return 0;
    
    let totalBleedDamage = 0;
    effects.forEach(effect => {
        if (effect.effect === 'bleed' && effect.rounds > 0) {
            // Only skip if it's the first round (rounds equals initialRounds)
            if (excludeNew && effect.rounds === effect.initialRounds) {
                logger.debug('Skipping new bleed effect:', { effect });
                return;
            }
            totalBleedDamage += effect.amount || 1;
            logger.debug('Applying bleed damage:', { 
                damage: effect.amount || 1, 
                remainingRounds: effect.rounds,
                initialRounds: effect.initialRounds 
            });
        }
    });
    
    return totalBleedDamage;
}

// Modify the applyEffect function to store the initial rounds
async function applyEffect(effect, user, mobInstance) {
    if (!effect) return;

    // Handle status effects like stun
    if (effect.effect) {
        const targetId = effect.target === 'self' 
            ? (effect.initiator === user.avatarName ? user._id.toString() : mobInstance.instanceId)
            : (effect.initiator === user.avatarName ? mobInstance.instanceId : user._id.toString());
        
        stateService.addCombatantEffect(targetId, {
            effect: effect.effect,
            rounds: effect.rounds || 1,
            initialRounds: effect.rounds || 1,  // Store the initial number of rounds
            stat: effect.stat,
            amount: effect.amount,
            target: effect.target
        });
    }
}

async function handleCombatCommand(socket, user, moveName) {
    try {
        const userMoves = await userService.getUserMoves(user._id);
        const selectedMove = userMoves.find(move => 
            move.name.toLowerCase() === moveName.toLowerCase()
        );

        if (!selectedMove) {
            socket.emit('console response', {
                type: 'error',
                message: `You don't know the move "${moveName}"`
            });
            return;
        }

        const combatState = stateService.userCombatStates.get(socket.user.userId);
        const mobInstance = stateService.playerMobs.get(user._id.toString());

        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            socket.emit('console response', {
                type: 'error',
                message: 'Your target is no longer available.'
            });
            stateService.userCombatStates.delete(socket.user.userId);
            return;
        }

        const mobMoves = mobInstance.moves;
        if (!mobMoves || !Array.isArray(mobMoves)) {
            throw new Error('Invalid mob moves configuration');
        }

        const totalChance = mobMoves.reduce((sum, move) => sum + move.usageChance, 0);
        let random = Math.random() * totalChance;
        let mobMove;

        for (const move of mobMoves) {
            random -= move.usageChance;
            if (random <= 0) {
                mobMove = move;
                break;
            }
        }

        // Get current effects for both combatants
        const userEffects = stateService.getCombatantEffects(user._id.toString()) || [];
        const mobEffects = stateService.getCombatantEffects(mobInstance.instanceId) || [];

        // Log effects at start of round
        logCombatEffects('Start of Round', user.avatarName, userEffects, mobInstance.name, mobEffects);

        // Initialize results as null
        let playerResult = null;
        let mobResult = null;

        // Check if player is stunned
        if (isStunned(userEffects)) {
            playerResult = {
                success: false,
                effects: [],
                damage: 0,
                message: `${user.avatarName} is stunned and cannot move!`
            };
        } else {
            playerResult = calculateAttackResult(selectedMove, user, mobInstance);
        }

        // Apply player's effects first
        for (const effect of playerResult.effects) {
            await applyEffect(effect, user, mobInstance);
        }

        // Get current effects after applying new ones
        const userEffectsAfter = stateService.getCombatantEffects(user._id.toString()) || [];
        const mobEffectsAfter = stateService.getCombatantEffects(mobInstance.instanceId) || [];

        // Apply player's damage
        if (playerResult.damage > 0) {
            mobInstance.stats.currentHitpoints -= playerResult.damage;
        }

        // Initialize mobResult before using it
        mobResult = {
            success: false,
            effects: [],
            damage: 0,
            message: ''
        };

        // Apply bleed effects to both combatants, excluding new effects
        const userBleedDamage = applyBleedEffects(userEffectsAfter, user, true);
        if (userBleedDamage > 0) {
            user.stats.currentHitpoints -= userBleedDamage;
            await User.findByIdAndUpdate(user._id, {
                'stats.currentHitpoints': user.stats.currentHitpoints
            });
            playerResult.message += ` ${user.avatarName} takes ${userBleedDamage} bleed damage!`;
        }

        // Apply bleed damage to mob, excluding new effects
        const mobBleedDamage = applyBleedEffects(mobEffectsAfter, mobInstance, true);
        if (mobBleedDamage > 0) {
            mobInstance.stats.currentHitpoints -= mobBleedDamage;
            // Append to message instead of overwriting
            if (mobResult.message) {
                mobResult.message += ` ${mobInstance.name} takes ${mobBleedDamage} bleed damage!`;
            } else {
                mobResult.message = `${mobInstance.name} takes ${mobBleedDamage} bleed damage!`;
            }
        }

        // Process mob's action if they're still alive
        if (mobInstance.stats.currentHitpoints <= 0) {
            // Append defeat message instead of overwriting
            if (mobResult.message) {
                mobResult.message += ` ${mobInstance.name} has been defeated!`;
            } else {
                mobResult.message = `${mobInstance.name} has been defeated!`;
            }
        } else {
            // Get updated mob effects after player's action
            const updatedMobEffects = stateService.getCombatantEffects(mobInstance.instanceId) || [];

            // Check if mob is stunned with updated effects
            if (isStunned(updatedMobEffects)) {
                // Append stun message instead of overwriting
                if (mobResult.message) {
                    mobResult.message += ` ${mobInstance.name} is stunned and cannot move!`;
                } else {
                    mobResult.message = `${mobInstance.name} is stunned and cannot move!`;
                }
            } else {
                // Save any existing messages before calculating mob's attack
                const existingMessage = mobResult.message;
                mobResult = calculateAttackResult(mobMove, mobInstance, user);
                if (existingMessage) {
                    mobResult.message = existingMessage + ' ' + mobResult.message;
                }

                // Apply mob's effects
                for (const effect of mobResult.effects) {
                    await applyEffect(effect, user, mobInstance);
                }

                // Apply mob's damage
                if (mobResult.damage > 0) {
                    user.stats.currentHitpoints -= mobResult.damage;
                    await User.findByIdAndUpdate(user._id, {
                        'stats.currentHitpoints': user.stats.currentHitpoints
                    });
                }
            }
        }

        // Decrement rounds on existing effects AFTER all damage is applied
        // But ONLY for effects that have dealt their damage this round
        stateService.updateCombatantEffects(user._id.toString(), true);
        stateService.updateCombatantEffects(mobInstance.instanceId, true);

        // Log effects at end of round
        const endUserEffects = stateService.getCombatantEffects(user._id.toString()) || [];
        const endMobEffects = stateService.getCombatantEffects(mobInstance.instanceId) || [];
        logCombatEffects('End of Round', user.avatarName, endUserEffects, mobInstance.name, endMobEffects);

        const userCurrentHP = user.stats.currentHitpoints;
        const mobCurrentHP = mobInstance.stats.currentHitpoints;

        if (mobCurrentHP <= 0) {
            stateService.clearUserCombatState(socket.user.userId);
            
            // Get the original mob's _id - mobInstance is created from the Mob document
            const mobId = mobInstance._id || mobInstance.mobId;
            logger.debug('Mob killed:', {
                mobId,
                mobName: mobInstance.name,
                mobInstanceId: mobInstance.instanceId
            });
            
            const questUpdates = await questService.handleMobKill(user._id, mobId);
            mobService.clearUserMob(user._id.toString());

            let victoryMessage = `You use ${selectedMove.name}! ${playerResult.message}\n` +
                                `${mobResult.message}\n` +
                                `\nVictory! You have defeated ${mobInstance.name}!`;

            if (questUpdates && questUpdates.length > 0) {
                victoryMessage += '\n\n' + questUpdates.map(update => update.message).join('\n');
                
                const progressUpdate = questUpdates.find(u => u.type === 'quest_progress' && u.nextMessage);
                if (progressUpdate) {
                    victoryMessage += `\n\n${progressUpdate.nextMessage}`;
                }
            }

            socket.emit('console response', {
                type: 'combat',
                message: victoryMessage
            });

            publishSystemMessage(
                user.currentNode,
                `${user.avatarName} has defeated ${mobInstance.name}!`
            );
            return;
        }

        socket.emit('console response', {
            type: 'combat',
            message: `You use ${selectedMove.name}! ${playerResult.message}\n` +
                     `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n` +
                     `\nStatus:\n` +
                     `${user.avatarName}: ${userCurrentHP} HP\n` +
                     `${mobInstance.name}: ${mobCurrentHP} HP`
        });

    } catch (error) {
        logger.error('Error handling combat command:', error);
        socket.emit('console response', {
            type: 'error',
            message: 'Error processing combat command'
        });
    }
}

async function handleFleeCommand(socket, user) {
    try {
        const combatState = stateService.userCombatStates.get(socket.user.userId);
        if (!combatState) {
            socket.emit('console response', {
                type: 'error',
                message: 'You are not in combat!'
            });
            return;
        }

        const mobInstance = stateService.playerMobs.get(user._id.toString());
        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            socket.emit('console response', {
                type: 'error',
                message: 'Your target is no longer available.'
            });
            stateService.userCombatStates.delete(socket.user.userId);
            return;
        }

        // Mob always gets their attack when player tries to flee
        const mobMove = mobInstance.moves[0];
        const mobResult = calculateAttackResult(mobMove, mobInstance, user);

        // Apply mob's effects
        for (const effect of mobResult.effects) {
            await applyEffect(effect, user, mobInstance);
        }

        // Apply mob's damage
        if (mobResult.damage > 0) {
            user.stats.currentHitpoints -= mobResult.damage;
            await User.findByIdAndUpdate(user._id, {
                'stats.currentHitpoints': user.stats.currentHitpoints
            });
        }

        // Decrement rounds on existing effects
        stateService.updateCombatantEffects(user._id.toString());
        stateService.updateCombatantEffects(mobInstance.instanceId);

        // 50% chance to escape
        const fleeSuccess = Math.random() < 0.5;

        // Get current HP for status display
        const userCurrentHP = user.stats.currentHitpoints;
        const mobCurrentHP = mobInstance.stats.currentHitpoints;

        // Add status to both success and fail messages
        const statusMessage = `\nStatus:\n` +
                            `${user.avatarName}: ${userCurrentHP} HP\n` +
                            `${mobInstance.name}: ${mobCurrentHP} HP`;

        if (fleeSuccess) {
            const currentNode = await nodeService.getNode(user.currentNode);
            const exits = currentNode.exits || [];
            
            if (exits.length === 0) {
                socket.emit('console response', {
                    type: 'error',
                    message: 'There is nowhere to flee to!'
                });
                return;
            }

            const randomExit = exits[Math.floor(Math.random() * exits.length)];
            const oldNode = user.currentNode;
            await nodeService.moveUser(socket.user.userId, randomExit.direction);
            
            if (oldNode) {
                stateService.removeUserFromNode(socket.user.userId, oldNode);
                await socketService.unsubscribeFromNodeChat(oldNode);
            }
            stateService.addUserToNode(socket.user.userId, user.currentNode);
            await socketService.subscribeToNodeChat(user.currentNode);

            stateService.clearUserCombatState(socket.user.userId);
            mobService.clearUserMob(user._id.toString());

            socket.emit('console response', {
                type: 'combat',
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                         `You successfully flee from combat!${statusMessage}`
            });

            publishSystemMessage(oldNode, `${user.avatarName} flees from combat with ${mobInstance.name}!`);
        } else {
            socket.emit('console response', {
                type: 'combat',
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                         `You fail to escape!${statusMessage}`
            });
        }
    } catch (error) {
        logger.error('Error handling flee command:', error);
        socket.emit('console response', {
            type: 'error',
            message: 'Error processing flee command'
        });
    }
}

async function handleFightCommand(socket, user, target) {
    if (!target) {
        socket.emit('console response', {
            type: 'error',
            message: 'Usage: fight <mob name>'
        });
        return;
    }

    if (stateService.userCombatStates.get(socket.user.userId)) {
        socket.emit('console response', {
            type: 'error',
            message: 'You are already in combat!'
        });
        return;
    }

    const mobInstance = stateService.playerMobs.get(user._id.toString());
    if (!mobInstance || mobInstance.name.toLowerCase() !== target.toLowerCase()) {
        socket.emit('console response', {
            type: 'error',
            message: `No mob named "${target}" found in current location.`
        });
        return;
    }

    // Update combat state to include health values
    stateService.userCombatStates.set(socket.user.userId, {
        mobInstanceId: mobInstance.instanceId,
        mobName: mobInstance.name
    });

    socket.emit('console response', {
        type: 'combat',
        message: `You engage in combat with ${mobInstance.name}!`,
        hint: 'Type ? to see available combat commands.'
    });

    publishSystemMessage(user.currentNode, `${user.avatarName} engages in combat with ${mobInstance.name}!`);
}

async function getCombatStatus(userId) {
    try {
        const combatState = stateService.userCombatStates.get(userId);
        if (!combatState) {
            return { inCombat: false };
        }

        const user = await userService.getUser(userId);
        const mobInstance = stateService.playerMobs.get(userId);

        if (!user || !mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            // Combat state is invalid, clean it up
            stateService.userCombatStates.delete(userId);
            return { inCombat: false };
        }

        return {
            inCombat: true,
            playerHealth: user.stats.currentHitpoints,
            enemyHealth: mobInstance.stats.currentHitpoints,
            enemyName: mobInstance.name
        };
    } catch (error) {
        logger.error('Error getting combat status:', error);
        throw error;
    }
}

module.exports = {
    handleCombatCommand,
    handleFleeCommand,
    handleFightCommand,
    getCombatStatus
}; 