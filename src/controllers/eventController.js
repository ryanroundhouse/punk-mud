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
        
        // We need to manually populate mob references in choices at any level
        // This is a recursive function to populate mobId in all choices
        const populateMobIds = async (node) => {
            if (!node || !node.choices) return;
            
            for (const choice of node.choices) {
                if (choice.mobId) {
                    try {
                        const Mob = mongoose.model('Mob');
                        choice.mobId = await Mob.findById(choice.mobId);
                    } catch (err) {
                        logger.error('Error populating mob reference:', err);
                    }
                }
                
                if (choice.nextNode) {
                    await populateMobIds(choice.nextNode);
                }
            }
        };
        
        // Populate mob references for all events
        for (const event of events) {
            await populateMobIds(event.rootNode);
        }
        
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
            
            // A choice can have either a nextNode or a mobId, but not both
            if (choice.nextNode && choice.mobId) {
                throw new Error('A choice cannot have both a nextNode and a mobId');
            }
            
            if (choice.nextNode) {
                validateNode(choice.nextNode);
            }
            
            // Validate mobId if present (just check if it's a valid ObjectId)
            if (choice.mobId && !mongoose.Types.ObjectId.isValid(choice.mobId)) {
                throw new Error('Invalid mobId format');
            }
        });
    }
}

async function createOrUpdateEvent(req, res) {
    const { _id, title, actorId, rootNode, requiresEnergy } = req.body;
    
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
            event.requiresEnergy = requiresEnergy;
            await event.save();
        } else {
            // Create new event
            event = new Event({
                title,
                actorId,
                rootNode,
                requiresEnergy
            });
            await event.save();
        }
        
        // Populate references before sending response
        await event.populate('actorId');
        await event.populate('rootNode.requiredQuestId');
        await event.populate('rootNode.activateQuestId');
        
        // Populate mob references
        const populateMobIds = async (node) => {
            if (!node || !node.choices) return;
            
            for (const choice of node.choices) {
                if (choice.mobId) {
                    try {
                        const Mob = mongoose.model('Mob');
                        choice.mobId = await Mob.findById(choice.mobId);
                    } catch (err) {
                        logger.error('Error populating mob reference:', err);
                    }
                }
                
                if (choice.nextNode) {
                    await populateMobIds(choice.nextNode);
                }
            }
        };
        
        await populateMobIds(event.rootNode);
        
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
        
        // Reuse the populateMobIds function to populate mob references
        const populateMobIds = async (node) => {
            if (!node || !node.choices) return;
            
            for (const choice of node.choices) {
                if (choice.mobId) {
                    try {
                        const Mob = mongoose.model('Mob');
                        choice.mobId = await Mob.findById(choice.mobId);
                    } catch (err) {
                        logger.error('Error populating mob reference:', err);
                    }
                }
                
                if (choice.nextNode) {
                    await populateMobIds(choice.nextNode);
                }
            }
        };
        
        await populateMobIds(event.rootNode);
        
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