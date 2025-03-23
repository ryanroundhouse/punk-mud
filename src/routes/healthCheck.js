const express = require('express');
const mongoose = require('mongoose');
const { getClient } = require('../config/redis');
const logger = require('../config/logger');

const router = express.Router();

/**
 * Health check endpoint to verify the application and its dependencies are running
 */
router.get('/health', async (req, res) => {
  try {
    // Check MongoDB connection
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Check Redis connection
    const redisClient = getClient();
    const redisStatus = redisClient && redisClient.isOpen ? 'connected' : 'disconnected';
    
    // Overall status
    const status = dbStatus === 'connected' && redisStatus === 'connected' ? 'healthy' : 'unhealthy';
    
    // Response object
    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      services: {
        application: 'running',
        database: dbStatus,
        cache: redisStatus
      },
      version: process.env.npm_package_version || '1.0.0'
    };
    
    // Log health check for monitoring
    if (status === 'healthy') {
      logger.debug('Health check passed', healthData);
    } else {
      logger.warn('Health check failed', healthData);
    }
    
    // Return appropriate status code based on health
    return res.status(status === 'healthy' ? 200 : 503).json(healthData);
  } catch (error) {
    logger.error('Health check error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error performing health check',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 