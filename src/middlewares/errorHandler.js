const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
    logger.error('Unhandled error:', {
        error: {
            message: err.message,
            stack: err.stack
        },
        request: {
            method: req.method,
            path: req.path,
            body: req.body,
            query: req.query,
            user: req.user ? req.user.email : 'unauthenticated'
        }
    });

    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.name === 'MongoError' && err.code === 11000) {
        return res.status(409).json({
            error: 'Duplicate Entry',
            details: 'A record with this key already exists'
        });
    }

    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : err.message
    });
};

module.exports = { errorHandler }; 