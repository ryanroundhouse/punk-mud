const logger = require('../config/logger');

class StateService {
    constructor() {
        this.clients = new Map();
        this.nodeClients = new Map();
        this.nodeUsernames = new Map(); // stores username lists per node
        this.subscribedNodes = new Set(); // tracks which node channels we're subscribed to
        this.actorChatStates = new Map(); // tracks last message index per user per actor
        this.playerMobs = new Map(); // tracks per-player spawned enemies
        this.userCombatStates = new Map(); // tracks combat state for each user
        this.combatantEffects = new Map(); // key: combatantId, value: array of active effects
        this.combatDelays = new Map(); // Tracks active move delays for combatants
        this.activeEvents = new Map(); // userId -> { eventId, currentNode }
    }

    addClient(userId, socket) {
        logger.debug('Adding client socket:', { userId });
        this.clients.set(userId, socket);
        logger.debug('Client socket map size:', { 
            size: this.clients.size,
            allUserIds: Array.from(this.clients.keys())
        });
    }

    getClient(userId) {
        logger.debug('Getting client socket:', { 
            userId,
            exists: this.clients.has(userId),
            mapSize: this.clients.size,
            allUserIds: Array.from(this.clients.keys())
        });
        return this.clients.get(userId);
    }

    removeClient(userId) {
        logger.debug('Removing client socket:', { userId });
        this.clients.delete(userId);
        logger.debug('Client socket map size after removal:', { 
            size: this.clients.size,
            allUserIds: Array.from(this.clients.keys())
        });
    }

    addUserToNode(userId, nodeAddress) {
        let nodeUsers = this.nodeClients.get(nodeAddress);
        if (!nodeUsers) {
            nodeUsers = new Set();
            this.nodeClients.set(nodeAddress, nodeUsers);
        }
        nodeUsers.add(userId);
        this.updateNodeUsernames(nodeAddress);
    }

    removeUserFromNode(userId, nodeAddress) {
        const nodeUsers = this.nodeClients.get(nodeAddress);
        if (nodeUsers) {
            nodeUsers.delete(userId);
            if (nodeUsers.size === 0) {
                this.nodeClients.delete(nodeAddress);
                this.nodeUsernames.delete(nodeAddress);
            } else {
                this.updateNodeUsernames(nodeAddress);
            }
        }
    }

    getUsersInNode(nodeAddress) {
        return this.nodeClients.get(nodeAddress) || new Set();
    }

    async updateNodeUsernames(nodeAddress) {
        try {
            const nodeUsers = this.nodeClients.get(nodeAddress);
            if (!nodeUsers) return;

            const User = require('../models/User');
            const usernames = [];
            
            for (const userId of nodeUsers) {
                const user = await User.findById(userId);
                if (user?.avatarName) {
                    usernames.push(user.avatarName);
                }
            }

            this.nodeUsernames.set(nodeAddress, usernames);
            
            // Broadcast to all users in the node
            nodeUsers.forEach(userId => {
                const socket = this.clients.get(userId);
                if (socket) {
                    socket.emit('users update', usernames);
                }
            });
        } catch (error) {
            logger.error('Error updating node usernames:', error);
        }
    }

    // Add helper methods for combat state management
    setUserCombatState(userId, combatState) {
        this.userCombatStates.set(userId, combatState);
    }

    getUserCombatState(userId) {
        return this.userCombatStates.get(userId);
    }

    clearUserCombatState(userId) {
        this.userCombatStates.delete(userId);
    }

    isUserInCombat(userId) {
        return this.userCombatStates.has(userId);
    }

    getCombatantEffects(combatantId) {
        return this.combatantEffects.get(combatantId) || [];
    }

    addCombatantEffect(combatantId, effect) {
        const effects = this.combatantEffects.get(combatantId) || [];
        
        // Create a complete copy of the effect with ALL properties
        const effectCopy = {
            effect: effect.effect,
            rounds: effect.rounds,
            stat: effect.stat,
            amount: effect.amount,
            target: effect.target,
            message: effect.message,
            initiator: effect.initiator
        };

        effects.push(effectCopy);
        this.combatantEffects.set(combatantId, effects);
        
        logger.debug('Added effect:', { 
            combatantId, 
            effect: effectCopy,
            allEffects: effects.map(e => ({
                effect: e.effect,
                stat: e.stat,
                amount: e.amount,
                rounds: e.rounds
            }))
        });
    }

