const { getClient } = require('../config/redis');
const logger = require('../config/logger');
const stateService = require('./stateService');

async function publishSystemMessage(nodeAddress, message, personalMessage, userId) {
    const baseMessage = {
        username: 'SYSTEM',
        timestamp: new Date(),
        type: 'system'
    };

    const nodeUsers = stateService.nodeClients.get(nodeAddress);
    if (nodeUsers) {
        nodeUsers.forEach(targetUserId => {
            const userSocket = stateService.getClient(targetUserId);
            if (userSocket) {
                if (targetUserId === userId && personalMessage) {
                    userSocket.emit('chat message', {
                        ...baseMessage,
                        message: personalMessage
                    });
                } else {
                    userSocket.emit('chat message', {
                        ...baseMessage,
                        message: message
                    });
                }
            }
        });
    }
}

async function publishChatMessage(nodeAddress, message) {
    try {
        const redisClient = getClient();
        await redisClient.publish(
            `node:${nodeAddress}:chat`,
            JSON.stringify(message)
        );
    } catch (error) {
        logger.error('Error publishing chat message:', error);
        throw error;
    }
}

async function publishGlobalChatMessage(message) {
    try {
        const redisClient = getClient();
        await redisClient.publish(
            'global:chat',
            JSON.stringify(message)
        );
    } catch (error) {
        logger.error('Error publishing global chat message:', error);
        throw error;
    }
}

module.exports = {
    publishSystemMessage,
    publishChatMessage,
    publishGlobalChatMessage
}; 