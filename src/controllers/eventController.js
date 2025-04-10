const Event = require('../models/Event');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const stateService = require('../services/stateService');
const eventService = require('../services/eventService');

// Function to recursively add MongoDB ObjectIds to all nodes in the event tree
function assignNodeIds(node) {
    if (!node) return;
    
    // Assign an ID to this node if it doesn't have one
    if (!node._id) {
        node._id = new mongoose.Types.ObjectId();
    } else if (typeof node._id === 'object' && node._id.$oid) {
        // Convert $oid format to actual ObjectId
        node._id = new mongoose.Types.ObjectId(node._id.$oid);
    } else if (typeof node._id === 'string') {
        // Convert string ID to ObjectId
        node._id = new mongoose.Types.ObjectId(node._id);
    }
    
    // Process choices
    if (node.choices && Array.isArray(node.choices)) {
        node.choices.forEach(choice => {
            // Assign an ID to the choice if it doesn't have one
            if (!choice._id) {
                choice._id = new mongoose.Types.ObjectId();
            } else if (typeof choice._id === 'object' && choice._id.$oid) {
                // Convert $oid format to actual ObjectId
                choice._id = new mongoose.Types.ObjectId(choice._id.$oid);
            } else if (typeof choice._id === 'string') {
                // Convert string ID to ObjectId
                choice._id = new mongoose.Types.ObjectId(choice._id);
            }
            
            // Process nextNode recursively
            if (choice.nextNode) {
                assignNodeIds(choice.nextNode);
            }
            
            // Process failureNode for skill checks
            if (choice.failureNode) {
                assignNodeIds(choice.failureNode);
            }
        });
    }
    
    return node;
}

async function getEvents(req, res) {
    try {
        const events = await Event.find()
            .sort({ title: 1 })
            .populate('actorId')
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');
        
        // We need to manually populate mob references in choices at any level
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
                
                // Populate teleportToNode if it exists
                if (choice.teleportToNode) {
                    try {
                        const Node = mongoose.model('Node');
                        const node = await Node.findOne({ address: choice.teleportToNode });
                        if (node) {
                            choice.teleportToNodeDetails = {
                                _id: node._id,
                                name: node.name,
                                address: node.address
                            };
                        }
                    } catch (err) {
                        logger.error('Error populating teleport node reference:', err);
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

    // Validate blockIfQuestEventIds if present
    if (node.blockIfQuestEventIds) {
        if (!Array.isArray(node.blockIfQuestEventIds)) {
            return { valid: false, message: 'blockIfQuestEventIds must be an array' };
        }
        
        // Ensure all IDs are strings
        for (const id of node.blockIfQuestEventIds) {
            if (typeof id !== 'string') {
                return { valid: false, message: 'All quest event IDs in blockIfQuestEventIds must be strings' };
            }
        }
    }

    if (!Array.isArray(node.choices)) {
        return { valid: false, message: 'Node must have a choices array' };
    }

    for (const choice of node.choices) {
        if (!choice.text) {
            return { valid: false, message: 'Choice text is required' };
        }

        // A choice must have either a mobId, a nextNode, a teleportToNode, or a skillCheckStat
        if (!choice.mobId && !choice.nextNode && !choice.skillCheckStat && !choice.teleportToNode) {
            return { valid: false, message: 'Choice must have either a mob, a next node, a teleport destination, or a skill check' };
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

// Validate that event chances sum to 100% or there are no events
function validateEventChances(events) {
    // If there are no events, that's valid
    if (!events || events.length === 0) {
        return { valid: true };
    }
    
    // Calculate the sum of all event chances
    const totalChance = events.reduce((sum, event) => sum + (event.chance || 0), 0);
    
    // Check if the total is exactly 100 or there are no events
    if (totalChance === 100) {
        return { valid: true };
    } else {
        return { 
            valid: false, 
            message: `Event chances must sum to exactly 100% (current total: ${totalChance}%)`
        };
    }
}

async function createOrUpdateEvent(req, res) {
    const { _id, title, actorId, rootNode, requiresEnergy, events } = req.body;
    
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
        
        // Validate event chances
        const chanceValidation = validateEventChances(events);
        if (!chanceValidation.valid) {
            return res.status(400).json({ 
                error: 'Invalid event chances',
                details: chanceValidation.message
            });
        }

        // Ensure all nodes have proper IDs before saving
        assignNodeIds(rootNode);
        
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
            event.events = events;
            await event.save();
        } else {
            // Create new event
            event = new Event({
                title,
                actorId,
                rootNode,
                requiresEnergy,
                events
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
                
                // Populate teleportToNode if it exists
                if (choice.teleportToNode) {
                    try {
                        const Node = mongoose.model('Node');
                        const node = await Node.findOne({ address: choice.teleportToNode });
                        if (node) {
                            choice.teleportToNodeDetails = {
                                _id: node._id,
                                name: node.name,
                                address: node.address
                            };
                        }
                    } catch (err) {
                        logger.error('Error populating teleport node reference:', err);
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
                
                // Populate teleportToNode if it exists
                if (choice.teleportToNode) {
                    try {
                        const Node = mongoose.model('Node');
                        const node = await Node.findOne({ address: choice.teleportToNode });
                        if (node) {
                            choice.teleportToNodeDetails = {
                                _id: node._id,
                                name: node.name,
                                address: node.address
                            };
                        }
                    } catch (err) {
                        logger.error('Error populating teleport node reference:', err);
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

async function getEventStatus(req, res) {
    try {
        const userId = req.user.userId;
        
        // Check if user is in an event using stateService
        const isInEvent = stateService.isInStoryEvent(userId);
        
        // Get additional details if in an event
        let eventDetails = null;
        if (isInEvent) {
            const activeEvent = stateService.getActiveEvent(userId);
            if (activeEvent) {
                eventDetails = {
                    eventId: activeEvent.eventId,
                    hasChoices: activeEvent.currentNode && 
                               activeEvent.currentNode.choices && 
                               activeEvent.currentNode.choices.length > 0
                };
            }
        }
        
        res.json({ 
            inEvent: isInEvent,
            eventDetails
        });
    } catch (error) {
        logger.error('Error getting event status:', error);
        res.status(500).json({ error: 'Error checking event status' });
    }
}

module.exports = {
    getEvents,
    getEventById,
    createOrUpdateEvent,
    deleteEvent,
    getEventStatus
}; 