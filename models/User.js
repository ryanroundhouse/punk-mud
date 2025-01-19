const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    avatarName: {
        type: String,
        unique: true,
        sparse: true,  // Allows null values to not count for uniqueness
        trim: true
    },
    authCode: {
        code: String,
        expiresAt: Date
    }
});

module.exports = mongoose.model('User', userSchema); 