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
    timestamps: true,
    strict: true // This ensures only defined fields are saved
});

// Remove any existing indexes that might be causing issues
actorSchema.index({ name: 1 }); // Add useful index on name instead

module.exports = mongoose.model('Actor', actorSchema); 