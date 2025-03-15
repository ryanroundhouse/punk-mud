const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const nodeService = require('../services/nodeService');
const stateService = require('../services/stateService');
const socketService = require('../services/socketService');
const { publishSystemMessage } = require('../services/chatService');
const mongoose = require('mongoose');
const questService = require('../services/questService');

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
        // Get all nodes but only return basic information
        const nodes = await Node.find({}, 'address name description isRestPoint exits');
        
        // Convert to plain objects for manipulation
        const nodesData = nodes.map(node => node.toObject());
        
        // If user is authenticated, filter exits based on their quest progress
        if (req.user && req.user.userId) {
            const user = await User.findById(req.user.userId);
            if (user) {
                // Get user's quest information
                const userQuestInfo = await questService.getUserQuestInfo(user._id.toString());
                
                // For each node, filter exits based on quest requirements
                for (const nodeData of nodesData) {
                    // If the node has exits, filter them
                    if (nodeData.exits && nodeData.exits.length > 0) {
                        nodeData.exits = nodeData.exits.filter(exit => {
                            // If exit has no quest requirements, keep it
                            if (!exit.requiredQuestId && !exit.requiredQuestEventId) {
                                return true;
                            }
                            
                            // Check quest requirement
                            if (exit.requiredQuestId) {
                                const hasRequiredQuest = userQuestInfo.activeQuestIds && 
                                    userQuestInfo.activeQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
                                
                                const hasCompletedQuest = userQuestInfo.completedQuestIds && 
                                    userQuestInfo.completedQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
                                
                                if (!hasRequiredQuest && !hasCompletedQuest) {
                                    logger.debug('Filtering public exit due to missing required quest', {
                                        userId: user._id.toString(),
                                        direction: exit.direction,
                                        requiredQuestId: exit.requiredQuestId
                                    });
                                    return false;
                                }
                            }
                            
                            // Check quest event requirement
                            if (exit.requiredQuestEventId) {
                                const hasRequiredQuestEvent = userQuestInfo.completedQuestEventIds && 
                                    userQuestInfo.completedQuestEventIds.some(id => id.toString() === exit.requiredQuestEventId.toString());
                                
                                if (!hasRequiredQuestEvent) {
                                    logger.debug('Filtering public exit due to missing required quest event', {
                                        userId: user._id.toString(),
                                        direction: exit.direction,
                                        requiredQuestEventId: exit.requiredQuestEventId
                                    });
                                    return false;
                                }
                            }
                            
                            // If all requirements are met, keep the exit
                            return true;
                        });
                    }
                }
            }
        }
        
        res.json(nodesData);
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

        // Validate exits array
        if (exits) {
            for (const exit of exits) {
                // Validate requiredQuestId if present
                if (exit.requiredQuestId) {
                    const questExists = await mongoose.model('Quest').exists({ _id: exit.requiredQuestId });
                    if (!questExists) {
                        return res.status(400).json({
                            error: 'Invalid quest reference',
                            details: `Quest with ID "${exit.requiredQuestId}" does not exist`
                        });
                    }
                }
                
                // Validate requiredQuestEventId if present
                if (exit.requiredQuestEventId) {
                    const questEventExists = await mongoose.model('QuestEvent').exists({ _id: exit.requiredQuestEventId });
                    if (!questEventExists) {
                        return res.status(400).json({
                            error: 'Invalid quest event reference',
                            details: `Quest Event with ID "${exit.requiredQuestEventId}" does not exist`
                        });
                    }
                }
            }
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
            await stateService.addUserToNodeAndUpdateUsernames(user._id.toString(), node.address);
            await socketService.subscribeToNodeChat(node.address);
        }

        // Get user's quest information to filter exits
        const userQuestInfo = await questService.getUserQuestInfo(user._id.toString());
        
        // Create a copy of the node to avoid modifying the database object
        const nodeData = node.toObject();
        
        // Filter exits based on quest requirements
        if (nodeData.exits && nodeData.exits.length > 0) {
            nodeData.exits = nodeData.exits.filter(exit => {
                // If exit has no quest requirements, keep it
                if (!exit.requiredQuestId && !exit.requiredQuestEventId) {
                    return true;
                }
                
                // Check quest requirement
                if (exit.requiredQuestId) {
                    const hasRequiredQuest = userQuestInfo.activeQuestIds && 
                        userQuestInfo.activeQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
                    
                    const hasCompletedQuest = userQuestInfo.completedQuestIds && 
                        userQuestInfo.completedQuestIds.some(id => id.toString() === exit.requiredQuestId.toString());
                    
                    if (!hasRequiredQuest && !hasCompletedQuest) {
                        logger.debug('Filtering exit due to missing required quest', {
                            userId: user._id.toString(),
                            direction: exit.direction,
                            requiredQuestId: exit.requiredQuestId
                        });
                        return false;
                    }
                }
                
                // Check quest event requirement
                if (exit.requiredQuestEventId) {
                    const hasRequiredQuestEvent = userQuestInfo.completedQuestEventIds && 
                        userQuestInfo.completedQuestEventIds.some(id => id.toString() === exit.requiredQuestEventId.toString());
                    
                    if (!hasRequiredQuestEvent) {
                        logger.debug('Filtering exit due to missing required quest event', {
                            userId: user._id.toString(),
                            direction: exit.direction,
                            requiredQuestEventId: exit.requiredQuestEventId
                        });
                        return false;
                    }
                }
                
                // If all requirements are met, keep the exit
                return true;
            });
        }

        // Check for quest-specific node event overrides
        const questNodeEvents = await questService.getQuestNodeEventOverrides(user._id.toString(), user.currentNode);
        
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