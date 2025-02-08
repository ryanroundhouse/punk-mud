const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const characterRoutes = require('./characterRoutes');
const nodeRoutes = require('./nodeRoutes');
const actorRoutes = require('./actorRoutes');
const questRoutes = require('./questRoutes');
const mobRoutes = require('./mobRoutes');
const uploadRoutes = require('./uploadRoutes');

router.use('/auth', authRoutes);
router.use('/character', characterRoutes);
router.use('/nodes', nodeRoutes);
router.use('/actors', actorRoutes);
router.use('/quests', questRoutes);
router.use('/mobs', mobRoutes);
router.use('/upload', uploadRoutes);

module.exports = router; 