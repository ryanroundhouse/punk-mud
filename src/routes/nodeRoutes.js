const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getNodes, 
    getPublicNodes, 
    createOrUpdateNode, 
    deleteNode, 
    getCurrentNode 
} = require('../controllers/nodeController');

// Public node routes
router.get('/public', authenticateToken, getPublicNodes);
router.get('/:address', authenticateToken, getCurrentNode);

// Builder-only routes
router.get('/', verifyBuilderAccess, getNodes);
router.post('/', verifyBuilderAccess, createOrUpdateNode);
router.delete('/:address', verifyBuilderAccess, deleteNode);

module.exports = router; 