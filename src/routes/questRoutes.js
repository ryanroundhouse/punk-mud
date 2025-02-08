const express = require('express');
const router = express.Router();
const { verifyBuilderAccess } = require('../middlewares/auth');
const { 
    getQuests, 
    createOrUpdateQuest, 
    deleteQuest 
} = require('../controllers/questController');

// All quest routes require builder access
router.get('/', verifyBuilderAccess, getQuests);
router.post('/', verifyBuilderAccess, createOrUpdateQuest);
router.delete('/:id', verifyBuilderAccess, deleteQuest);

module.exports = router; 