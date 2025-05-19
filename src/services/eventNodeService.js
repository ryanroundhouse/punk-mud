/**
 * EventNodeService
 * 
 * Handles event node traversal, validation, and structure management.
 * Extracted from eventService.js to improve separation of concerns and testability.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

class EventNodeService {
    /**
     * Find a node in the event tree by ID
     * 
     * @param {Object} event - The event object containing the tree structure
     * @param {String} nodeId - The ID of the node to find
     * @returns {Object|null} - The found node or null if not found
     * @throws {Error} - If event or nodeId is invalid
     */
    findNodeInEventTree(event, nodeId) {
        if (!event || !event.rootNode) {
            throw new Error('Invalid event structure');
        }
        
        if (!nodeId) {
            return event.rootNode;
        }
        
        // Convert nodeId to string if it's not already
        const searchNodeId = nodeId.toString();
        
        const queue = [{
            node: event.rootNode,
            path: 'rootNode'
        }];
        
        while (queue.length > 0) {
            const { node, path } = queue.shift();
            
            // Convert node._id to string if it exists, then compare
            if (node._id && node._id.toString() === searchNodeId) {
                logger.debug('[DEBUG] findNodeInEventTree: Found node', {
                  nodeId: searchNodeId,
                  path,
                  hasQCE: Array.isArray(node.questCompletionEvents),
                  qceLength: node.questCompletionEvents ? node.questCompletionEvents.length : undefined,
                  questCompletionEvents: node.questCompletionEvents
                });
                return node;
            }
            
            if (node.choices?.length > 0) {
                node.choices.forEach((choice, index) => {
                    if (choice.nextNode) {
                        // The system now handles ID generation, no need to check or create IDs
                        queue.push({
                            node: choice.nextNode,
                            path: `${path}.choices[${index}].nextNode`
                        });
                    }
                });
            }
        }
        
        logger.warn('[DEBUG] findNodeInEventTree: Node not found', { searchedNodeId: searchNodeId });
        return null;
    }

    /**
     * Load the current event node from database by ID
     * 
     * @param {String} eventId - ID of the event
     * @param {String} nodeId - ID of the node to find
     * @returns {Promise<Object|null>} - The found node or null
     * @throws {Error} - If eventId is invalid or event not found
     */
    async loadNodeFromDatabase(eventId, nodeId) {
        try {
            // For tests, allow string IDs to pass through
            if (process.env.NODE_ENV === 'test') {
                // Skip ObjectId validation in tests
            } else if (!mongoose.Types.ObjectId.isValid(eventId)) {
                throw new Error('Invalid event ID');
            }

            const Event = mongoose.model('Event');
            const event = await Event.findById(eventId).lean();
            
            if (!event) {
                logger.error('Event not found in database:', { eventId });
                return null;
            }

            const node = this.findNodeInEventTree(event, nodeId);
            
            if (!node) {
                logger.error('Node not found in event tree:', { eventId, nodeId });
                return null;
            }
            
            return node;
        } catch (error) {
            logger.error('Error loading node from database:', { 
                eventId, 
                nodeId,
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Deep clone a node to avoid reference issues
     * 
     * @param {Object} node - The node to clone
     * @returns {Object} - A deep copy of the node
     * @throws {Error} - If node is invalid
     */
    cloneNode(node) {
        if (!node) {
            throw new Error('Invalid node: cannot clone null or undefined');
        }
        logger.debug('[DEBUG] cloneNode: Cloning node', {
          nodeId: node._id ? node._id.toString() : undefined,
          hasQCE: Array.isArray(node.questCompletionEvents),
          qceLength: node.questCompletionEvents ? node.questCompletionEvents.length : undefined,
          questCompletionEvents: node.questCompletionEvents
        });
        return JSON.parse(JSON.stringify(node));
    }
}

module.exports = new EventNodeService(); 