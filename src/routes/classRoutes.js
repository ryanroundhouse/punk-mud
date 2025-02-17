const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getClasses, 
    getPublicClasses, 
    createOrUpdateClass, 
    deleteClass 
} = require('../controllers/classController');

// Public class routes
router.get('/public', authenticateToken, getPublicClasses);

// Builder-only routes
router.get('/', verifyBuilderAccess, getClasses);
router.post('/', verifyBuilderAccess, createOrUpdateClass);
router.delete('/:id', verifyBuilderAccess, deleteClass);

module.exports = router; 