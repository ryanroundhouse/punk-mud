const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const combatService = require('../services/combatService');
const logger = require('../config/logger');

// Combat status route
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const status = await combatService.getCombatStatus(req.user.userId);
        res.json(status);
    } catch (error) {
        logger.error('Error checking combat status:', error);
        res.status(500).json({ error: 'Failed to check combat status' });
    }
});

module.exports = router; 