const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    avatarName: {
        type: String,
        unique: true,
        sparse: true,  // Allows null values to not count for uniqueness
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    image: {
        type: String
    },
    authCode: {
        code: String,
        expiresAt: Date
    },
    isBuilder: {
        type: Boolean,
        default: false
    },
    currentNode: {
        type: String,
        default: '122.124.10.10' // Default starting node
    },
    quests: [{
        questId: {
            type: String,
            required: true
        },
        currentEventId: {
            type: String,
            required: true
        },
        completedEventIds: [{
            type: String
        }],
        startedAt: {
            type: Date,
            default: Date.now
        },
        completed: {
            type: Boolean,
            default: false
        },
        completedAt: Date
    }]
});

module.exports = mongoose.model('User', userSchema); 