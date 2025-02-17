const mongoose = require('mongoose');

const moveSuccessFailureSchema = new mongoose.Schema({
    message: String,
    target: {
        type: String,
        enum: ['self', 'opponent']
    },
    stat: {
        type: String,
        enum: ['hitpoints', 'armor', 'body', 'reflexes', 'agility', 'tech', 'luck']
    },
    amount: Number
}, { _id: false });

const moveSchema = new mongoose.Schema({
    name: String,
    type: {
        type: String,
        enum: ['none', 'attack']
    },
    usageChance: {
        type: Number,
        min: 0,
        max: 100
    },
    successChance: {
        type: Number,
        min: 0,
        max: 100
    },
    success: moveSuccessFailureSchema,
    failure: moveSuccessFailureSchema
}, { _id: false });

const activeEffectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        enum: ['bleed', 'stun', 'reduceStat', 'increaseStat']
    },
    remainingRounds: {
        type: Number,
        required: true,
        min: 0
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    avatarName: {
        type: String,
        unique: true,
        sparse: true
    },
    description: String,
    image: String,
    authCode: {
        code: String,
        expiresAt: Date
    },
    currentNode: {
        type: String,
        default: '122.124.10.10'
    },
    isBuilder: {
        type: Boolean,
        default: false
    },
    quests: [{
        questId: String,
        currentEventId: String,
        completedEventIds: [String],
        completed: Boolean,
        startedAt: Date,
        completedAt: Date,
        killProgress: [{
            eventId: String,
            remaining: Number
        }]
    }],
    stats: {
        hitpoints: { type: Number, default: 100 },
        currentHitpoints: { type: Number, default: 100 },
        armor: { type: Number, default: 0 },
        body: { type: Number, default: 10 },
        reflexes: { type: Number, default: 10 },
        agility: { type: Number, default: 10 },
        tech: { type: Number, default: 10 },
        luck: { type: Number, default: 10 }
    },
    activeEffects: {
        type: [activeEffectSchema],
        default: []
    },
    moves: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Move',
        default: ['67a80524ad10e0715a1bf5f4']
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema); 