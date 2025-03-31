const express = require('express');
const router = express.Router();
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getAllUsers,
    getUserById
} = require('../controllers/userController');

// All user admin routes require authentication and builder access
router.use(authenticateToken);
router.use(verifyBuilderAccess);

// User admin routes
router.get('/', getAllUsers);
router.get('/:userId', getUserById);

module.exports = router; 