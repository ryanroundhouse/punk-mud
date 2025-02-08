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

    // Clear any existing enemy
    stateService.playerEnemies.delete(userId);

    return {
        success: true,
        message: `You move ${direction} to ${targetNode.name}`,
        node: targetNode
    };
}

async function checkForEnemySpawn(userId, node) {
    if (!node.events || node.events.length === 0) {
        return null;
    }

    // Don't spawn if user already has an enemy
    if (stateService.playerEnemies.has(userId)) {
        return null;
    }

    // Roll for eligible events based on chance
    const eligibleEvents = node.events.filter(event => (Math.random() * 100) < event.chance);
    if (eligibleEvents.length === 0) {
        return null;
    }

    const selectedEvent = eligibleEvents[Math.floor(Math.random() * eligibleEvents.length)];
    const enemy = await Mob.findById(selectedEvent.mobId);
    
    if (!enemy) {
        return null;
    }

    const enemyInstance = {
        name: enemy.name,
        description: enemy.description,
        image: enemy.image,
        hitpoints: enemy.hitpoints,
        armor: enemy.armor,
        body: enemy.body,
        reflexes: enemy.reflexes,
        agility: enemy.agility,
        tech: enemy.tech,
        luck: enemy.luck,
        instanceId: `${enemy._id}-${Date.now()}`,
        chatMessages: enemy.chatMessages
    };

    stateService.playerEnemies.set(userId, enemyInstance);
    return enemyInstance;
}

module.exports = {
    moveUser,
    checkForEnemySpawn
}; 