const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    image: String,
    location: String,
    chatMessages: [{
        message: String,
        order: Number
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Actor', actorSchema); 