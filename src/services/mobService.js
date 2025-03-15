const logger = require('../config/logger');
const stateService = require('./stateService');

class MobService {
    constructor(deps = {}) {
        this.Mob = deps.Mob || require('../models/Mob');
        this.stateService = deps.stateService || stateService;
        this.random = deps.random || Math.random;
        this.logger = deps.logger || logger;
    }

    async loadMobFromEvent(event) {
        this.logger.debug(`Loading mob from event with mobId: ${event.mobId}`);
        
        const mob = await this.Mob.findById(event.mobId)
            .populate({
                path: 'moves.move',
                model: 'Move'
            });
        
        if (!mob) {
            this.logger.debug(`Could not find mob with id ${event.mobId}`);
            return null;
        }

        // Transform the populated moves into the correct format
        const moves = mob.moves.map(moveData => ({
            ...moveData.move.toObject(),  // Spread the move's properties
            usageChance: moveData.usageChance  // Add the usage chance from the mob's move configuration
        }));

        this.logger.debug('Processed mob moves:', moves);

        const mobInstance = {
            mobId: mob._id,
            name: mob.name,
            description: mob.description,
            image: mob.image,
            level: mob.stats.level,
            stats: {
                hitpoints: mob.stats.hitpoints,
                currentHitpoints: mob.stats.hitpoints,
                armor: mob.stats.armor,
                body: mob.stats.body,
                reflexes: mob.stats.reflexes,
                agility: mob.stats.agility,
                tech: mob.stats.tech,
                luck: mob.stats.luck,
                charisma: mob.stats.charisma
            },
            instanceId: `${mob._id}-${Date.now()}`,
            chatMessages: mob.chatMessages,
            moves: moves
        };

        this.logger.debug('Created mob instance:', {
            mobId: mobInstance.mobId,
            name: mobInstance.name,
            instanceId: mobInstance.instanceId,
            moves: mobInstance.moves.length,
            stats: mobInstance.stats
        });

        return mobInstance;
    }

    async spawnMobForUser(userId, node) {
        this.logger.debug(`Checking for mob spawn for user ${userId} in node ${node.address}`);
        
        if (!node.events || node.events.length === 0) {
            this.logger.debug('No events found in node, skipping spawn check');
            return null;
        }

        // Don't spawn if user already has a mob
        if (this.stateService.playerMobs.has(userId)) {
            this.logger.debug(`User ${userId} already has an active mob, skipping spawn check`);
            return null;
        }

        // Calculate total spawn chance
        const totalChance = node.events.reduce((sum, event) => sum + event.chance, 0);
        
        if (totalChance === 100) {
            return this._handleFullProbabilitySpawn(userId, node.events);
        } else {
            return this._handlePartialProbabilitySpawn(userId, node.events);
        }
    }

    async _handleFullProbabilitySpawn(userId, events) {
        const roll = this.random() * 100;
        let chanceSum = 0;
        
        for (const event of events) {
            chanceSum += event.chance;
            if (roll < chanceSum) {
                this.logger.debug(`Event ${event.mobId} selected with roll ${roll} in cumulative range ${chanceSum}`);
                const mobInstance = await this.loadMobFromEvent(event);
                
                if (mobInstance) {
                    this.logger.debug(`Spawning mob instance ${mobInstance.instanceId} (${mobInstance.name}) for user ${userId}`);
                    this.stateService.playerMobs.set(userId, mobInstance);
                }
                
                return mobInstance;
            }
        }
        return null;
    }

    async _handlePartialProbabilitySpawn(userId, events) {
        const eligibleEvents = events.filter(event => {
            const roll = this.random() * 100;
            this.logger.debug(`Event ${event.mobId} - Rolled ${roll} against chance ${event.chance}`);
            return roll < event.chance;
        });
        
        if (eligibleEvents.length === 0) {
            this.logger.debug('No eligible events passed chance check');
            return null;
        }

        const selectedEvent = eligibleEvents[Math.floor(this.random() * eligibleEvents.length)];
        const mobInstance = await this.loadMobFromEvent(selectedEvent);
        
        if (mobInstance) {
            this.logger.debug(`Spawning mob instance ${mobInstance.instanceId} (${mobInstance.name}) for user ${userId}`);
            this.stateService.playerMobs.set(userId, mobInstance);
        }

        return mobInstance;
    }

    clearUserMob(userId) {
        this.stateService.playerMobs.delete(userId);
    }
}

// Create and export a singleton instance with default dependencies
const mobService = new MobService();

// Export both the class and the singleton instance
module.exports = {
    MobService,
    mobService,
    // Export individual methods for backward compatibility
    spawnMobForUser: (...args) => mobService.spawnMobForUser(...args),
    clearUserMob: (...args) => mobService.clearUserMob(...args),
    loadMobFromEvent: (...args) => mobService.loadMobFromEvent(...args)
}; 