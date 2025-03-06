const logger = require('../config/logger');
const stateService = require('./stateService');

class MessageService {
    sendConsoleResponse(userId, message, type = 'default') {
        try {
            const socket = stateService.getClient(userId);
            if (!socket || !socket.connected) {
                logger.error('No valid socket found for message:', { userId, type, message });
                return false;
            }

            socket.emit('console response', {
                type,
                message
            });
            return true;
        } catch (error) {
            logger.error('Error sending console response:', error);
            return false;
        }
    }

    sendCombatMessage(userId, message, hint = null) {
        const response = {
            type: 'combat',
            message
        };
        if (hint) {
            response.hint = hint;
        }
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

const messageService = new MessageService();
module.exports = messageService; 