const { createClient } = require('redis');
const logger = require('./logger');

let redisClient;
let redisSubscriber;

async function connectRedis() {
    // Use environment variable with fallback for development
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
    
    redisClient = createClient({
        url: redisUrl
    });

    redisSubscriber = redisClient.duplicate();

    // Connect both clients
    await Promise.all([redisClient.connect(), redisSubscriber.connect()]);
    logger.info('Connected to Redis');

    // Add error handling
    redisClient.on('error', (err) => {
        logger.error('Redis error:', err);
    });

    redisSubscriber.on('error', (err) => {
        logger.error('Redis subscriber error:', err);
    });
}

async function disconnect() {
    await redisClient?.quit();
    await redisSubscriber?.quit();
}

module.exports = {
    connectRedis,
    disconnect,
    getClient: () => redisClient,
    getSubscriber: () => redisSubscriber
}; 