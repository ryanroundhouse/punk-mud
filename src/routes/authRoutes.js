const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');
const { rateLimiterMiddleware } = require('../middlewares/rateLimiter');

// Authentication routes
router.post('/login', rateLimiterMiddleware, login);
router.post('/authenticate', rateLimiterMiddleware, authenticate);
router.get('/verify-token', authenticateToken, (req, res) => {
    res.json({ 
        user: {
            email: req.user.email,
            avatarName: req.user.avatarName
        }
    });
});

module.exports = router; 