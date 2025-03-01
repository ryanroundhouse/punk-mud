const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true
    },
    image: String,
    isRestPoint: {
        type: Boolean,
        default: false
    },
    exits: [{
        direction: String,
        target: String
    }],
    events: [{
        // Either mobId or eventId must be present, but not both
        mobId: {
            type: String,
            required: function() { return !this.eventId; }
        },
        eventId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Event',
            required: function() { return !this.mobId; }
        },
        chance: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: 100
        }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Node', nodeSchema); 