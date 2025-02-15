const express = require('express');
const router = express.Router();
const { verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getQuests,
    getQuestById,
    createOrUpdateQuest, 
    deleteQuest 
} = require('../controllers/questController');

// All quest routes require builder access
router.get('/', verifyBuilderAccess, getQuests);
router.get('/:id', verifyBuilderAccess, getQuestById);
router.post('/', verifyBuilderAccess, createOrUpdateQuest);
router.delete('/:id', verifyBuilderAccess, deleteQuest);

module.exports = router; 