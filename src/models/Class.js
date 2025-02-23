const mongoose = require('mongoose');

const moveGrowthSchema = new mongoose.Schema({
    level: {
        type: Number,
        required: true,
        min: 1
    },
    move: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Move',
        required: true
    }
}, { _id: false });

const classSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true,
        default: 'No description available.'
    },
    baseHitpoints: {
        type: Number,
        required: true,
        min: 1,
        default: 10
    },
    hpPerLevel: {
        type: Number,
        required: true,
        min: 0,
        default: 2
    },
    hpPerBod: {
        type: Number,
        required: true,
        min: 0,
        default: 1
    },
    primaryStat: {
        type: String,
        required: true,
        enum: ['body', 'reflexes', 'agility', 'tech', 'luck', 'charisma']
    },
    secondaryStats: [{
        type: String,
        enum: ['body', 'reflexes', 'agility', 'tech', 'luck', 'charisma']
    }],
    moveGrowth: [moveGrowthSchema]
}, {
    timestamps: true
});

// Ensure secondaryStats doesn't include primaryStat
classSchema.pre('save', function(next) {
    this.secondaryStats = this.secondaryStats.filter(stat => stat !== this.primaryStat);
    next();
});

// Ensure moveGrowth is sorted by level
classSchema.pre('save', function(next) {
    this.moveGrowth.sort((a, b) => a.level - b.level);
    next();
});

// Add validation to ensure unique levels in moveGrowth
classSchema.pre('save', function(next) {
    // Check for duplicate levels
    const levels = this.moveGrowth.map(mg => mg.level);
    const uniqueLevels = new Set(levels);
    if (levels.length !== uniqueLevels.size) {
        next(new Error('Duplicate levels in move growth are not allowed'));
        return;
    }
    next();
});

module.exports = mongoose.model('Class', classSchema); 