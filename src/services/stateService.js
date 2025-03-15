const logger = require('../config/logger');

class StateService {
    constructor(dependencies = {}) {
        // Allow dependency injection for testing
        this.logger = dependencies.logger || logger;
        this.User = dependencies.User || require('../models/User');
        
        // Initialize state
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

    // Reset state - useful for testing
    reset() {
        this.clients.clear();
        this.nodeClients.clear();
        this.nodeUsernames.clear();
        this.subscribedNodes.clear();
        this.actorChatStates.clear();
        this.playerMobs.clear();
        this.userCombatStates.clear();
        this.combatantEffects.clear();
        this.combatDelays.clear();
        this.activeEvents.clear();
    }

    addClient(userId, socket) {
        this.logger.debug('Adding client socket:', { userId });
        this.clients.set(userId, socket);
        this.logger.debug('Client socket map size:', { 
            size: this.clients.size,
            allUserIds: Array.from(this.clients.keys())
        });
    }

    getClient(userId) {
        this.logger.debug('Getting client socket:', { 
            userId,
            exists: this.clients.has(userId),
            mapSize: this.clients.size,
            allUserIds: Array.from(this.clients.keys())
        });
        return this.clients.get(userId);
    }

    removeClient(userId) {
        this.logger.debug('Removing client socket:', { userId });
        this.clients.delete(userId);
        this.logger.debug('Client socket map size after removal:', { 
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
        return nodeUsers;
    }

    removeUserFromNode(userId, nodeAddress) {
        const nodeUsers = this.nodeClients.get(nodeAddress);
        if (nodeUsers) {
            nodeUsers.delete(userId);
            if (nodeUsers.size === 0) {
                this.nodeClients.delete(nodeAddress);
                this.nodeUsernames.delete(nodeAddress);
                return null;
            }
            return nodeUsers;
        }
        return null;
    }

    getUsersInNode(nodeAddress) {
        return this.nodeClients.get(nodeAddress) || new Set();
    }

    // Separated from updateNodeUsernames to make it testable
    async fetchUsernames(userIds) {
        const usernames = [];
        
        for (const userId of userIds) {
            try {
                const user = await this.User.findById(userId);
                if (user?.avatarName) {
                    usernames.push(user.avatarName);
                }
            } catch (error) {
                this.logger.error('Error fetching username:', error);
            }
        }
        
        return usernames;
    }

    async updateNodeUsernames(nodeAddress) {
        try {
            const nodeUsers = this.nodeClients.get(nodeAddress);
            if (!nodeUsers) return [];

            const usernames = await this.fetchUsernames(Array.from(nodeUsers));
            this.nodeUsernames.set(nodeAddress, usernames);
            
            // Broadcast to all users in the node
            nodeUsers.forEach(userId => {
                const socket = this.clients.get(userId);
                if (socket) {
                    socket.emit('users update', usernames);
                }
            });
            
            return usernames;
        } catch (error) {
            this.logger.error('Error updating node usernames:', error);
            return [];
        }
    }

    setUserCombatState(userId, combatState) {
        this.userCombatStates.set(userId, combatState);
        return combatState;
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
        
        this.logger.debug('Added effect:', { 
            combatantId, 
            effect: effectCopy,
            allEffects: effects.map(e => ({
                effect: e.effect,
                stat: e.stat,
                amount: e.amount,
                rounds: e.rounds
            }))
        });
        
        return effects;
    }

    updateCombatantEffects(combatantId) {
        const effects = this.combatantEffects.get(combatantId) || [];
        
        this.logger.debug('Updating effects:', { 
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

        this.logger.debug('Updated effects:', { 
            combatantId, 
            after: updatedEffects.map(e => ({
                effect: e.effect,
                stat: e.stat,
                amount: e.amount,
                rounds: e.rounds
            }))
        });
        
        return updatedEffects;
    }

    clearCombatantEffects(combatantId) {
        this.combatantEffects.delete(combatantId);
    }

    setCombatDelay(combatantId, moveInfo) {
        const delayInfo = {
            delay: moveInfo.delay,
            move: moveInfo.move,
            target: moveInfo.target
        };
        this.combatDelays.set(combatantId, delayInfo);
        return delayInfo;
    }

    getCombatDelay(combatantId) {
        return this.combatDelays.get(combatantId);
    }

    clearCombatDelay(combatantId) {
        this.combatDelays.delete(combatantId);
    }

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

    setActiveEvent(userId, eventId, currentNode, actorId, isStoryEvent = false) {
        // Create a deep clone of the current node to avoid reference issues
        const clonedNode = JSON.parse(JSON.stringify(currentNode));
        
        // Ensure the node has an ID
        if (!clonedNode._id) {
            clonedNode._id = `generated_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        }
        
        // Get the existing event state to track history
        const existingEvent = this.activeEvents.get(userId);
        let nodeHistory = [];
        
        // If we already have an event for this user, track the history
        if (existingEvent && existingEvent.eventId === eventId) {
            // Preserve existing history or initialize it
            nodeHistory = existingEvent.nodeHistory || [];
            
            // Add the current node to history if it's not already the last item
            const lastHistoryNode = nodeHistory.length > 0 ? nodeHistory[nodeHistory.length - 1] : null;
            if (!lastHistoryNode || lastHistoryNode.nodeId !== existingEvent.currentNode._id?.toString()) {
                nodeHistory.push({
                    nodeId: existingEvent.currentNode._id?.toString(),
                    prompt: existingEvent.currentNode.prompt?.substring(0, 50) + '...',
                    timestamp: Date.now()
                });
            }
        }
        
        // Check if the node has choices with questCompletionEvents
        if (clonedNode && clonedNode.choices && clonedNode.choices.length > 0) {
            // Find a reference questCompletionEvents array if any exist
            let referenceEvents = null;
            let found = false;
            
            for (const choice of clonedNode.choices) {
                if (choice.nextNode && choice.nextNode.questCompletionEvents && choice.nextNode.questCompletionEvents.length > 0) {
                    referenceEvents = choice.nextNode.questCompletionEvents;
                    found = true;
                    break;
                }
            }
            
            // If we found a reference, apply it to all choices that don't have questCompletionEvents
            if (found && referenceEvents) {
                for (const choice of clonedNode.choices) {
                    if (choice.nextNode && (!choice.nextNode.questCompletionEvents || choice.nextNode.questCompletionEvents.length === 0)) {
                        choice.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(referenceEvents));
                    }
                }
            }
        }
        
        const eventState = {
            eventId,
            currentNode: clonedNode,
            actorId,
            isStoryEvent,
            nodeHistory: nodeHistory
        };
        
        this.activeEvents.set(userId, eventState);
        return eventState;
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

    setPlayerMob(userId, mobInstance) {
        this.logger.debug('Setting player mob:', { 
            userId, 
            mobId: mobInstance.mobId,
            instanceId: mobInstance.instanceId,
            mobName: mobInstance.name
        });
        this.playerMobs.set(userId, mobInstance);
        return mobInstance;
    }

    getPlayerMob(userId) {
        return this.playerMobs.get(userId);
    }

    clearPlayerMob(userId) {
        this.logger.debug('Clearing player mob:', { userId });
        this.playerMobs.delete(userId);
    }

    hasPlayerMob(userId) {
        return this.playerMobs.has(userId);
    }

    // New helper method that adds user and updates usernames
    async addUserToNodeAndUpdateUsernames(userId, nodeAddress) {
        const nodeUsers = this.addUserToNode(userId, nodeAddress);
        await this.updateNodeUsernames(nodeAddress);
        return nodeUsers;
    }

    // Helper method to ensure usernames are updated for a node
    async ensureNodeUsernamesUpdated(nodeAddress) {
        const nodeUsers = this.nodeClients.get(nodeAddress);
        if (nodeUsers && nodeUsers.size > 0 && (!this.nodeUsernames.has(nodeAddress) || this.nodeUsernames.get(nodeAddress).length === 0)) {
            await this.updateNodeUsernames(nodeAddress);
        }
        return this.nodeUsernames.get(nodeAddress) || [];
    }
}

// Create a singleton instance
const stateService = new StateService();

// Export both the class and singleton instance
module.exports = stateService;
module.exports.StateService = StateService; 