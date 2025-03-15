const { getSubscriber } = require('../config/redis');
const logger = require('../config/logger');
const stateService = require('./stateService');

class SocketService {
    /**
     * Creates a new SocketService instance
     * @param {Object} dependencies - Dependencies for the service
     * @param {Function} dependencies.getSubscriber - Function to get Redis subscriber
     * @param {Object} dependencies.logger - Logger instance
     * @param {Object} dependencies.stateService - StateService instance
     */
    constructor(dependencies = {}) {
        this.getSubscriber = dependencies.getSubscriber || getSubscriber;
        this.logger = dependencies.logger || logger;
        this.stateService = dependencies.stateService || stateService;
        this.subscribedNodes = new Set();
    }

    /**
     * Subscribe to a node's chat channel
     * @param {string} nodeAddress - The address of the node to subscribe to
     * @returns {Promise<void>}
     */
    async subscribeToNodeChat(nodeAddress) {
        const channel = `node:${nodeAddress}:chat`;
        
        // Only subscribe if we haven't already
        if (!this.subscribedNodes.has(channel)) {
            const subscriber = this.getSubscriber();
            
            await subscriber.subscribe(channel, (message) => {
                try {
                    const chatMessage = JSON.parse(message);
                    // Get the node's users and emit to each one
                    const nodeUsers = this.stateService.getUsersInNode(nodeAddress);
                    if (nodeUsers) {
                        nodeUsers.forEach(userId => {
                            const userSocket = this.stateService.getClient(userId);
                            if (userSocket) {
                                userSocket.emit('chat message', chatMessage);
                            }
                        });
                    }
                } catch (error) {
                    this.logger.error('Error broadcasting chat message:', error);
                }
            });

            this.subscribedNodes.add(channel);
            this.logger.info(`Subscribed to chat channel for node ${nodeAddress}`);
        }
    }

    /**
     * Unsubscribe from a node's chat channel
     * @param {string} nodeAddress - The address of the node to unsubscribe from
     * @returns {Promise<void>}
     */
    async unsubscribeFromNodeChat(nodeAddress) {
        const channel = `node:${nodeAddress}:chat`;
        // Only unsubscribe if no users are left in the node
        const nodeUsers = this.stateService.getUsersInNode(nodeAddress);
        if (!nodeUsers || nodeUsers.size === 0) {
            const subscriber = this.getSubscriber();
            await subscriber.unsubscribe(channel);
            this.subscribedNodes.delete(channel);
            this.logger.info(`Unsubscribed from chat channel for node ${nodeAddress}`);
        }
    }

    /**
     * Check if we're subscribed to a node's chat channel
     * @param {string} nodeAddress - The address of the node
     * @returns {boolean} Whether we're subscribed
     */
    isSubscribed(nodeAddress) {
        return this.subscribedNodes.has(`node:${nodeAddress}:chat`);
    }
}

// Create a singleton instance with default dependencies
const socketService = new SocketService();

// Export both the class and the singleton instance
module.exports = socketService;
module.exports.SocketService = SocketService; 