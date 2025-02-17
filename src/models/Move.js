const mongoose = require('mongoose');

const moveSuccessFailureSchema = new mongoose.Schema({
    message: String,
    target: {
        type: String,
        enum: ['self', 'opponent']
    },
    effect: {
        type: String,
        required: true,
        enum: ['bleed', 'stun', 'reduceStat', 'increaseStat']
    },
    rounds: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    }
}, { _id: false });

const moveSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    helpDescription: {
        type: String,
        default: ''
    },
    attackStat: {
        type: String,
        required: true,
        enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck']
    },
    defenceStat: {
        type: String,
        required: true,
        enum: ['body', 'reflexes', 'agility', 'charisma', 'tech', 'luck']
    },
    success: {
        type: [moveSuccessFailureSchema],
        default: undefined
    },
    failure: {
        type: [moveSuccessFailureSchema],
        default: undefined
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Move', moveSchema); 