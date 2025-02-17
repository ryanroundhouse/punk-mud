const mongoose = require('mongoose');
const logger = require('../config/logger');

const moveSuccessFailureSchema = new mongoose.Schema({
    message: String,
    target: {
        type: String,
        enum: ['self', 'opponent']
    },
    effect: {
        type: String,
        required: true,
        enum: ['stun', 'reduceStat', 'increaseStat']
    },
    stat: {
        type: String,
        enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck'],
        validate: {
            validator: function(v) {
                return !(['reduceStat', 'increaseStat'].includes(this.effect)) || v;
            },
            message: 'Stat is required when effect is reduceStat or increaseStat'
        }
    },
    amount: {
        type: Number,
        validate: {
            validator: function(v) {
                return !(['reduceStat', 'increaseStat'].includes(this.effect)) || v;
            },
            message: 'Amount is required when effect is reduceStat or increaseStat'
        }
    },
    rounds: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    }
}, { _id: false });

const moveSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    helpDescription: {
        type: String,
        default: ''
    },
    delay: {
        type: Number,
        required: true,
        min: 1,
        max: 8,
        default: 1
    },
    attackStat: {
        type: String,
        required: true,
        enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck']
    },
    defenceStat: {
        type: String,
        required: true,
        enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck']
    },
    success: {
        type: [moveSuccessFailureSchema],
        default: undefined
    },
    failure: {
        type: [moveSuccessFailureSchema],
        default: undefined
    }
}, {
    timestamps: true
});

// Add static method to calculate effective stat value
moveSchema.statics.calculateEffectiveStat = function(baseStatValue, activeEffects, statName) {
    let modifier = 0;
    
    // Debug log the incoming parameters
    logger.debug('Calculating effective stat:', {
        baseStatValue,
        statName,
        activeEffects: activeEffects.map(e => ({
            effect: e.effect,
            stat: e.stat,
            amount: e.amount,
            rounds: e.rounds
        }))
    });
    
    // Filter effects that modify the relevant stat
    const relevantEffects = activeEffects.filter(effect => 
        (effect.effect === 'increaseStat' || effect.effect === 'reduceStat') && 
        effect.stat === statName
    );

    // Debug log the relevant effects
    logger.debug('Relevant stat modifying effects:', {
        statName,
        effects: relevantEffects.map(e => ({
            effect: e.effect,
            amount: e.amount,
            rounds: e.rounds
        }))
    });

    // Calculate total modification
    relevantEffects.forEach(effect => {
        if (effect.effect === 'increaseStat') {
            modifier += effect.amount;
        } else if (effect.effect === 'reduceStat') {
            modifier -= effect.amount;
        }
    });

    logger.debug('Final stat calculation:', {
        baseStatValue,
        modifier,
        finalValue: baseStatValue + modifier
    });

    return baseStatValue + modifier;
};

module.exports = mongoose.model('Move', moveSchema); 