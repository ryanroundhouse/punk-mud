const logger = require('../config/logger');
const stateService = require('./stateService');

class MessageService {
    constructor(deps = {}) {
        // Dependency injection
        this.logger = deps.logger || logger;
        this.stateService = deps.stateService || stateService;
    }

    sendConsoleResponse(userId, message, type = 'default') {
        try {
            const socket = this.stateService.getClient(userId);
            if (!socket || !socket.connected) {
                this.logger.error('No valid socket found for message:', { userId, type, message });
                return false;
            }

            socket.emit('console response', {
                type,
                message
            });
            return true;
        } catch (error) {
            this.logger.error('Error sending console response:', error);
            return false;
        }
    }

    sendCombatMessage(userId, message, hint = null, image = null, moveImage = null) {
        // If hint, image, or moveImage is provided, we need to send a custom object
        if (hint || image || moveImage) {
            const socket = this.stateService.getClient(userId);
            if (!socket || !socket.connected) {
                this.logger.error('No valid socket found for message:', { userId, type: 'combat', message });
                return false;
            }
            
            const data = {
                type: 'combat',
                message,
                hint,
                image,
                moveImage
            };
            
            this.logger.debug("Emitting console response (combat) with data:", data);
            
            socket.emit('console response', data);
            return true;
        }
        // Otherwise, use the standard method
        return this.sendConsoleResponse(userId, message, 'combat');
    }

    sendErrorMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'error');
    }

    sendSuccessMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'success');
    }

    sendInfoMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'info');
    }

    sendMoveMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'move');
    }

    sendQuestsMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'quests');
    }

    sendListResponse(userId, data) {
        return this.sendConsoleResponse(userId, data, 'list');
    }

    sendChatMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'chat');
    }

    sendPlayerStatusMessage(userId, message) {
        return this.sendConsoleResponse(userId, message, 'playerStatus');
    }
}

// Create a singleton instance for backward compatibility
const messageService = new MessageService();

// Export the singleton instance as the main export (for backward compatibility)
module.exports = messageService;

// Add the class constructor as a property for testing
module.exports.MessageService = MessageService; 