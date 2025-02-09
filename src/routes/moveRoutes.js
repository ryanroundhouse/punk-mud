const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getMoves, 
    getPublicMoves, 
    createOrUpdateMove, 
    deleteMove 
} = require('../controllers/moveController');

// Public move routes
router.get('/public', authenticateToken, getPublicMoves);

// Builder-only routes
router.get('/', verifyBuilderAccess, getMoves);
router.post('/', verifyBuilderAccess, createOrUpdateMove);
router.delete('/:id', verifyBuilderAccess, deleteMove);

module.exports = router; 