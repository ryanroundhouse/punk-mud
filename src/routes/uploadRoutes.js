const express = require('express');
const router = express.Router();
const path = require('path'); // Added for path joining
const fs = require('fs').promises; // Import fs.promises
const { authenticateToken, verifyBuilderAccess } = require('../middlewares/auth'); // Correctly import authenticateToken
const { createUploadMiddleware } = require('../services/uploadService');
const User = require('../models/User'); // Import User model
const logger = require('../config/logger'); // Import logger

// Create a single upload middleware
// The 5MB limit is set within createUploadMiddleware by default
const upload = createUploadMiddleware();

// Upload routes
router.post('/zone', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Use path.join for consistency and cross-platform compatibility
    const relativePath = path.join('/assets/zones/', req.file.filename).replace(/\\/g, '/');
    res.json({ path: relativePath });
});

// Modified character upload route: Uploads file, updates DB, deletes old file
router.post(
    '/character',
    authenticateToken,       // Verify user
    upload.single('image'),  // Handle file upload (multer)
    async (req, res) => {     // Make handler async
        // 1. Check if upload was successful
        if (!req.file) {
            logger.warn('Character upload endpoint hit without file. Multer likely rejected it (size/type).');
            if (!res.headersSent) {
                 return res.status(400).json({ error: 'File upload failed. Check file size (max 5MB) and type.' });
            }
            return; 
        }

        // 2. Get User ID and new file path
        const userId = req.user?.userId;
        if (!userId) {
             logger.error('User ID not found in req.user after authenticateToken in character upload.');
             // Attempt to delete the orphaned uploaded file
             try { await fs.unlink(req.file.path); } catch (e) { logger.error('Error deleting orphaned file after missing userId', e); }
             return res.status(401).json({ error: 'Authentication error.' });
        }
        
        const newFilename = req.file.filename;
        const newImagePathRelative = path.join('/assets/characters/', newFilename).replace(/\\/g, '/');
        logger.info(`User ${userId} uploaded new character image: ${newImagePathRelative}`);

        let oldImagePathInDB = null;
        try {
            // 3. Find user and get old image path *before* updating
            const user = await User.findById(userId).select('image').lean(); 
            if (!user) {
                 logger.error(`User ${userId} not found in DB during character image update.`);
                 // Attempt cleanup
                 try { await fs.unlink(req.file.path); } catch (e) { logger.error('Error deleting orphaned file after user not found', e); }
                 return res.status(404).json({ error: 'User not found.' });
            }
            oldImagePathInDB = user.image; // Store the old path (can be null)

            // 4. Update user document with the new image path
            await User.findByIdAndUpdate(userId, { image: newImagePathRelative });
            logger.info(`Successfully updated DB for user ${userId} with new image path.`);

            // 5. If there was an old image path, try to delete the old file
            if (oldImagePathInDB) {
                logger.info(`Attempting to delete old image for user ${userId}: ${oldImagePathInDB}`);
                const oldImageFilePath = path.resolve(process.cwd(), 'public', oldImagePathInDB.startsWith('/') ? oldImagePathInDB.substring(1) : oldImagePathInDB);
                try {
                    await fs.unlink(oldImageFilePath);
                    logger.info(`Successfully deleted old image file: ${oldImageFilePath}`);
                } catch (unlinkError) {
                    if (unlinkError.code === 'ENOENT') {
                        logger.warn(`Old image file not found (ENOENT), skipping deletion: ${oldImageFilePath}`);
                    } else {
                        logger.error(`Error deleting old image file ${oldImageFilePath}:`, unlinkError);
                        // Decide if you want to inform the user. Usually not necessary.
                    }
                }
            } else {
                 logger.info(`User ${userId} had no previous image path in DB.`);
            }

            // 6. Return success with the new path
            res.json({ path: newImagePathRelative });

        } catch (error) {
            logger.error(`Error processing character image upload for user ${userId}:`, error);
            // Attempt cleanup of the newly uploaded file if DB operations failed
            try { await fs.unlink(req.file.path); } catch (e) { logger.error('Error deleting potentially orphaned new file after DB error', e); }
            res.status(500).json({ error: 'Server error updating character image.' });
        }
    }
);

router.post('/actor', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const relativePath = path.join('/assets/actors/', req.file.filename).replace(/\\/g, '/');
    res.json({ path: relativePath });
});

router.post('/mob', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const mobId = req.query.mobId;
    if (!mobId) {
        return res.status(400).json({ error: 'Mob ID is required for upload' });
    }
    // Construct the path including the mobId
    const relativePath = path.join('/assets/mobs/', mobId, req.file.filename).replace(/\\/g, '/');
    res.json({ path: relativePath });
});

// Add the route for move images
router.post('/move', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const relativePath = path.join('/assets/moves/', req.file.filename).replace(/\\/g, '/');
    res.json({ path: relativePath }); 
});

module.exports = router; 