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
            filename: path.join('logs', 'energy-restore.log')
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
    logger.info('Connected to MongoDB');
    restoreEnergy();
}).catch(err => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
});

const User = require('../../src/models/User');

async function restoreEnergy() {
    try {
        // Find all users where currentEnergy is less than energy
        const result = await User.updateMany(
            { $expr: { $lt: ['$stats.currentEnergy', '$stats.energy'] } },
            [{ $set: { 'stats.currentEnergy': '$stats.energy' } }]
        );

        logger.info(`Energy restored for ${result.modifiedCount} users`);
        logger.info(`${result.matchedCount} users matched the criteria`);
        
        // Disconnect from MongoDB
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
        process.exit(0);
    } catch (error) {
        logger.error('Energy restoration failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
} 