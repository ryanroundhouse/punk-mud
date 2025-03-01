const Event = require('../models/Event');
const logger = require('../config/logger');
const mongoose = require('mongoose');

async function getEvents(req, res) {
    try {
        const events = await Event.find()
            .sort({ title: 1 })
            .populate('actorId')
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');
        res.json(events);
    } catch (error) {
        logger.error('Error fetching events:', error);
        res.status(500).json({ error: 'Error fetching events' });
    }
}

async function validateNode(node) {
    if (!node.prompt) {
        throw new Error('Each node must have a prompt');
    }

    // Validate restrictions if present
    if (node.restrictions) {
        if (!Array.isArray(node.restrictions)) {
            throw new Error('restrictions must be an array');
        }
        const validRestrictions = ['noClass', 'enforcerOnly'];
        node.restrictions.forEach(restriction => {
            if (!validRestrictions.includes(restriction)) {
                throw new Error(`Invalid restriction: ${restriction}`);
            }
        });
    }

    // Validate questCompletionEvents if present
    if (node.questCompletionEvents) {
        if (!Array.isArray(node.questCompletionEvents)) {
            throw new Error('questCompletionEvents must be an array');
        }
    }

    if (node.choices) {
        if (!Array.isArray(node.choices)) {
            throw new Error('Choices must be an array');
        }

        node.choices.forEach(choice => {
            if (!choice.text) {
                throw new Error('Each choice must have text');
            }
            if (choice.nextNode) {
                validateNode(choice.nextNode);
            }
        });
    }
}

async function createOrUpdateEvent(req, res) {
    const { _id, title, actorId, rootNode } = req.body;
    
    try {
        // Validate basic fields
        if (!title || !rootNode || !rootNode.prompt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate the entire event tree
        try {
            await validateNode(rootNode);
        } catch (error) {
            return res.status(400).json({ 
                error: 'Invalid event structure',
                details: error.message
            });
        }

        let event;
        if (_id) {
            // Update existing event
            event = await Event.findById(_id);
            if (!event) {
                return res.status(404).json({ error: 'Event not found' });
            }

            event.title = title;
            event.actorId = actorId;
            event.rootNode = rootNode;
            await event.save();
        } else {
            // Create new event
            event = new Event({
                title,
                actorId,
                rootNode
            });
            await event.save();
        }
        
        // Populate references before sending response
        await event.populate('actorId');
        await event.populate('rootNode.requiredQuestId');
        await event.populate('rootNode.activateQuestId');
        
        res.status(_id ? 200 : 201).json(event);
    } catch (error) {
        logger.error('Error saving event:', error);
        res.status(500).json({ error: 'Error saving event', details: error.message });
    }
}

async function getEventById(req, res) {
    try {
        const event = await Event.findById(req.params.id)
            .populate('actorId')
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');
        
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        res.json(event);
    } catch (error) {
        logger.error('Error fetching event:', error);
        res.status(500).json({ error: 'Error fetching event' });
    }
}

async function deleteEvent(req, res) {
    try {
        const event = await Event.findByIdAndDelete(req.params.id);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        logger.error('Error deleting event:', error);
        res.status(500).json({ error: 'Error deleting event' });
    }
}

module.exports = {
    getEvents,
    getEventById,
    createOrUpdateEvent,
    deleteEvent
}; 