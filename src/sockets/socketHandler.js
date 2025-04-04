const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth');
const logger = require('../config/logger');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const { handleCommand, handleGetNodeData } = require('./commandHandler');
const { handleChat } = require('./chatHandler');
const User = require('../models/User');
const messageService = require('../services/messageService');
const userService = require('../services/userService');
const nodeService = require('../services/nodeService');
function socketHandler(io) {
    // Add socket.io authentication
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error'));
        }

        try {
            const verified = jwt.verify(token, JWT_SECRET);
            socket.user = verified;
            next();
        } catch (error) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket) => {
        logger.info(`User connected: ${socket.user.email}`);
        
        // Store socket connection
        stateService.addClient(socket.user.userId, socket);

        // Get user's current node and add them to the node clients map
        try {
            const user = await User.findById(socket.user.userId);
            if (user && user.currentNode) {
                // Use the combined method that also updates usernames
                await stateService.addUserToNodeAndUpdateUsernames(socket.user.userId, user.currentNode);
                // Subscribe to node's chat channel
                await socketService.subscribeToNodeChat(user.currentNode);
                
                // Send connection message
                await socketService.handleConnect(socket.user.userId, user.currentNode, user.avatarName);
                
                // Check for mob spawn on connection
                await nodeService.getNodeEvent(socket.user.userId, user.currentNode);

                // Send character HP status after connection
                const userDetails = await userService.getUser(socket.user.userId);
                messageService.sendPlayerStatusMessage(
                    socket.user.userId, 
                    `HP: ${userDetails.stats.currentHitpoints}/${userDetails.stats.hitpoints} | Energy: ${userDetails.stats.currentEnergy}/${userDetails.stats.energy}`
                );
            }
        } catch (err) {
            logger.error('Error fetching user location:', err);
        }

        // Handle chat messages
        socket.on('chat message', (message) => handleChat(socket, message));

        // Handle console commands
        socket.on('console command', (data) => handleCommand(socket, data));

        // Register the new node data handler
        socket.on('get node data', (data) => handleGetNodeData(socket, data));

        // Handle disconnection
        socket.on('disconnect', async () => {
            logger.info(`User disconnected: ${socket.user.email}`);
            
            try {
                const user = await User.findById(socket.user.userId);
                logger.debug('Found user for disconnect:', {
                    userId: socket.user.userId,
                    hasUser: !!user,
                    currentNode: user?.currentNode,
                    avatarName: user?.avatarName
                });
                
                if (user && user.currentNode) {
                    // First remove user from node and update usernames
                    logger.debug('Removing user from node:', {
                        userId: socket.user.userId,
                        nodeAddress: user.currentNode
                    });
                    await stateService.removeUserFromNodeAndUpdateUsernames(socket.user.userId, user.currentNode);
                    
                    // Then send disconnection message to remaining users
                    logger.debug('Sending disconnect message:', {
                        userId: socket.user.userId,
                        nodeAddress: user.currentNode,
                        avatarName: user.avatarName
                    });
                    await socketService.handleDisconnect(socket.user.userId, user.currentNode, user.avatarName);
                    
                    // Finally unsubscribe from chat
                    logger.debug('Unsubscribing from chat:', {
                        userId: socket.user.userId,
                        nodeAddress: user.currentNode
                    });
                    await socketService.unsubscribeFromNodeChat(user.currentNode);
                }
                stateService.removeClient(socket.user.userId);
            } catch (error) {
                logger.error('Error handling disconnect:', error);
            }
        });
    });
}

module.exports = socketHandler;