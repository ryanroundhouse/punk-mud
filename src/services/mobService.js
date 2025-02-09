const logger = require('../config/logger');
const Mob = require('../models/Mob');
const stateService = require('./stateService');

async function loadMobFromEvent(event) {
    logger.debug(`Loading mob from event with mobId: ${event.mobId}`);
    
    const mob = await Mob.findById(event.mobId)
        .populate({
            path: 'moves.move',
            model: 'Move'
        });
    
    if (!mob) {
        logger.debug(`Could not find mob with id ${event.mobId}`);
        return null;
    }

    // Transform the populated moves into the correct format
    const moves = mob.moves.map(moveData => ({
        ...moveData.move.toObject(),  // Spread the move's properties
        usageChance: moveData.usageChance  // Add the usage chance from the mob's move configuration
    }));

    logger.debug('Processed mob moves:', moves);

    const mobInstance = {
        name: mob.name,
        description: mob.description,
        image: mob.image,
        stats: {
            hitpoints: mob.stats.hitpoints,
            currentHitpoints: mob.stats.hitpoints, // Default to hitpoints if not set
            armor: mob.stats.armor,
            body: mob.stats.body,
            reflexes: mob.stats.reflexes,
            agility: mob.stats.agility,
            tech: mob.stats.tech,
            luck: mob.stats.luck
        },
        instanceId: `${mob._id}-${Date.now()}`,
        chatMessages: mob.chatMessages,
        moves: moves
    };

    logger.debug('Created mob instance:', {
        name: mobInstance.name,
        moves: mobInstance.moves,
        stats: mobInstance.stats
    });

    return mobInstance;
}

async function spawnMobForUser(userId, node) {
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
    const mobInstance = await loadMobFromEvent(selectedEvent);
    
    if (mobInstance) {
        logger.debug(`Spawning mob instance ${mobInstance.instanceId} (${mobInstance.name}) for user ${userId}`);
        stateService.playerMobs.set(userId, mobInstance);
    }

    return mobInstance;
}

function clearUserMob(userId) {
    stateService.playerMobs.delete(userId);
}

module.exports = {
    spawnMobForUser,
    clearUserMob,
    loadMobFromEvent
}; 