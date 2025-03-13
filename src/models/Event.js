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
        // Optional teleport node ID to jump to when this choice is selected
        teleportToNode: {
            type: String,  // Node address
            trim: true
        },
        // Optional mob to spawn and initiate combat with when this choice is selected
        mobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Mob'
        },
        // Optional skill check stat (if this choice requires a skill check)
        skillCheckStat: {
            type: String,
            enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck']
        },
        // Optional skill check target number (required if skillCheckStat is present)
        skillCheckTargetNumber: {
            type: Number,
            min: 1,
            required: function() {
                return !!this.skillCheckStat;
            }
        },
        // Optional failure node (required if skillCheckStat is present)
        // This is the node to navigate to if the skill check fails
        // If the skill check succeeds, nextNode is used
        failureNode: {
            type: mongoose.Schema.Types.Mixed,
            required: function() {
                return !!this.skillCheckStat;
            }
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