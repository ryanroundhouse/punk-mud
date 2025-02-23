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
const messageService = require('./messageService');

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
        // Get attacker's level, defaulting to 1 if not found
        const attackerLevel = attacker.stats?.level || 1;
        
        // Base damage calculation
        const basePower = move.basePower || 3;
        const scalingFactor = move.scalingFactor || 0.6;
        const levelScalingMultiplier = 0.1; // 10% increase per level
        const weaponBonus = attacker.equipment?.weapon?.damage || 0;
        const targetArmor = defender.stats?.armor || 0;
        const randomRoll = Math.floor(Math.random() * (move.damageDice || 6)) + 1;
        
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
        logger.debug('Damage calculation:', {
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

// Add this helper function to check for stun effects
function isStunned(effects) {
    return effects && effects.some(effect => effect.effect === 'stun' && effect.rounds > 0);
}

// Modify the applyEffect function to handle stun differently
async function applyEffect(effect, user, mobInstance) {
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
        
        stateService.addCombatantEffect(targetId, {
            effect: effect.effect,
            rounds: effect.rounds || 1,
            initialRounds: effect.rounds || 1,
            stat: effect.stat,
            amount: effect.amount,
            target: effect.target
        });
    }
}

async function handleCombatCommand(user, moveName) {
    try {
        const userMoves = await userService.getUserMoves(user._id);
        const selectedMove = userMoves.find(move => 
            move.name.toLowerCase() === moveName.toLowerCase()
        );

        if (!selectedMove) {
            messageService.sendErrorMessage(user._id.toString(), `You don't know the move "${moveName}"`);
            return;
        }

        const combatState = stateService.userCombatStates.get(user._id.toString());
        const mobInstance = stateService.playerMobs.get(user._id.toString());

        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            messageService.sendErrorMessage(user._id.toString(), 'Your target is no longer available.');
            stateService.userCombatStates.delete(user._id.toString());
            return;
        }

        // Check if player already has a move in progress
        if (stateService.getCombatDelay(user._id.toString())) {
            messageService.sendCombatMessage(user._id.toString(), 'You are still executing your previous move.');
            return;
        }

        // Set player's move with delay
        stateService.setCombatDelay(user._id.toString(), {
            delay: selectedMove.delay,
            move: selectedMove,
            target: mobInstance
        });

        // If mob doesn't have a move queued, select one
        if (!stateService.getCombatDelay(mobInstance.instanceId)) {
            const mobMove = selectMobMove(mobInstance);
            stateService.setCombatDelay(mobInstance.instanceId, {
                delay: mobMove.delay,
                move: mobMove,
                target: user
            });
        }

        // Process combat until player needs to select a new move
        await processCombatUntilInput(user, mobInstance);

    } catch (error) {
        logger.error('Error handling combat command:', error);
        messageService.sendErrorMessage(user._id.toString(), 'Error processing combat command');
    }
}

// Update processCombatUntilInput to properly handle move delays
async function processCombatUntilInput(user, mobInstance) {
    while (true) {
        const playerDelay = stateService.getCombatDelay(user._id.toString());
        const mobDelay = stateService.getCombatDelay(mobInstance.instanceId);

        // If either combatant doesn't have a move selected, break
        if (!playerDelay || !mobDelay) {
            break;
        }

        // Get the actual move delays, defaulting to 1 if not found
        const playerMoveDelay = playerDelay.move?.delay || 1;
        const mobMoveDelay = mobDelay.move?.delay || 1;

        // Apply stun effects to current delays
        const playerEffectiveDelay = applyStunEffect([], playerDelay.delay, mobDelay.move);
        const mobEffectiveDelay = applyStunEffect([], mobDelay.delay, playerDelay.move);

        // Find the minimum delay to process
        const minDelay = Math.min(playerEffectiveDelay, mobEffectiveDelay);

        // Reduce delays by the minimum amount
        playerDelay.delay = Math.max(0, playerEffectiveDelay - minDelay);
        mobDelay.delay = Math.max(0, mobEffectiveDelay - minDelay);

        // Get any moves that are ready to execute
        const readyMoves = [];
        if (playerDelay.delay <= 0) {
            readyMoves.push({ type: 'player', ...playerDelay });
            stateService.clearCombatDelay(user._id.toString());
        }
        if (mobDelay.delay <= 0) {
            readyMoves.push({ type: 'mob', ...mobDelay });
            stateService.clearCombatDelay(mobInstance.instanceId);
        }

        // Execute ready moves if any
        if (readyMoves.length > 0) {
            await executeCombatMoves(readyMoves, user, mobInstance);
            
            // If mob's move executed and they're still alive, select new move
            if (readyMoves.some(move => move.type === 'mob') && 
                mobInstance.stats.currentHitpoints > 0) {
                const mobMove = selectMobMove(mobInstance);
                stateService.setCombatDelay(mobInstance.instanceId, {
                    delay: mobMove.delay,
                    move: mobMove,
                    target: user
                });
            }
        } else {
            // Show current state of moves with effective delays
            messageService.sendCombatMessage(
                user._id.toString(),
                `You prepare ${playerDelay.move.name} (${playerEffectiveDelay} delay${playerEffectiveDelay > playerDelay.delay ? ' - stunned!' : ''})\n` +
                `${mobInstance.name} is preparing ${mobDelay.move.name} (${mobEffectiveDelay} delay${mobEffectiveDelay > mobDelay.delay ? ' - stunned!' : ''})`
            );
            break;
        }

        // If player needs to select a new move, break the loop
        if (!stateService.getCombatDelay(user._id.toString())) {
            break;
        }
    }
}

