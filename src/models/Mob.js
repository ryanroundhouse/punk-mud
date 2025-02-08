const mongoose = require('mongoose');

const mobSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    image: String,
    hitpoints: Number,
    armor: Number,
    body: Number,
    reflexes: Number,
    agility: Number,
    tech: Number,
    luck: Number,
    chatMessages: [{
        message: String,
        order: Number
    }],
    moves: [{
        name: String,
        damage: Number,
        type: String
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Mob', mobSchema); 