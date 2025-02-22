const mongoose = require('mongoose');

// Create a schema that can reference itself
const conversationNodeSchema = new mongoose.Schema({
    prompt: {
        type: String,
        required: true
    },
    // Optional quest that must be active to see this option
    requiredQuestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quest'
    },
    // Optional quest to activate when this option is chosen
    activateQuestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quest'
    },
    // Optional array of quest event IDs to complete when this option is chosen
    questCompletionEvents: [{
        type: String,
        trim: true
    }],
    choices: [{
        text: {
            type: String,
            required: true
        },
        nextNode: {
            type: mongoose.Schema.Types.Mixed  // This allows for recursive structure
        }
    }]
}, { _id: false });

const conversationSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Actor'
    },
    rootNode: {
        type: conversationNodeSchema,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

conversationSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Conversation', conversationSchema); 