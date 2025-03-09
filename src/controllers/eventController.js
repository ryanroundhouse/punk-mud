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
                
                // Handle skill check failure node if it exists
                if (choice.skillCheckStat && choice.failureNode) {
                    await populateMobIds(choice.failureNode);
                }
                
                // Handle regular next node
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
    if (!node) {
        return { valid: false, message: 'Node is required' };
    }

    if (!node.prompt) {
        return { valid: false, message: 'Node prompt is required' };
    }

    if (!node.choices || !Array.isArray(node.choices) || node.choices.length === 0) {
        return { valid: false, message: 'Node must have at least one choice' };
    }

    for (const choice of node.choices) {
        if (!choice.text) {
            return { valid: false, message: 'Choice text is required' };
        }

        // A choice must have either a mobId or a nextNode
        if (!choice.mobId && !choice.nextNode && !choice.skillCheckStat) {
            return { valid: false, message: 'Choice must have either a mob, a next node, or a skill check' };
        }

        // If there's a skill check stat, validate related fields
        if (choice.skillCheckStat) {
            // Validate stat is one of the allowed values
            const validStats = ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck'];
            if (!validStats.includes(choice.skillCheckStat)) {
                return { valid: false, message: `Skill check stat must be one of: ${validStats.join(', ')}` };
            }
            
            // Validate target number
            if (!choice.skillCheckTargetNumber || choice.skillCheckTargetNumber < 1) {
                return { valid: false, message: 'Skill check must have a valid target number (minimum 1)' };
            }
            
            // Validate nextNode (success outcome)
            if (!choice.nextNode) {
                return { valid: false, message: 'Skill check must have a next node for success outcome' };
            }
            
            // Validate failure node
            if (!choice.failureNode) {
                return { valid: false, message: 'Skill check must have a failure node' };
            }
            
            // Recursively validate nextNode (success outcome)
            const nextNodeValidation = await validateNode(choice.nextNode);
            if (!nextNodeValidation.valid) {
                return { valid: false, message: `Success outcome: ${nextNodeValidation.message}` };
            }
            
            // Recursively validate failure node
            const failureNodeValidation = await validateNode(choice.failureNode);
            if (!failureNodeValidation.valid) {
                return { valid: false, message: `Failure outcome: ${failureNodeValidation.message}` };
            }
        }
        // If there's no skill check but there is a nextNode, validate it recursively
        else if (choice.nextNode) {
            const nextNodeValidation = await validateNode(choice.nextNode);
            if (!nextNodeValidation.valid) {
                return { valid: false, message: `Next node: ${nextNodeValidation.message}` };
            }
        }
    }

    return { valid: true };
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
                
                // Handle skill check failure node if it exists
                if (choice.skillCheckStat && choice.failureNode) {
                    await populateMobIds(choice.failureNode);
                }
                
                // Handle regular next node
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
                
                // Handle skill check failure node if it exists
                if (choice.skillCheckStat && choice.failureNode) {
                    await populateMobIds(choice.failureNode);
                }
                
                // Handle regular next node
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