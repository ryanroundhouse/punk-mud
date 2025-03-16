/**
 * EventNodeService
 * 
 * Handles event node traversal, validation, and structure management.
 * Extracted from eventService.js to improve separation of concerns and testability.
 */

const logger = require('../config/logger');
const mongoose = require('mongoose');

class EventNodeService {
    /**
     * Find a node in the event tree by ID
     * 
     * @param {Object} event - The event object containing the tree structure
     * @param {String} nodeId - The ID of the node to find
     * @returns {Object|null} - The found node or null if not found
     */
    findNodeInEventTree(event, nodeId) {
        if (!nodeId) {
            return event.rootNode;
        }
        
        // Use a queue for breadth-first search with path tracking
        const queue = [{
            node: event.rootNode,
            path: 'rootNode'
        }];
        
        logger.debug('Starting node search in event tree', {
            eventId: event._id?.toString(),
            targetNodeId: nodeId,
            rootNodeHasChoices: event.rootNode.choices?.length > 0
        });
        
        while (queue.length > 0) {
            const { node, path } = queue.shift();
            
            // More robust ID comparison, handling both string and ObjectId
            const nodeIdStr = node._id?.toString();
            
            // Check if this is the node we're looking for
            if (nodeIdStr === nodeId || 
                (node._id && nodeId === node._id) || 
                (node._id?.$oid && nodeId === node._id.$oid)) {
                logger.debug('Found node in event tree', {
                    path,
                    nodeId: nodeIdStr
                });
                return node;
            }
            
            // Add child nodes to the queue with their paths
            if (node.choices && Array.isArray(node.choices)) {
                node.choices.forEach((choice, choiceIndex) => {
                    if (choice.nextNode) {
                        const choicePath = `${path}.choices[${choiceIndex}].nextNode`;
                        queue.push({
                            node: choice.nextNode,
                            path: choicePath
                        });
                        
                        // Ensure the node has an ID for future lookups
                        if (!choice.nextNode._id) {
                            // Generate a stable ID based on the path
                            choice.nextNode._id = `generated_${choicePath.replace(/\./g, '_')}`;
                            logger.debug('Generated ID for node without _id', {
                                generatedId: choice.nextNode._id,
                                path: choicePath
                            });
                        }
                    }
                });
            }
        }
        
        logger.warn('Node not found in event tree', {
            targetNodeId: nodeId,
            eventId: event._id?.toString(),
            queueProcessed: true
        });
        return null;
    }

    /**
     * Generate an ID for a node if it doesn't have one
     * 
     * @param {Object} node - The node to ensure has an ID
     * @param {String} path - The path to the node (for ID generation)
     * @returns {String} - The ID of the node (existing or newly generated)
     */
    ensureNodeHasId(node, path = '') {
        if (!node._id) {
            // Generate a predictable ID
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 10);
            const pathSuffix = path ? `_${path.replace(/\./g, '_')}` : '';
            node._id = `generated_${timestamp}${pathSuffix}_${randomSuffix}`;
            
            logger.debug('Generated ID for node', { 
                generatedId: node._id,
                path
            });
        }
        
        return node._id.toString();
    }

    /**
     * Validates and normalizes a node's structure to ensure consistent format
     * 
     * @param {Object} node - The node to validate and normalize
     * @returns {Object} - The normalized node
     */
    validateNodeStructure(node) {
        if (!node) {
            logger.error('Node is null or undefined');
            return null;
        }

        // Ensure the node has an ID
        this.ensureNodeHasId(node);

        // Make sure choices array is properly initialized
        if (node.choices === undefined) {
            node.choices = [];
            logger.debug('Initialized empty choices array for node');
        }

        return node;
    }

    /**
     * Ensures consistency of questCompletionEvents across all choices in a node
     * 
     * @param {Object} node - The node whose choices should have consistent quest events
     * @returns {Object} - The node with consistent quest events
     */
    ensureConsistentQuestEvents(node) {
        if (!node?.choices || !Array.isArray(node.choices) || node.choices.length === 0) {
            return node;
        }

        // Find a choice with questCompletionEvents to use as a reference
        const referenceChoice = node.choices.find(c => 
            c.nextNode && c.nextNode.questCompletionEvents && c.nextNode.questCompletionEvents.length > 0
        );
        
        if (referenceChoice) {
            const refEvents = referenceChoice.nextNode.questCompletionEvents;
            logger.debug('Found reference questCompletionEvents:', {
                events: refEvents,
                refChoiceText: referenceChoice.text?.substring(0, 30) + '...'
            });
            
            // Apply the same questCompletionEvents to all choices that don't have them
            let fixedCount = 0;
            node.choices.forEach(c => {
                if (c.nextNode && (!c.nextNode.questCompletionEvents || c.nextNode.questCompletionEvents.length === 0)) {
                    // Deep clone the reference events array
                    c.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(refEvents));
                    fixedCount++;
                }
            });
            
            if (fixedCount > 0) {
                logger.debug(`Fixed questCompletionEvents for ${fixedCount} choices`, {
                    nodeChoicesCount: node.choices.length,
                    eventsApplied: refEvents
                });
            }
        }

        return node;
    }

    /**
     * Load the current event node from database by ID
     * 
     * @param {String} eventId - ID of the event
     * @param {String} nodeId - ID of the node to find
     * @returns {Promise<Object|null>} - The found node or null
     */
    async loadNodeFromDatabase(eventId, nodeId) {
        try {
            const Event = mongoose.model('Event');
            const event = await Event.findById(eventId).lean();
            
            if (!event) {
                logger.error('Event not found in database:', { eventId });
                return null;
            }

            logger.debug('Loaded event from database:', {
                eventId: event._id.toString(),
                title: event.title,
                hasRootNode: !!event.rootNode
            });

            // Find the current node in the event tree
            const node = this.findNodeInEventTree(event, nodeId);
            
            if (!node) {
                logger.error('Node not found in event tree:', {
                    eventId: event._id.toString(),
                    nodeId
                });
                return null;
            }
            
            // Validate and normalize the node structure
            const validatedNode = this.validateNodeStructure(node);
            
            // Ensure consistent quest completion events
            return this.ensureConsistentQuestEvents(validatedNode);
        } catch (error) {
            logger.error('Error loading node from database:', { 
                error: error.message, 
                stack: error.stack,
                eventId,
                nodeId
            });
            return null;
        }
    }

    /**
     * Deep clone a node to avoid reference issues
     * 
     * @param {Object} node - The node to clone
     * @returns {Object} - A deep copy of the node
     */
    cloneNode(node) {
        return JSON.parse(JSON.stringify(node));
    }
}

module.exports = new EventNodeService(); 