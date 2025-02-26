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

const mobSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true
    },
    image: String,
    experiencePoints: {
        type: Number,
        default: 10
    },
    intent: {
        type: String,
        enum: ['hostile', 'neutral', 'friendly'],
        default: 'neutral'
    },
    stats: {
        hitpoints: { type: Number, default: 10 },
        currentHitpoints: { type: Number, default: 10 },
        armor: { type: Number, default: 0 },
        body: { type: Number, default: 10 },
        reflexes: { type: Number, default: 10 },
        agility: { type: Number, default: 10 },
        tech: { type: Number, default: 10 },
        luck: { type: Number, default: 10 },
        charisma: { type: Number, default: 10 },
        level: { type: Number, default: 1, min: 1 }
    },
    activeEffects: {
        type: [activeEffectSchema],
        default: []
    },
    chatMessages: [{
        message: String,
        order: Number
    }],
    moves: [{
        move: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Move',
            required: true
        },
        usageChance: {
            type: Number,
            min: 0,
            max: 100,
            required: true
        }
    }]
}, {
    timestamps: true,
    _id: true,
    id: false
});

mobSchema.index({ name: 1 });
mobSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        delete ret.id;
        return ret;
    }
});

module.exports = mongoose.model('Mob', mobSchema); 