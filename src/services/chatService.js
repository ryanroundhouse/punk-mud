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
    publishChatMessage,
    publishGlobalChatMessage
}; 