const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    id: {
        type: String,
        required: true,
        unique: true,
        default: () => Math.random().toString(36).substr(2, 9),
        immutable: true
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: ''
    },
    location: {
        type: String,
        validate: {
            validator: function(v) {
                return !v || /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(v);
            },
            message: props => `${props.value} is not a valid IP address!`
        }
    },
    chatMessages: [{
        message: {
            type: String,
            required: true
        },
        order: {
            type: Number,
            required: true
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

// Update timestamp on save
actorSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Actor', actorSchema); 