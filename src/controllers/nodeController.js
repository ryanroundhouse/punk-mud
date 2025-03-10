const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const { publishSystemMessage } = require('../services/chatService');
const mongoose = require('mongoose');

async function getNodes(req, res) {
    try {
        const nodes = await Node.find().sort({ name: 1 });
        res.json(nodes);
    } catch (error) {
        logger.error('Error fetching nodes:', error);
        res.status(500).json({ error: 'Error fetching nodes' });
    }
}

async function getPublicNodes(req, res) {
    try {
        const nodes = await Node.find({}, 'address name description isRestPoint');
        res.json(nodes);
    } catch (error) {
        logger.error('Error fetching public nodes:', error);
        res.status(500).json({ error: 'Error fetching nodes' });
    }
}

async function createOrUpdateNode(req, res) {
    const { id, name, address, description, image, exits, events, isRestPoint } = req.body;
    
    try {
        if (!name || !address || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate events array
        if (events) {
            for (const event of events) {
                // Check that exactly one of mobId or eventId is present
                if ((!event.mobId && !event.eventId) || (event.mobId && event.eventId)) {
                    return res.status(400).json({
                        error: 'Invalid event configuration',
                        details: 'Event must have either mobId OR eventId, not both or neither'
                    });
                }

                // Validate chance
                if (typeof event.chance !== 'number' || event.chance < 0 || event.chance > 100) {
                    return res.status(400).json({
                        error: 'Invalid event chance',
                        details: 'Event chance must be a number between 0 and 100'
                    });
                }

                // If it's an Event type event, verify it exists
                if (event.eventId) {
                    const eventExists = await mongoose.model('Event').exists({ _id: event.eventId });
                    if (!eventExists) {
                        return res.status(400).json({
                            error: 'Invalid event reference',
                            details: `Event with ID "${event.eventId}" does not exist`
                        });
                    }
                }
            }
        }

        if (id) {
            // Check if another node with the same address exists (excluding the current node)
            const duplicateNode = await Node.findOne({ 
                address: address, 
                _id: { $ne: id } 
            });
            
            if (duplicateNode) {
                return res.status(400).json({ 
                    error: 'Duplicate address', 
                    details: `Another node with address "${address}" already exists` 
                });
            }

            // Use findByIdAndUpdate to avoid race conditions
            const updatedNode = await Node.findByIdAndUpdate(
                id,
                {
                    name,
                    address,
                    description,
                    image,
                    exits,
                    events,
                    isRestPoint
                },
                { new: true, runValidators: true }
            );
            
            if (!updatedNode) {
                return res.status(404).json({ error: 'Node not found' });
            }
            
            return res.json(updatedNode);
        } else {
            // Check if a node with this address already exists
            const existingNode = await Node.findOne({ address });
            if (existingNode) {
                return res.status(400).json({ 
                    error: 'Duplicate address', 
                    details: `A node with address "${address}" already exists` 
                });
            }

            const node = new Node({
                name,
                address,
                description,
                image,
                exits,
                events,
                isRestPoint
            });
            
            await node.save();
            res.status(201).json(node);
        }
    } catch (error) {
        logger.error('Error saving node:', error);
        res.status(500).json({ error: error.message });
    }
}

async function deleteNode(req, res) {
    try {
        const node = await Node.findOneAndDelete({ address: req.params.address });
        if (!node) {
            return res.status(404).json({ error: 'Node not found' });
        }
        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        logger.error('Error deleting node:', error);
        res.status(500).json({ error: 'Error deleting node' });
    }
}

async function getCurrentNode(req, res) {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const node = await Node.findOne({ address: user.currentNode });
        if (!node) {
            return res.status(404).json({ error: 'Node not found' });
        }

        // Handle node change
        if (user.currentNode) {
            // Remove from old node and unsubscribe
            stateService.removeUserFromNode(user._id.toString(), user.currentNode);
            await socketService.unsubscribeFromNodeChat(user.currentNode);
            
            // Add to new node and subscribe
            stateService.addUserToNode(user._id.toString(), node.address);
            await socketService.subscribeToNodeChat(node.address);
        }

        // Check for quest-specific node event overrides
        const questService = require('../services/questService');
        const questNodeEvents = await questService.getQuestNodeEventOverrides(user._id.toString(), user.currentNode);
        
        // Create a copy of the node to avoid modifying the database object
        const nodeData = node.toObject();
        
        // If there are quest overrides, include them in the node data
        if (questNodeEvents && questNodeEvents.length > 0) {
            logger.debug('Including quest event overrides in node data for frontend:', {
                address: user.currentNode,
                userId: user._id.toString(),
                originalEvents: nodeData.events?.length || 0,
                questEventCount: questNodeEvents.length
            });
            
            // Add the quest events to the node data
            nodeData.events = questNodeEvents;
        }

        res.json(nodeData);
    } catch (error) {
        logger.error('Error fetching current node:', error);
        res.status(500).json({ error: 'Error fetching node' });
    }
}

module.exports = {
    getNodes,
    getPublicNodes,
    createOrUpdateNode,
    deleteNode,
    getCurrentNode
}; 