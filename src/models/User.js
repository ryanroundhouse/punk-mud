const mongoose = require('mongoose');

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
    class: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class'
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
        hitpoints: { type: Number, default: 20 },
        currentHitpoints: { type: Number, default: 20 },
        armor: { type: Number, default: 0 },
        body: { type: Number, default: 1 },
        reflexes: { type: Number, default: 1 },
        agility: { type: Number, default: 1 },
        charisma: { type: Number, default: 1 },
        tech: { type: Number, default: 1 },
        luck: { type: Number, default: 1 },
        experience: { type: Number, default: 0 },
        level: { type: Number, default: 1 },
        energy: { type: Number, default: 20 },
        currentEnergy: { type: Number, default: 20 }
    },
    activeEffects: {
        type: [activeEffectSchema],
        default: []
    },
    moves: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Move'
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema); 