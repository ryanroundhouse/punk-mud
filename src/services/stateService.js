const logger = require('../config/logger');

class StateService {
    constructor() {
        this.clients = new Map();
        this.nodeClients = new Map();
        this.nodeUsernames = new Map(); // stores username lists per node
        this.subscribedNodes = new Set(); // tracks which node channels we're subscribed to
        this.actorChatStates = new Map(); // tracks last message index per user per actor
        this.playerMobs = new Map(); // tracks per-player spawned enemies
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

    // ... Add other state management methods as needed
}

const stateService = new StateService();
module.exports = stateService; 