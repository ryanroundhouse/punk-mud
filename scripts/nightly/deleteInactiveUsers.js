const mongoose = require('mongoose');
const winston = require('winston');
const path = require('path');
require('dotenv').config();

// Create a logger specific for this nightly task
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join('logs', 'delete-inactive.log') 
        }),
        new winston.transports.File({ 
            filename: path.join('logs', 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Connect to MongoDB matching the approach in database.js
const connectionString = process.env.MONGODB_URI || 'mongodb://punk-mud-mongodb-1:27017/myapp';

mongoose.connect(connectionString).then(() => {
    logger.info('Connected to MongoDB for inactive user deletion.');
    deleteInactiveUsers();
}).catch(err => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
});

const User = require('../../src/models/User');

async function deleteInactiveUsers() {
    try {
        // Find and delete users where avatarName is null or does not exist
        const result = await User.deleteMany({ avatarName: { $exists: false } });

        logger.info(`Deleted ${result.deletedCount} inactive users (no avatarName).`);
        
        // Disconnect from MongoDB
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB after deleting inactive users.');
        process.exit(0);
    } catch (error) {
        logger.error('Inactive user deletion failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
} 