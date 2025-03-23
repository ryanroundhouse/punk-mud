const mongoose = require('mongoose');
const logger = require('./logger');

async function connectDB() {
    try {
        // Use environment variable with fallback for development
        const connectionString = process.env.MONGODB_URI || 'mongodb://mongodb:27017/myapp';
        
        await mongoose.connect(connectionString, {
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