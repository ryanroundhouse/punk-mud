const mongoose = require('mongoose');

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
        completedAt: Date
    }],
    stats: {
        hitpoints: { type: Number, default: 100 },
        armor: { type: Number, default: 0 },
        body: { type: Number, default: 10 },
        reflexes: { type: Number, default: 10 },
        agility: { type: Number, default: 10 },
        tech: { type: Number, default: 10 },
        luck: { type: Number, default: 10 }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema); 