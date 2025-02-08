const { getSubscriber } = require('../config/redis');
const logger = require('../config/logger');
const stateService = require('./stateService');

class SocketService {
    constructor() {
        this.subscribedNodes = new Set();
    }

    async subscribeToNodeChat(nodeAddress) {
        const channel = `node:${nodeAddress}:chat`;
        
        // Only subscribe if we haven't already
        if (!this.subscribedNodes.has(channel)) {
            const subscriber = getSubscriber();
            
            await subscriber.subscribe(channel, (message) => {
                try {
                    const chatMessage = JSON.parse(message);
                    // Get the node's users and emit to each one
                    const nodeUsers = stateService.getUsersInNode(nodeAddress);
                    if (nodeUsers) {
                        nodeUsers.forEach(userId => {
                            const userSocket = stateService.getClient(userId);
                            if (userSocket) {
                                userSocket.emit('chat message', chatMessage);
                            }
                        });
                    }
                } catch (error) {
                    logger.error('Error broadcasting chat message:', error);
                }
            });

            this.subscribedNodes.add(channel);
            logger.info(`Subscribed to chat channel for node ${nodeAddress}`);
        }
    }

    async unsubscribeFromNodeChat(nodeAddress) {
        const channel = `node:${nodeAddress}:chat`;
        // Only unsubscribe if no users are left in the node
        const nodeUsers = stateService.getUsersInNode(nodeAddress);
        if (!nodeUsers || nodeUsers.size === 0) {
            const subscriber = getSubscriber();
            await subscriber.unsubscribe(channel);
            this.subscribedNodes.delete(channel);
            logger.info(`Unsubscribed from chat channel for node ${nodeAddress}`);
        }
    }

    isSubscribed(nodeAddress) {
        return this.subscribedNodes.has(`node:${nodeAddress}:chat`);
    }
}

// Create a singleton instance
const socketService = new SocketService();
module.exports = socketService; 