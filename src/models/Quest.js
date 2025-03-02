const mongoose = require('mongoose');

const questSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    journalDescription: {
        type: String,
        required: true
    },
    events: [{
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            auto: true
        },
        eventType: {
            type: String,
            required: true,
            enum: ['chat', 'kill', 'stage'],
            default: 'chat'
        },
        // Common fields for all event types
        hint: {
            type: String,
            default: ''
        },
        requiredQuestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Quest'
        },
        activateQuestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Quest'
        },
        choices: [{
            nextEventId: {
                type: mongoose.Schema.Types.ObjectId,
                required: true
            }
        }],
        isStart: {
            type: Boolean,
            default: false
        },
        isEnd: {
            type: Boolean,
            default: false
        },
        // Event rewards
        rewards: [{
            type: {
                type: String,
                required: true,
                enum: ['gainClass', 'experiencePoints'],
                default: 'gainClass'
            },
            value: {
                type: mongoose.Schema.Types.Mixed,
                required: true
            },
            valueRef: {
                type: String,
                required: function() { return this.type === 'gainClass'; },
                enum: ['Class'],
                default: 'Class'
            }
        }],
        // Node event overrides - new field
        nodeEventOverrides: [{
            nodeAddress: {
                type: String,
                required: true,
                ref: 'Node'
            },
            events: [{
                mobId: {
                    type: mongoose.Schema.Types.ObjectId,
                    required: true,
                    ref: 'Mob'
                },
                chance: {
                    type: Number,
                    required: true,
                    min: 0,
                    max: 100,
                    default: 100
                }
            }]
        }],
        // Chat event specific fields
        actorId: {
            type: String,
            required: function() { return this.eventType === 'chat'; },
            ref: 'Actor'
        },
        message: {
            type: String,
            required: function() { return this.eventType === 'chat'; }
        },
        // Kill event specific fields
        mobId: {
            type: mongoose.Schema.Types.ObjectId,
            required: function() { return this.eventType === 'kill'; },
            ref: 'Mob'
        },
        quantity: {
            type: Number,
            required: function() { return this.eventType === 'kill'; },
            min: 1,
            default: 1
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

questSchema.set('id', false);
questSchema.set('toJSON', {
    virtuals: false,
    versionKey: false,
    transform: function (doc, ret) {
        delete ret.id;
        return ret;
    }
});

questSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Quest', questSchema); 