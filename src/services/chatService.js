const { getClient } = require('../config/redis');
const logger = require('../config/logger');
const stateService = require('./stateService');

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
        logger.debug('Publishing global chat message:', {
            channel: 'global:chat',
            message,
            timestamp: new Date().toISOString()
        });
        await redisClient.publish(
            'global:chat',
            JSON.stringify(message)
        );
        logger.info(`Published global chat message from ${message.username}`);
    } catch (error) {
        logger.error('Error publishing global chat message:', error);
        throw error;
    }
}

module.exports = {
    publishChatMessage,
    publishGlobalChatMessage
}; 