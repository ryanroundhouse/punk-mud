const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const stateService = require('./stateService');
const mobService = require('./mobService');
const questService = require('./questService');
const { publishSystemMessage } = require('./chatService');

async function moveUser(userId, direction) {
    const user = await User.findById(userId);
    if (!user || !user.currentNode) {
        throw new Error('User not found or missing location');
    }

    const currentNode = await Node.findOne({ address: user.currentNode });
    if (!currentNode) {
        throw new Error('Current location not found');
    }

    const exit = currentNode.exits.find(e => e.direction.toLowerCase() === direction.toLowerCase());
    if (!exit) {
        throw new Error(`No exit to the ${direction}`);
    }

    const targetNode = await Node.findOne({ address: exit.target });
    if (!targetNode) {
        throw new Error('Target location not found');
    }

    const oldNode = user.currentNode;
    user.currentNode = targetNode.address;
    await user.save();

    // Handle node client management
    stateService.removeUserFromNode(userId, oldNode);
    stateService.addUserToNode(userId, targetNode.address);

    // Send movement messages
    await publishSystemMessage(oldNode, `${user.avatarName} has left.`);
    await publishSystemMessage(
        targetNode.address,
        `${user.avatarName} has arrived.`,
        `You have entered ${targetNode.name}.`,
        userId
    );

    // Clear any existing mob and check for new spawn
    mobService.clearUserMob(userId);
    const mobSpawn = await mobService.spawnMobForUser(userId, targetNode);
    
    return {
        success: true,
        message: `You move ${direction} to ${targetNode.name}`,
        node: targetNode,
        mobSpawn
    };
}

async function handlePlayerNodeConnection(userId, nodeAddress) {
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const node = await Node.findOne({ address: nodeAddress });
    if (!node) {
        throw new Error('Node not found');
    }

    logger.debug('handlePlayerNodeConnection called', {
        userId,
        nodeAddress,
        inCombat: stateService.isUserInCombat(userId),
        nodeEvents: node.events?.length || 0
    });

    // Only clear and spawn new mobs if not in combat
    if (!stateService.isUserInCombat(userId)) {
        mobService.clearUserMob(userId);
        
        // Check for quest-specific node event overrides
        const questNodeEvents = await questService.getQuestNodeEventOverrides(userId, nodeAddress);
        
        logger.debug('Quest node event override check result', {
            userId,
            nodeAddress,
            hasQuestOverrides: !!questNodeEvents,
            questEventCount: questNodeEvents?.length || 0,
            originalNodeEventCount: node.events?.length || 0
        });
        
        let mobSpawn;
        if (questNodeEvents && questNodeEvents.length > 0) {
            // Use quest-specific node events instead of the default ones
            logger.debug('Using quest-specific node events for spawn', {
                userId,
                nodeAddress,
                questNodeEvents: JSON.stringify(questNodeEvents)
            });
            
            // Create a temporary node object with the quest-specific events
            const questNode = {
                ...node.toObject(),
                events: questNodeEvents
            };
            
            logger.debug('Created temporary quest node for spawn', {
                userId,
                nodeAddress,
                originalEvents: node.events?.length || 0,
                questNodeEvents: questNode.events?.length || 0
            });
            
            mobSpawn = await mobService.spawnMobForUser(userId, questNode);
            
            logger.debug('Mob spawn result from quest events', {
                userId,
                nodeAddress,
                mobSpawned: !!mobSpawn,
                mobDetails: mobSpawn ? {
                    id: mobSpawn._id,
                    name: mobSpawn.name
                } : null
            });
            
            if (mobSpawn) {
                await publishSystemMessage(
                    nodeAddress,
                    `A ${mobSpawn.name} appears!`,
                    `A ${mobSpawn.name} appears!`,
                    userId
                );
            }
        } else {
            // Use default node events
            logger.debug('Using default node events for spawn', {
                userId,
                nodeAddress,
                nodeEvents: node.events?.length || 0,
                nodeEventsDetails: node.events?.map(e => ({
                    mobId: e.mobId,
                    chance: e.chance
                })) || []
            });
            
            mobSpawn = await mobService.spawnMobForUser(userId, node);
            
            logger.debug('Mob spawn result from default events', {
                userId,
                nodeAddress,
                mobSpawned: !!mobSpawn,
                mobDetails: mobSpawn ? {
                    id: mobSpawn._id,
                    name: mobSpawn.name
                } : null
            });
            
            if (mobSpawn) {
                await publishSystemMessage(
                    nodeAddress,
                    `A ${mobSpawn.name} appears!`,
                    `A ${mobSpawn.name} appears!`,
                    userId
                );
            }
        }
        
        return mobSpawn;
    } else {
        logger.debug('Skipping mob spawn because user is in combat', {
            userId,
            nodeAddress
        });
    }
    
    return null;
}

async function getNode(address) {
    const node = await Node.findOne({ address });
    if (!node) {
        throw new Error('Node not found');
    }
    
    // Add debug logging to see what's being returned
    logger.debug('getNode returning node data:', {
        address,
        hasEvents: !!node.events,
        eventCount: node.events?.length || 0
    });
    
    return node;
}

// Add a new method to get node with quest overrides if applicable
async function getNodeWithOverrides(address, userId) {
    const node = await Node.findOne({ address });
    if (!node) {
        throw new Error('Node not found');
    }
    
    // Check for quest-specific node event overrides
    const questNodeEvents = await questService.getQuestNodeEventOverrides(userId, address);
    
    // Create a copy of the node to avoid modifying the database object
    const nodeData = node.toObject();
    
    // If there are quest overrides, include them in the node data
    if (questNodeEvents && questNodeEvents.length > 0) {
        logger.debug('Including quest event overrides in node data:', {
            address,
            userId,
            originalEvents: nodeData.events?.length || 0,
            questEventCount: questNodeEvents.length
        });
        
        // Add the quest events to the node data
        nodeData.events = questNodeEvents;
    }
    
    return nodeData;
}

async function isRestPoint(nodeAddress) {
    const node = await Node.findOne({ address: nodeAddress });
    if (!node) {
        throw new Error('Node not found');
    }
    return node.isRestPoint;
}

module.exports = {
    moveUser,
    handlePlayerNodeConnection,
    getNode,
    getNodeWithOverrides,
    isRestPoint
}; 