const logger = require('../config/logger');

const requestLogger = (req, res, next) => {
    logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        ip: req.ip
    });
    next();
};

module.exports = { requestLogger }; 