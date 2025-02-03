const mongoose = require('mongoose');

const mobSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    intent: {
        type: String,
        enum: ['hostile', 'neutral', 'friendly'],
        default: 'neutral',
        required: true
    },
    id: {
        type: String,
        required: true,
        unique: true,
        default: () => Math.random().toString(36).substr(2, 9),
        immutable: true
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: ''
    },
    hitpoints: {
        type: Number,
        required: true,
        min: 1,
        default: 100
    },
    armor: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    body: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    reflexes: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    agility: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    tech: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    luck: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    chatMessages: [{
        message: {
            type: String,
            required: true
        },
        order: {
            type: Number,
            required: true
        }
    }],
    moves: [{
        name: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ['none', 'attack'],
            default: 'none'
        },
        usageChance: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: 100
        },
        successChance: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: 50
        },
        success: {
            message: {
                type: String,
                required: true
            },
            target: {
                type: String,
                enum: ['self', 'opponent'],
                default: 'opponent'
            },
            stat: {
                type: String,
                enum: ['hitpoints', 'armor', 'body', 'reflexes', 'agility', 'tech', 'luck'],
                default: 'hitpoints'
            },
            amount: {
                type: Number,
                required: true,
                default: 0
            }
        },
        failure: {
            message: {
                type: String,
                required: true
            },
            target: {
                type: String,
                enum: ['self', 'opponent'],
                default: 'self'
            },
            stat: {
                type: String,
                enum: ['hitpoints', 'armor', 'body', 'reflexes', 'agility', 'tech', 'luck'],
                default: 'hitpoints'
            },
            amount: {
                type: Number,
                required: true,
                default: 0
            }
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp on save
mobSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Mob', mobSchema); 