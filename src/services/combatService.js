const logger = require('../config/logger');
const User = require('../models/User');
const stateService = require('./stateService');
const mobService = require('./mobService');
const nodeService = require('./nodeService');
const socketService = require('./socketService');
const userService = require('./userService');
const { publishSystemMessage } = require('./chatService');
const questService = require('./questService');

function calculateAttackResult(move, attackerName, defenderName) {
    const success = Math.random() * 100 <= move.successChance;
    const effect = success ? move.success : move.failure;
    
    if (!effect) {
        return {
            success,
            message: success ? 'The attack succeeds!' : 'The attack fails!'
        };
    }

    // Handle mongoose document objects by converting to plain object
    const plainEffect = effect._doc || effect;
    
    const effectWithInitiator = {
        ...plainEffect,
        initiator: attackerName
    };

    const targetName = effect.target === 'self' ? attackerName : defenderName;
    const amount = effect.amount || 0;
    
    let message = '';
    if (effect.message) {
        message = effect.message
            .replace(/\[name\]/g, attackerName)
            .replace(/\[opponent\]/g, defenderName);
    }

    if (amount !== 0) {
        let effectMessage;
        if (effect.stat === 'hitpoints') {
            if (amount < 0) {
                effectMessage = `${targetName} takes ${Math.abs(amount)} damage!`;
            } else {
                effectMessage = `${targetName} heals for ${amount} points!`;
            }
        } else {
            const statEffect = amount < 0 ? 'loses' : 'gains';
            effectMessage = `${targetName} ${statEffect} ${Math.abs(amount)} ${effect.stat}!`;
        }
        
        message = message ? `${message} ${effectMessage}` : effectMessage;
    }

    return {
        success,
        effect: effectWithInitiator,
        message: message || 'Nothing happens.'
    };
}

async function handleCombatCommand(socket, user, moveName) {
    try {
        logger.debug(`Starting combat command for user ${user._id} with move: ${moveName}`);
        
        const userMoves = await userService.getUserMoves(user._id);
        logger.debug('User moves:', userMoves);
        
        const selectedMove = userMoves.find(move => 
            move.name.toLowerCase() === moveName.toLowerCase()
        );

        logger.debug('Selected move:', selectedMove);

        if (!selectedMove) {
            socket.emit('console response', {
                type: 'error',
                message: `You don't know the move "${moveName}"`
            });
            return;
        }

        const combatState = stateService.userCombatStates.get(socket.user.userId);
        logger.debug('Combat state:', combatState);
        
        const mobInstance = stateService.playerMobs.get(user._id.toString());
        logger.debug('Mob instance:', mobInstance);

        if (!mobInstance || mobInstance.instanceId !== combatState.mobInstanceId) {
            logger.warn('Mob instance not found or mismatch:', {
                mobInstance: mobInstance?.instanceId,
                expectedId: combatState?.mobInstanceId
            });
            socket.emit('console response', {
                type: 'error',
                message: 'Your target is no longer available.'
            });
            stateService.userCombatStates.delete(socket.user.userId);
            return;
        }

        const mobMoves = mobInstance.moves;
        logger.debug('Mob moves:', mobMoves);

        if (!mobMoves || !Array.isArray(mobMoves)) {
            logger.error('Invalid mob moves:', {
                mobMoves,
                mobInstance,
                mobId: mobInstance.instanceId
            });
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

        logger.debug('Selected mob move:', mobMove);

        const playerResult = calculateAttackResult(selectedMove, user.avatarName, mobInstance.name);
        const mobResult = calculateAttackResult(mobMove, mobInstance.name, user.avatarName);

        logger.debug('Combat results:', { playerResult, mobResult });

        await applyEffects(playerResult, mobResult, user, mobInstance);

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
                                `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n` +
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
        logger.error('Error handling combat command:', {
            error,
            userId: user._id,
            moveName,
            stack: error.stack
        });
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

        const mobMove = mobInstance.moves[0];
        const mobResult = calculateAttackResult(mobMove, mobInstance.name, user.avatarName);
        
        await applyEffect(mobResult.effect, user, mobInstance);

        const fleeSuccess = Math.random() < 0.5;

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
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\nYou successfully flee from combat!`
            });

            publishSystemMessage(oldNode, `${user.avatarName} flees from combat with ${mobInstance.name}!`);
        } else {
            socket.emit('console response', {
                type: 'combat',
                message: `${mobInstance.name} uses ${mobMove.name}! ${mobResult.message}\n\nYou fail to escape!`
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

async function applyEffect(effect, user, mobInstance) {
    if (!effect) return;

    logger.debug('Apply Effect Debug:', {
        effectInitiator: effect.initiator,
        userAvatarName: user.avatarName,
        mobName: mobInstance.name,
        effectTarget: effect.target,
        effectAmount: effect.amount,
        effectStat: effect.stat
    });

    const isUserEffect = effect.initiator === user.avatarName;
    const target = effect.target === 'self' 
        ? (isUserEffect ? user.stats : mobInstance.stats)
        : (isUserEffect ? mobInstance.stats : user.stats);

    logger.debug('Target Selection:', {
        isUserEffect,
        targetIsUserStats: target === user.stats,
        targetIsMobStats: target === mobInstance.stats
    });

    const stat = effect.stat;
    if (stat && target) {
        if (stat === 'hitpoints') {
            target.currentHitpoints += effect.amount || 0;
            if (target === user.stats) {
                await User.findByIdAndUpdate(user._id, {
                    'stats.currentHitpoints': user.stats.currentHitpoints
                });
            }
        } else {
            target[stat] += effect.amount || 0;
        }
    }
}

async function applyEffects(playerResult, mobResult, user, mobInstance) {
    if (playerResult.effect) {
        await applyEffect(playerResult.effect, user, mobInstance);
    }
    if (mobResult.effect) {
        await applyEffect(mobResult.effect, user, mobInstance);
    }
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