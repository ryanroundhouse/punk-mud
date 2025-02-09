const mongoose = require('mongoose');

const moveSuccessFailureSchema = new mongoose.Schema({
    message: String,
    target: {
        type: String,
        enum: ['self', 'opponent']
    },
    stat: {
        type: String,
        enum: ['hitpoints', 'armor', 'body', 'reflexes', 'agility', 'tech', 'luck']
    },
    amount: Number
}, { _id: false });

const moveSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['none', 'attack'],
        default: 'none'
    },
    helpDescription: {
        type: String,
        default: ''
    },
    successChance: {
        type: Number,
        min: 0,
        max: 100,
        default: 50
    },
    success: moveSuccessFailureSchema,
    failure: moveSuccessFailureSchema
}, {
    timestamps: true
});

module.exports = mongoose.model('Move', moveSchema); 