const mongoose = require('mongoose');

const questSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
        default: () => Math.random().toString(36).substr(2, 9),
        immutable: true
    },
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
        id: {
            type: String,
            required: true,
            default: () => Math.random().toString(36).substr(2, 9)
        },
        eventType: {
            type: String,
            required: true,
            enum: ['chat'],  // Can be expanded later
            default: 'chat'
        },
        actorId: {
            type: String,
            required: true,
            ref: 'Actor'
        },
        message: {
            type: String,
            required: true
        },
        hint: {
            type: String,
            default: ''
        },
        choices: [{
            nextEventId: {
                type: String,
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

questSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Quest', questSchema); 