const mongoose = require('mongoose');
const logger = require('./logger');

async function connectDB() {
    try {
        await mongoose.connect('mongodb://mongodb:27017/myapp', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        logger.info('Connected to MongoDB');
    } catch (err) {
        logger.error('MongoDB connection error:', err);
        throw err;
    }
}

module.exports = {
    connectDB
}; 