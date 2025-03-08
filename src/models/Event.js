const mongoose = require('mongoose');

// Create a schema that can reference itself
const eventNodeSchema = new mongoose.Schema({
    prompt: {
        type: String,
        required: true
    },
    // Replace the restrictedToNoClass with an array of restrictions
    restrictions: [{
        type: String,
        enum: ['noClass', 'enforcerOnly'],
        trim: true
    }],
    // Optional quest that must be active to see this option
    requiredQuestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quest'
    },
    // Optional quest event ID that must be active to see this option
    requiredQuestEventId: {
        type: String,
        trim: true
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
        },
        // Optional mob to spawn and initiate combat with when this choice is selected
        mobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Mob'
        }
    }]
}, { _id: false });

const eventSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    // Whether this event requires energy to activate
    requiresEnergy: {
        type: Boolean,
        default: true  // By default, events require energy
    },
    // Optional actor reference
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Actor'
    },
    rootNode: {
        type: eventNodeSchema,
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

eventSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Event', eventSchema); 