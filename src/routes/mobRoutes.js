const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getMobs, 
    getPublicMobs, 
    createOrUpdateMob, 
    deleteMob,
    getMobsAtNode
} = require('../controllers/mobController');

// Public mob routes
router.get('/public', authenticateToken, getPublicMobs);
router.get('/node/:address', authenticateToken, getMobsAtNode);

// Builder-only routes
router.get('/', verifyBuilderAccess, getMobs);
router.post('/', verifyBuilderAccess, createOrUpdateMob);
router.delete('/:id', verifyBuilderAccess, deleteMob);

module.exports = router; 