// Update selectMobMove to properly handle move delays
function selectMobMove(mobInstance) {
    const mobMoves = mobInstance.moves;
    const totalChance = mobMoves.reduce((sum, move) => sum + move.usageChance, 0);
    let random = Math.random() * totalChance;
    
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

// New function to execute combat moves
async function executeCombatMoves(readyMoves, user, mobInstance) {
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
    const userEffects = stateService.getCombatantEffects(user._id.toString()) || [];
    const mobEffects = stateService.getCombatantEffects(mobInstance.instanceId) || [];

    // Execute each ready move
    for (const moveInfo of readyMoves) {
        if (moveInfo.type === 'player') {
            playerResult = calculateAttackResult(moveInfo.move, user, mobInstance);
            playerResult.move = moveInfo.move;
            // Apply effects and damage from player's move
            for (const effect of playerResult.effects) {
                await applyEffect(effect, user, mobInstance);
            }
            if (playerResult.damage > 0) {
                mobInstance.stats.currentHitpoints -= playerResult.damage;
            }
        } else if (moveInfo.type === 'mob') {
            mobResult = calculateAttackResult(moveInfo.move, mobInstance, user);
            mobResult.move = moveInfo.move;
            // Apply effects and damage from mob's move
            for (const effect of mobResult.effects) {
                await applyEffect(effect, user, mobInstance);
            }
            if (mobResult.damage > 0) {
                user.stats.currentHitpoints -= mobResult.damage;
                await User.findByIdAndUpdate(user._id, {
                    'stats.currentHitpoints': user.stats.currentHitpoints
                });
            }
        }
    }

    // Process mob's action if they're still alive
    if (mobInstance.stats.currentHitpoints <= 0) {
        mobResult.message += ` ${mobInstance.name} has been defeated!`;
        
        // Award experience points
        try {
            const experiencePoints = mobInstance.experiencePoints || 10; // Default to 10 if not set
            const experienceResult = await userService.awardExperience(user._id.toString(), experiencePoints);
            if (experienceResult.success) {
                mobResult.message += `\nYou gained ${experiencePoints} experience points!`;
            }
        } catch (error) {
            logger.error('Error awarding experience points:', error);
        }
    }

    // Decrement rounds on existing effects AFTER all damage is applied
    stateService.updateCombatantEffects(user._id.toString(), true);
    stateService.updateCombatantEffects(mobInstance.instanceId, true);

    const userCurrentHP = user.stats.currentHitpoints;
    const mobCurrentHP = mobInstance.stats.currentHitpoints;

    if (mobCurrentHP <= 0) {
        stateService.clearUserCombatState(user._id.toString());
        
        const mobId = mobInstance._id || mobInstance.mobId;
        const questUpdates = await questService.handleMobKill(user, mobId);
        mobService.clearUserMob(user._id.toString());

        let victoryMessage = '';
        if (playerResult.move) {
            victoryMessage = `You use ${playerResult.move.name}! ${playerResult.message}\n`;
        }
        if (mobResult.message) {
            victoryMessage += `${mobResult.message}\n`;
        }
        victoryMessage += `\nVictory! You have defeated ${mobInstance.name}!`;

        if (questUpdates && questUpdates.length > 0) {
            victoryMessage += '\n\n' + questUpdates
                .filter(update => update.message)  // Only include updates with messages
                .map(update => {
                    if (update.type === 'quest_progress') {
                        return `Quest "${update.questTitle}": ${update.message}`;
                    }
                    return update.message;
                })
                .join('\n');
        }

        messageService.sendCombatMessage(user._id.toString(), victoryMessage);
        publishSystemMessage(
            user.currentNode,
            `${user.avatarName} has defeated ${mobInstance.name}!`
        );
        return;
    }

    // Construct combat message
    let combatMessage = '';
    if (playerResult.move) {
        combatMessage += `You use ${playerResult.move.name}! ${playerResult.message}\n`;
        
        // Only show status after player moves
        combatMessage += `\nStatus:\n` +
                        `${user.avatarName}: ${userCurrentHP} HP\n` +
                        `${mobInstance.name}: ${mobCurrentHP} HP`;
    }
    if (mobResult.move) {
        // If there was also a player move, add a newline
        if (playerResult.move) {
            combatMessage += '\n\n';
        }
        combatMessage += `${mobInstance.name} uses ${mobResult.move.name}! ${mobResult.message}`;
    }

    messageService.sendCombatMessage(user._id.toString(), combatMessage);
}

async function handleFleeCommand(user) {
    try {
        const combatState = stateService.userCombatStates.get(user._id.toString());
        if (!combatState) {
            messageService.sendErrorMessage(user._id.toString(), 'You are not in combat!');
            return;
        }

        const mobInstance = stateService.playerMobs.get(user._id.toString());
        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            messageService.sendErrorMessage(user._id.toString(), 'Your target is no longer available.');
            stateService.userCombatStates.delete(user._id.toString());
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
                messageService.sendErrorMessage(user._id.toString(), 'There is nowhere to flee to!');
                return;
            }

            const randomExit = exits[Math.floor(Math.random() * exits.length)];
            const oldNode = user.currentNode;
            await nodeService.moveUser(user._id.toString(), randomExit.direction);
            
            if (oldNode) {
                stateService.removeUserFromNode(user._id.toString(), oldNode);
                await socketService.unsubscribeFromNodeChat(oldNode);
            }
            stateService.addUserToNode(user._id.toString(), user.currentNode);
            await socketService.subscribeToNodeChat(user.currentNode);

            stateService.clearUserCombatState(user._id.toString());
            mobService.clearUserMob(user._id.toString());

            messageService.sendCombatMessage(
                user._id.toString(),
                `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                `You successfully flee from combat!${statusMessage}`
            );

            publishSystemMessage(oldNode, `${user.avatarName} flees from combat with ${mobInstance.name}!`);
        } else {
            messageService.sendCombatMessage(
                user._id.toString(),
                `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\n` +
                `You fail to escape!${statusMessage}`
            );
        }
    } catch (error) {
        logger.error('Error handling flee command:', error);
        messageService.sendErrorMessage(user._id.toString(), 'Error processing flee command');
    }
}

async function handleFightCommand(user, target) {
    if (!target) {
        messageService.sendErrorMessage(user._id.toString(), 'Usage: fight <mob name>');
        return;
    }

    if (stateService.userCombatStates.get(user._id.toString())) {
        messageService.sendErrorMessage(user._id.toString(), 'You are already in combat!');
        return;
    }

    const mobInstance = stateService.playerMobs.get(user._id.toString());
    if (!mobInstance || mobInstance.name.toLowerCase() !== target.toLowerCase()) {
        messageService.sendErrorMessage(user._id.toString(), `No mob named "${target}" found in current location.`);
        return;
    }

    // Update combat state to include health values
    stateService.userCombatStates.set(user._id.toString(), {
        mobInstanceId: mobInstance.instanceId,
        mobName: mobInstance.name
    });

    messageService.sendCombatMessage(
        user._id.toString(),
        `You engage in combat with ${mobInstance.name}!`,
        'Type ? to see available combat commands.'
    );

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

// Update applyStunEffect to look at the move's effects
function applyStunEffect(effects, delay, move) {
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

module.exports = {
    handleCombatCommand,
    handleFleeCommand,
    handleFightCommand,
    getCombatStatus
}; 