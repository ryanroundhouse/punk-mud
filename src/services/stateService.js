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
    }

    addClient(userId, socket) {
        this.clients.set(userId, socket);
    }

    getClient(userId) {
        return this.clients.get(userId);
    }

    removeClient(userId) {
        this.clients.delete(userId);
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
        effects.push(effect);
        this.combatantEffects.set(combatantId, effects);
        logger.debug('Added effect:', { combatantId, effect });
    }

    updateCombatantEffects(combatantId) {
        const effects = this.combatantEffects.get(combatantId) || [];
        
        logger.debug('Updating effects:', { 
            combatantId, 
            before: effects.map(e => `${e.effect} (${e.rounds})`)
        });
        
        // Decrement rounds and filter out expired effects
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
            after: updatedEffects.map(e => `${e.effect} (${e.rounds})`)
        });
    }

    clearCombatantEffects(combatantId) {
        this.combatantEffects.delete(combatantId);
    }

    // ... Add other state management methods as needed
}

// Create a single instance
const stateService = new StateService();

// Export the instance directly
module.exports = stateService; 