    updateCombatantEffects(combatantId) {
        const effects = this.combatantEffects.get(combatantId) || [];
        
        logger.debug('Updating effects:', { 
            combatantId, 
            before: effects.map(e => ({
                effect: e.effect,
                stat: e.stat,
                amount: e.amount,
                rounds: e.rounds
            }))
        });
        
        // Preserve all properties when updating
        const updatedEffects = effects
            .map(effect => ({
                ...effect,
                rounds: effect.rounds - 1
            }))
            .filter(effect => effect.rounds > 0);
        
        if (updatedEffects.length > 0) {
            this.combatantEffects.set(combatantId, updatedEffects);
        } else {
            this.combatantEffects.delete(combatantId);
        }

        logger.debug('Updated effects:', { 
            combatantId, 
            after: updatedEffects.map(e => ({
                effect: e.effect,
                stat: e.stat,
                amount: e.amount,
                rounds: e.rounds
            }))
        });
    }

    clearCombatantEffects(combatantId) {
        this.combatantEffects.delete(combatantId);
    }

    // Add methods for managing combat delays
    setCombatDelay(combatantId, moveInfo) {
        this.combatDelays.set(combatantId, {
            delay: moveInfo.delay,
            move: moveInfo.move,
            target: moveInfo.target
        });
    }

    getCombatDelay(combatantId) {
        return this.combatDelays.get(combatantId);
    }

    clearCombatDelay(combatantId) {
        this.combatDelays.delete(combatantId);
    }

    // Decrement delays and return moves that are ready (delay === 0)
    processDelays(userId, mobInstanceId) {
        const readyMoves = [];
        
        // Process player move
        const playerDelay = this.combatDelays.get(userId);
        if (playerDelay) {
            playerDelay.delay--;
            if (playerDelay.delay <= 0) {
                readyMoves.push({ type: 'player', ...playerDelay });
                this.clearCombatDelay(userId);
            }
        }

        // Process mob move
        const mobDelay = this.combatDelays.get(mobInstanceId);
        if (mobDelay) {
            mobDelay.delay--;
            if (mobDelay.delay <= 0) {
                readyMoves.push({ type: 'mob', ...mobDelay });
                this.clearCombatDelay(mobInstanceId);
            }
        }

        return readyMoves;
    }

    // Event state methods
    setActiveEvent(userId, eventId, currentNode, actorId, isStoryEvent = false) {
        this.activeEvents.set(userId, {
            eventId,
            currentNode,
            actorId,
            isStoryEvent
        });
    }

    getActiveEvent(userId) {
        return this.activeEvents.get(userId);
    }

    clearActiveEvent(userId) {
        this.activeEvents.delete(userId);
    }

    isInEvent(userId) {
        return this.activeEvents.has(userId);
    }

    isInStoryEvent(userId) {
        const activeEvent = this.activeEvents.get(userId);
        return activeEvent?.isStoryEvent || false;
    }

    // Add these methods to the StateService class

    setPlayerMob(userId, mobInstance) {
        logger.debug('Setting player mob:', { 
            userId, 
            mobId: mobInstance.mobId,
            instanceId: mobInstance.instanceId,
            mobName: mobInstance.name
        });
        this.playerMobs.set(userId, mobInstance);
    }

    getPlayerMob(userId) {
        return this.playerMobs.get(userId);
    }

    clearPlayerMob(userId) {
        logger.debug('Clearing player mob:', { userId });
        this.playerMobs.delete(userId);
    }

    hasPlayerMob(userId) {
        return this.playerMobs.has(userId);
    }

    // ... Add other state management methods as needed
}

// Create a single instance
const stateService = new StateService();

// Export the instance directly
module.exports = stateService; 