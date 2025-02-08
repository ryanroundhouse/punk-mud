const express = require('express');
const router = express.Router();
const { verifyBuilderAccess } = require('../middlewares/auth');
const { createUploadMiddleware } = require('../services/uploadService');

// Create upload middlewares for different types
const zoneUpload = createUploadMiddleware('zone');
const characterUpload = createUploadMiddleware('character');
const actorUpload = createUploadMiddleware('actor');
const mobUpload = createUploadMiddleware('mob');

// Upload routes
router.post('/zone', verifyBuilderAccess, zoneUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/zones/' + req.file.filename });
});

router.post('/character', verifyBuilderAccess, characterUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/characters/' + req.file.filename });
});

router.post('/actor', verifyBuilderAccess, actorUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/actors/' + req.file.filename });
});

router.post('/mob', verifyBuilderAccess, mobUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/mobs/' + req.file.filename });
});

module.exports = router; 