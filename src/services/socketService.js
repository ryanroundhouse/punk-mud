const { getSubscriber } = require('../config/redis');
const logger = require('../config/logger');
const stateService = require('./stateService');
const messageService = require('./messageService');

class SocketService {
    /**
     * Creates a new SocketService instance
     * @param {Object} dependencies - Dependencies for the service
     * @param {Function} dependencies.getSubscriber - Function to get Redis subscriber
     * @param {Object} dependencies.logger - Logger instance
     * @param {Object} dependencies.stateService - StateService instance
     * @param {Object} dependencies.messageService - MessageService instance
     */
    constructor(dependencies = {}) {
        this.getSubscriber = dependencies.getSubscriber || getSubscriber;
        this.logger = dependencies.logger || logger;
        this.stateService = dependencies.stateService || stateService;
        this.messageService = dependencies.messageService || messageService;
        this.subscribedNodes = new Set();
        this.socketSessions = new Map(); // Store socket sessions
    }

    /**
     * Store socket session data
     * @param {string} socketId - The socket ID
     * @param {Object} sessionData - Session data to store
     */
    storeSocketSession(socketId, sessionData) {
        this.socketSessions.set(socketId, {
            ...sessionData,
            lastActive: Date.now()
        });
        this.logger.debug(`Stored session data for socket ${socketId}`);
    }

    /**
     * Find socket by ID
     * @param {string} socketId - The socket ID to find
     * @returns {Object|null} The socket session data if found
     */
    findSocketById(socketId) {
        const session = this.socketSessions.get(socketId);
        if (session) {
            // Update last active timestamp
            session.lastActive = Date.now();
            this.socketSessions.set(socketId, session);
            this.logger.debug(`Found session for socket ${socketId}`);
            return session;
        }
        return null;
    }

    /**
     * Clean up old socket sessions
     * @param {number} maxAge - Maximum age in milliseconds (default 24 hours)
     */
    cleanupOldSessions(maxAge = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [socketId, session] of this.socketSessions.entries()) {
            if (now - session.lastActive > maxAge) {
                this.socketSessions.delete(socketId);
                this.logger.debug(`Cleaned up old session for socket ${socketId}`);
            }
        }
    }

    /**
     * Update socket session data
     * @param {string} socketId - The socket ID
     * @param {Object} updates - The updates to apply to the session
     */
    updateSocketSession(socketId, updates) {
        const session = this.socketSessions.get(socketId);
        if (session) {
            this.socketSessions.set(socketId, {
                ...session,
                ...updates,
                lastActive: Date.now()
            });
            this.logger.debug(`Updated session data for socket ${socketId}`);
        }
    }

    // Start periodic cleanup of old sessions
    startSessionCleanup(interval = 60 * 60 * 1000) { // Default to every hour
        setInterval(() => {
            this.cleanupOldSessions();
        }, interval);
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

    async handleConnect(userId, nodeAddress, username) {
        try {
            // Get all users in the node
            const nodeUsers = this.stateService.getUsersInNode(nodeAddress);
            if (!nodeUsers) return;

            // Broadcast connection message to all users in the node
            nodeUsers.forEach(receiverId => {
                const socket = this.stateService.getClient(receiverId);
                if (socket) {
                    socket.emit('chat message', {
                        username: 'SYSTEM',
                        message: `${username} has connected.`,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        } catch (error) {
            this.logger.error('Error handling user connection:', error);
        }
    }

    async handleDisconnect(userId, nodeAddress, username) {
        try {
            this.logger.debug('Handling disconnect:', { userId, nodeAddress, username });
            
            // Get all users in the node
            const nodeUsers = this.stateService.getUsersInNode(nodeAddress);
            this.logger.debug('Retrieved node users for disconnect:', { 
                nodeAddress, 
                hasUsers: !!nodeUsers,
                userCount: nodeUsers?.size,
                users: nodeUsers ? Array.from(nodeUsers) : []
            });
            
            if (!nodeUsers) return;

            // Broadcast disconnection message to all users in the node
            nodeUsers.forEach(receiverId => {
                const socket = this.stateService.getClient(receiverId);
                this.logger.debug('Attempting to send disconnect message to user:', {
                    receiverId,
                    hasSocket: !!socket,
                    socketId: socket?.id
                });
                
                if (socket) {
                    const message = {
                        username: 'SYSTEM',
                        message: `${username} has disconnected.`,
                        timestamp: new Date().toISOString()
                    };
                    socket.emit('chat message', message);
                    this.logger.debug('Sent disconnect message:', { 
                        receiverId, 
                        socketId: socket.id,
                        message 
                    });
                }
            });
        } catch (error) {
            this.logger.error('Error handling user disconnection:', error);
        }
    }
}

// Create a singleton instance with default dependencies
const socketService = new SocketService();

// Export both the class and the singleton instance
module.exports = socketService;
module.exports.SocketService = SocketService; 