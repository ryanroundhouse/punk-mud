const Node = require('../models/Node');
const User = require('../models/User');
const Mob = require('../models/Mob');
const logger = require('../config/logger');
const stateService = require('./stateService');
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

    // Clear any existing mob
    stateService.playerMobs.delete(userId);

    // Check for mob spawn in new location
    const mobSpawn = await checkForMobSpawn(userId, targetNode);
    
    return {
        success: true,
        message: `You move ${direction} to ${targetNode.name}`,
        node: targetNode,
        mobSpawn  // Include the mob spawn result in the response
    };
}

async function checkForMobSpawn(userId, node) {
    logger.debug(`Checking for mob spawn for user ${userId} in node ${node.address}`);
    
    if (!node.events || node.events.length === 0) {
        logger.debug('No events found in node, skipping spawn check');
        return null;
    }

    // Don't spawn if user already has a mob
    if (stateService.playerMobs.has(userId)) {
        logger.debug(`User ${userId} already has an active mob, skipping spawn check`);
        return null;
    }

    // Roll for eligible events based on chance
    const eligibleEvents = node.events.filter(event => {
        const roll = Math.random() * 100;
        logger.debug(`Event ${event.mobId} - Rolled ${roll} against chance ${event.chance}`);
        return roll < event.chance;
    });
    
    if (eligibleEvents.length === 0) {
        logger.debug('No eligible events passed chance check');
        return null;
    }

    const selectedEvent = eligibleEvents[Math.floor(Math.random() * eligibleEvents.length)];
    logger.debug(`Selected event with mobId: ${selectedEvent.mobId}`);
    
    const mob = await Mob.findById(selectedEvent.mobId);
    
    if (!mob) {
        logger.debug(`Could not find mob with id ${selectedEvent.mobId}`);
        return null;
    }

    const mobInstance = {
        name: mob.name,
        description: mob.description,
        image: mob.image,
        hitpoints: mob.hitpoints,
        armor: mob.armor,
        body: mob.body,
        reflexes: mob.reflexes,
        agility: mob.agility,
        tech: mob.tech,
        luck: mob.luck,
        instanceId: `${mob._id}-${Date.now()}`,
        chatMessages: mob.chatMessages
    };

    logger.debug(`Spawning mob instance ${mobInstance.instanceId} (${mob.name}) for user ${userId}`);
    stateService.playerMobs.set(userId, mobInstance);
    return mobInstance;
}

// Add new function to handle player connection to node
async function handlePlayerNodeConnection(userId, nodeAddress) {
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const node = await Node.findOne({ address: nodeAddress });
    if (!node) {
        throw new Error('Node not found');
    }

    // Clear any existing mob
    stateService.playerMobs.delete(userId);

    // Check for mob spawn
    const mobSpawn = await checkForMobSpawn(userId, node);
    
    if (mobSpawn) {
        await publishSystemMessage(
            nodeAddress,
            `A ${mobSpawn.name} appears!`,
            `A ${mobSpawn.name} appears!`,
            userId
        );
    }

    return mobSpawn;
}

module.exports = {
    moveUser,
    checkForMobSpawn,
    handlePlayerNodeConnection  // Export the new function
}; 