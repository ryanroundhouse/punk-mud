const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getActors, 
    getPublicActors, 
    createOrUpdateActor, 
    deleteActor 
} = require('../controllers/actorController');

// Public actor routes
router.get('/public', authenticateToken, getPublicActors);

// Builder-only routes
router.get('/', verifyBuilderAccess, getActors);
router.post('/', verifyBuilderAccess, createOrUpdateActor);
router.delete('/:id', verifyBuilderAccess, deleteActor);

module.exports = router; 