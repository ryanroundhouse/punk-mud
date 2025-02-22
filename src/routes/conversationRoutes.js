const express = require('express');
const router = express.Router();
const { verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getConversations,
    getConversationById,
    createOrUpdateConversation, 
    deleteConversation 
} = require('../controllers/conversationController');

// All conversation routes require builder access
router.get('/', verifyBuilderAccess, getConversations);
router.get('/:id', verifyBuilderAccess, getConversationById);
router.post('/', verifyBuilderAccess, createOrUpdateConversation);
router.delete('/:id', verifyBuilderAccess, deleteConversation);

module.exports = router; 