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
        
        const queue = [{
            node: event.rootNode,
            path: 'rootNode'
        }];
        
        while (queue.length > 0) {
            const { node, path } = queue.shift();
            
            if (node._id?.toString() === nodeId) {
                return node;
            }
            
            if (node.choices?.length > 0) {
                node.choices.forEach((choice, index) => {
                    if (choice.nextNode) {
                        queue.push({
                            node: choice.nextNode,
                            path: `${path}.choices[${index}].nextNode`
                        });
                    }
                });
            }
        }
        
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
        if (!mongoose.Types.ObjectId.isValid(eventId)) {
            throw new Error('Invalid event ID');
        }

        const Event = mongoose.model('Event');
        const event = await Event.findById(eventId).lean();
        
        if (!event) {
            throw new Error(`Event not found: ${eventId}`);
        }

        const node = this.findNodeInEventTree(event, nodeId);
        
        if (!node) {
            throw new Error(`Node not found in event: ${nodeId}`);
        }
        
        return node;
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
        return JSON.parse(JSON.stringify(node));
    }

    /**
     * Ensure a node has a valid ID
     *
     * @param {Object} node - The node to check
     * @returns {Object} - The node with an ID
     */
    ensureNodeHasId(node) {
        if (!node) return node;

        if (!node._id) {
            // Generate a temporary ID if none exists
            node._id = `generated_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        }

        return node;
    }
    
    /**
     * Ensure consistent quest completion events across all choices in a node
     * 
     * @param {Object} node - The node to process
     * @returns {Object} - The processed node with consistent quest events
     */
    ensureConsistentQuestEvents(node) {
        if (!node || !node.choices || node.choices.length === 0) {
            return node;
        }
        
        // Find a reference questCompletionEvents array if any exist
        let referenceEvents = null;
        let found = false;
        
        for (const choice of node.choices) {
            if (choice.nextNode && choice.nextNode.questCompletionEvents && choice.nextNode.questCompletionEvents.length > 0) {
                referenceEvents = choice.nextNode.questCompletionEvents;
                found = true;
                break;
            }
        }
        
        // If we found a reference, apply it to all choices that don't have questCompletionEvents
        if (found && referenceEvents) {
            for (const choice of node.choices) {
                if (choice.nextNode && (!choice.nextNode.questCompletionEvents || choice.nextNode.questCompletionEvents.length === 0)) {
                    choice.nextNode.questCompletionEvents = JSON.parse(JSON.stringify(referenceEvents));
                }
            }
        }
        
        return node;
    }
}

module.exports = new EventNodeService(); 