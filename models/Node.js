const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function(v) {
                return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(v);
            },
            message: props => `${props.value} is not a valid IP address!`
        }
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: ''
    },
    exits: [{
        direction: {
            type: String,
            required: true
        },
        target: {
            type: String,
            required: true,
            validate: {
                validator: function(v) {
                    return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(v);
                },
                message: props => `${props.value} is not a valid IP address!`
            }
        }
    }],
    events: [{
        name: {
            type: String,
            required: true
        },
        mobId: {
            type: String,
            required: true
        },
        chance: {
            type: Number,
            required: true,
            min: 0,
            max: 100
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

// Add pre-save middleware to update the updatedAt timestamp
nodeSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Node', nodeSchema); 