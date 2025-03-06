const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth');
const logger = require('../config/logger');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const { handleCommand } = require('./commandHandler');
const { handleChat } = require('./chatHandler');
const User = require('../models/User');
const { handlePlayerNodeConnection } = require('../services/nodeService');
const messageService = require('../services/messageService');
const userService = require('../services/userService');

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
                stateService.addUserToNode(socket.user.userId, user.currentNode);
                // Subscribe to node's chat channel
                await socketService.subscribeToNodeChat(user.currentNode);
                
                // Check for mob spawn on connection
                await handlePlayerNodeConnection(socket.user.userId, user.currentNode);

                // Send character HP status after connection
                const userDetails = await userService.getUser(socket.user.userId);
                const hpStatus = `HP: ${userDetails.stats.currentHitpoints}/${userDetails.stats.hitpoints}`;
                messageService.sendPlayerStatusMessage(socket.user.userId, hpStatus);
            }
        } catch (err) {
            logger.error('Error fetching user location:', err);
        }

        // Handle chat messages
        socket.on('chat message', (message) => handleChat(socket, message));

        // Handle console commands
        socket.on('console command', (data) => handleCommand(socket, data));

        // Handle disconnection
        socket.on('disconnect', async () => {
            logger.info(`User disconnected: ${socket.user.email}`);
            
            try {
                const user = await User.findById(socket.user.userId);
                if (user && user.currentNode) {
                    stateService.removeUserFromNode(socket.user.userId, user.currentNode);
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