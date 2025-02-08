const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const { 
    registerAvatar, 
    getCharacterData, 
    getCharacterByUsername, 
    updateCharacter 
} = require('../controllers/characterController');

// Character routes
router.post('/register-avatar', authenticateToken, registerAvatar);
router.get('/data', authenticateToken, getCharacterData);
router.get('/:username', authenticateToken, getCharacterByUsername);
router.post('/update', authenticateToken, updateCharacter);

module.exports = router; 