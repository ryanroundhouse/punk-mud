const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');

// Public routes that only need authentication
router.get('/status', authenticateToken, eventController.getEventStatus);

// Apply authentication and builder access middleware to admin routes
router.use(authenticateToken);
router.use(verifyBuilderAccess);

// Get all events
router.get('/', eventController.getEvents);

// Get event by ID
router.get('/:id', eventController.getEventById);

// Create or update event
router.post('/', eventController.createOrUpdateEvent);

// Delete event
router.delete('/:id', eventController.deleteEvent);

module.exports = router; 