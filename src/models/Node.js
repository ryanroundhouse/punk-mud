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
        mobId: String,
        chance: Number
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Node', nodeSchema); 