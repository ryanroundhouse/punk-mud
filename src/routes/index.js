const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const characterRoutes = require('./characterRoutes');
const nodeRoutes = require('./nodeRoutes');
const actorRoutes = require('./actorRoutes');
const questRoutes = require('./questRoutes');
const mobRoutes = require('./mobRoutes');
const moveRoutes = require('./moveRoutes');
const uploadRoutes = require('./uploadRoutes');
const combatRoutes = require('./combatRoutes');
const classRoutes = require('./classRoutes');
const conversationRoutes = require('./conversationRoutes');

router.use('/auth', authRoutes);
router.use('/character', characterRoutes);
router.use('/nodes', nodeRoutes);
router.use('/actors', actorRoutes);
router.use('/quests', questRoutes);
router.use('/mobs', mobRoutes);
router.use('/moves', moveRoutes);
router.use('/upload', uploadRoutes);
router.use('/combat', combatRoutes);
router.use('/classes', classRoutes);
router.use('/conversations', conversationRoutes);

module.exports = router; 