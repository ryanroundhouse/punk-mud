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