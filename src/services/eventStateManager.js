/**
 * EventStateManager
 * 
 * Manages the state of active events for users.
 * Extracted from eventService.js to improve separation of concerns and testability.
 */

const logger = require('../config/logger');
const stateService = require('./stateService');

class EventStateManager {
    constructor() {
        // Map of userId to active event state
        this.activeEvents = new Map();
        
        // Map of userId to client socket
        this.clientSockets = new Map();
        
        // Map of roomId to array of users in that room
        this.roomUsers = new Map();
    }

    /**
     * Get the active event for a user
     * 
     * @param {string} userId - The ID of the user
     * @returns {Object|null} - The active event or null if none exists
     */
    getActiveEvent(userId) {
        logger.debug('Getting active event', { 
            userId,
            exists: this.activeEvents.has(userId) 
        });
        
        return this.activeEvents.get(userId) || null;
    }

    /**
     * Set an active event for a user
     * 
     * @param {string} userId - The ID of the user
     * @param {string} eventId - The ID of the event
     * @param {Object} node - The current node in the event tree
     * @param {string} actorId - The ID of the actor associated with the event
     * @param {boolean} isStoryEvent - Whether this is a story event
     * @returns {Object} - The active event state that was set
     */
    setActiveEvent(userId, eventId, node, actorId, isStoryEvent = false) {
        logger.debug('Setting active event', { 
            userId, 
            eventId,
            isStoryEvent
        });
        
        // Create a deep clone of the current node to avoid reference issues
        let clonedNode = JSON.parse(JSON.stringify(node));
        
        // Ensure the node has an ID
        if (!clonedNode._id) {
            clonedNode._id = `generated_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        }
        
        // Get the existing event state to track history
        const existingEvent = this.activeEvents.get(userId);
        let nodeHistory = [];
        
        // If we already have an event for this user, track the history
        if (existingEvent && existingEvent.eventId === eventId) {
            // Preserve existing history or initialize it
            nodeHistory = existingEvent.nodeHistory || [];
            
            // Add the current node to history if it's not already the last item
            const lastHistoryNode = nodeHistory.length > 0 ? nodeHistory[nodeHistory.length - 1] : null;
            if (!lastHistoryNode || lastHistoryNode.nodeId !== existingEvent.currentNode._id?.toString()) {
                nodeHistory.push({
                    nodeId: existingEvent.currentNode._id?.toString(),
                    prompt: existingEvent.currentNode.prompt?.substring(0, 50) + '...',
                    timestamp: Date.now()
                });
            }
        }
        
        const eventState = {
            userId,
            eventId,
            currentNode: clonedNode,
            actorId,
            isStoryEvent,
            nodeHistory
        };
        
        this.activeEvents.set(userId, eventState);
        return eventState;
    }

    /**
     * Clear the active event for a user
     * 
     * @param {string} userId - The ID of the user
     */
    clearActiveEvent(userId) {
        logger.debug('Clearing active event', { userId });
        this.activeEvents.delete(userId);
    }

    /**
     * Check if a user is currently in an event
     * 
     * @param {string} userId - The ID of the user
     * @returns {boolean} - Whether the user is in an event
     */
    isInEvent(userId) {
        const inEvent = this.activeEvents.has(userId);
        logger.debug('Checking if user is in event', { 
            userId, 
            inEvent 
        });
        return inEvent;
    }

    /**
     * Set the client socket for a user
     * 
     * @param {string} userId - The ID of the user
     * @param {Object} socket - The socket.io client socket
     */
    setClientSocket(userId, socket) {
        this.clientSockets.set(userId, socket);
    }

    /**
     * Get the client socket for a user
     * 
     * @param {string} userId - The ID of the user
     * @returns {Object|null} - The socket object or null if not found
     */
    getClientSocket(userId) {
        return this.clientSockets.get(userId) || null;
    }

    /**
     * Remove the client socket for a user
     * 
     * @param {string} userId - The ID of the user
     */
    removeClientSocket(userId) {
        this.clientSockets.delete(userId);
    }

    /**
     * Add a user to a room
     * 
     * @param {string} userId - The ID of the user
     * @param {string} roomId - The ID of the room
     * @param {string} socketId - The ID of the socket
     */
    addUserToRoom(userId, roomId, socketId) {
        if (!this.roomUsers.has(roomId)) {
            this.roomUsers.set(roomId, []);
        }
        
        const users = this.roomUsers.get(roomId);
        const userIndex = users.findIndex(u => u.userId === userId);
        
        if (userIndex === -1) {
            users.push({ userId, socketId });
        } else {
            users[userIndex].socketId = socketId;
        }
    }

    /**
     * Remove a user from a room
     * 
     * @param {string} userId - The ID of the user
     * @param {string} roomId - The ID of the room
     */
    removeUserFromRoom(userId, roomId) {
        if (!this.roomUsers.has(roomId)) {
            return;
        }
        
        const users = this.roomUsers.get(roomId);
        const userIndex = users.findIndex(u => u.userId === userId);
        
        if (userIndex !== -1) {
            users.splice(userIndex, 1);
        }
    }

    /**
     * Get all users in a specific room/node
     * 
     * @param {string} roomId - The ID of the room/node
     * @returns {Array} - Array of user objects with userId and socketId
     */
    getUsersInRoom(roomId) {
        return this.roomUsers.get(roomId) || [];
    }
}

// Create and export a singleton instance
const eventStateManager = new EventStateManager();
module.exports = eventStateManager;
module.exports.EventStateManager = EventStateManager; 