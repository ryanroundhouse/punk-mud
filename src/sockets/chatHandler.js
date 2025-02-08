const User = require('../models/User');
const logger = require('../config/logger');
const { publishChatMessage } = require('../services/chatService');
const { handleQuestProgression } = require('../services/questService');
const Actor = require('../models/Actor');

async function handleChat(socket, message) {
    try {
        const user = await User.findById(socket.user.userId);
        if (!user || !user.avatarName || !user.currentNode) {
            throw new Error('User not found or missing required data');
        }

        const chatMessage = {
            username: user.avatarName,
            message: message,
            timestamp: new Date()
        };

        if (message.startsWith('/chat ')) {
            const targetName = message.substring(6);
            // Redirect to command system
            socket.emit('command', {
                command: 'chat',
                target: targetName
            });
            return;
        } else {
            // Publish chat message to Redis for the current node
            await publishChatMessage(user.currentNode, chatMessage);
        }

    } catch (error) {
        logger.error('Error handling chat message:', error);
        socket.emit('chat message', {
            username: 'SYSTEM',
            message: 'Error sending message',
            timestamp: new Date(),
            type: 'error'
        });
    }
}

module.exports = {
    handleChat
}; 