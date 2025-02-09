const Node = require('../models/Node');
const User = require('../models/User');
const logger = require('../config/logger');
const stateService = require('./stateService');
const mobService = require('./mobService');
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

    // Clear any existing mob and check for new spawn
    mobService.clearUserMob(userId);
    const mobSpawn = await mobService.spawnMobForUser(userId, node);
    
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

async function getNode(address) {
    const node = await Node.findOne({ address });
    if (!node) {
        throw new Error('Node not found');
    }
    return node;
}

module.exports = {
    moveUser,
    handlePlayerNodeConnection,
    getNode
}; 