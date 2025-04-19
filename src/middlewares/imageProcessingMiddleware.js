const fs = require('fs').promises;
const path = require('path');
const User = require('../models/User');
const logger = require('../config/logger');

/**
 * Middleware to delete the user's existing character image before uploading a new one.
 * Assumes req.user is populated by authenticateToken with the JWT payload, containing userId.
 */
const deleteOldCharacterImage = async (req, res, next) => {
    if (!req.user || !req.user.userId) { 
        logger.warn('[Delete Middleware] Could not find userId in req.user.');
        return next(); 
    }

    const userId = req.user.userId;
    logger.info(`[Delete Middleware] Running for user: ${userId}`);

    try {
        const user = await User.findById(userId).select('image').lean();
        
        if (!user) {
             logger.warn(`[Delete Middleware] User not found in DB: ${userId}`);
             return next();
        }

        if (user.image) {
            logger.info(`[Delete Middleware] User ${userId} has existing image path: ${user.image}`);
            
            // Construct path from project root (process.cwd()) and handle leading slash
            const imagePathRelativeToPublic = user.image.startsWith('/') ? user.image.substring(1) : user.image;
            const oldImagePath = path.resolve(process.cwd(), 'public', imagePathRelativeToPublic);
            
            logger.info(`[Delete Middleware] Attempting to delete resolved path: ${oldImagePath}`);
            
            try {
                await fs.unlink(oldImagePath);
                logger.info(`[Delete Middleware] Successfully deleted old image: ${oldImagePath}`);
            } catch (unlinkError) {
                if (unlinkError.code === 'ENOENT') {
                    logger.warn(`[Delete Middleware] Old image not found (ENOENT) at path: ${oldImagePath}. Check path and permissions.`);
                } else {
                    logger.error(`[Delete Middleware] Error deleting file ${oldImagePath}: ${unlinkError.code} - ${unlinkError.message}`);
                }
            }
        } else {
            logger.info(`[Delete Middleware] User ${userId} has no existing image path in DB. Skipping deletion.`);
        }
    } catch (dbError) {
        logger.error(`[Delete Middleware] Database error fetching user ${userId} for image deletion:`, dbError);
    }
    
    next();
};

module.exports = {
    deleteOldCharacterImage
}; 