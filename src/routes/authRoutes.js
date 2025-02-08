const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');

// Authentication routes
router.post('/login', login);
router.post('/authenticate', authenticate);
router.get('/verify-token', authenticateToken, (req, res) => {
    res.json({ 
        user: {
            email: req.user.email,
            avatarName: req.user.avatarName
        }
    });
});

module.exports = router; 