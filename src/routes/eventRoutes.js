const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth');

// Apply authentication middleware to all routes
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