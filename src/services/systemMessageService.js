const logger = require('../config/logger');
const stateService = require('./stateService');
const messageService = require('./messageService');

/**
 * Publishes a system message to all users in a node
 * @param {string} nodeAddress - The address of the node where message will be published
 * @param {Object} messageData - The message data object to send
 * @returns {Promise<void>}
 */
async function publishSystemMessage(nodeAddress, messageData) {
    logger.debug('publishSystemMessage called with:', {
        nodeAddress,
        messageType: messageData.type,
        message: messageData.message
    });

    const nodeUsers = stateService.nodeClients.get(nodeAddress);
    
    if (!nodeUsers || nodeUsers.length === 0) {
        logger.debug('No users found in node:', nodeAddress);
        return;
    }
    
    logger.debug(`Found ${nodeUsers.length} users in node ${nodeAddress}`);
    
    let messagesSent = 0;
    nodeUsers.forEach(userId => {
        const userSocket = stateService.getClient(userId);
        if (userSocket) {
            logger.debug(`Sending system message to user ${userId}`, {
                type: messageData.type
            });
            
            // Emit 'system message' event directly instead of using messageService
            userSocket.emit('system message', messageData);
            messagesSent++;
        } else {
            logger.debug(`No socket found for user ${userId}`);
        }
    });
    
    logger.debug(`System messages sent to ${messagesSent} of ${nodeUsers.length} users in node ${nodeAddress}`);
}

/**
 * Publishes user movement system messages to nodes
 * @param {string} fromNodeAddress - The address of the node the user is departing from
 * @param {string} toNodeAddress - The address of the node the user is arriving at
 * @param {Object} userData - User data object with details for the message
 * @returns {Promise<void>}
 */
async function publishUserMoveSystemMessage(fromNodeAddress, toNodeAddress, userData) {
    // Debug the parameters
    logger.debug('publishUserMoveSystemMessage called with:', {
        fromNodeAddress: fromNodeAddress,
        toNodeAddress: toNodeAddress,
        userData: {
            id: userData._id,
            avatarName: userData.avatarName
        }
    });

    // Send departure message to origin node
    if (fromNodeAddress) {
        const departureMessage = {
            message: `${userData.avatarName} has left.`,
            type: 'system user depart',
            user: {
                id: userData._id,
                name: userData.avatarName
            }
        };
        
        logger.debug('Sending departure message:', {
            nodeAddress: fromNodeAddress,
            message: departureMessage
        });
        
        await publishSystemMessage(fromNodeAddress, departureMessage);
    }

    // Send arrival message to destination node
    if (toNodeAddress) {
        const arrivalMessage = {
            message: `${userData.avatarName} has arrived.`,
            type: 'system user arrive',
            user: {
                id: userData._id,
                name: userData.avatarName
            }
        };
        
        logger.debug('Sending arrival message:', {
            nodeAddress: toNodeAddress,
            message: arrivalMessage
        });
        
        await publishSystemMessage(toNodeAddress, arrivalMessage);
    }
}

module.exports = {
    publishSystemMessage,
    publishUserMoveSystemMessage
}; 