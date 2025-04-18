const express = require('express');
const router = express.Router();
const { verifyBuilderAccess } = require('../middlewares/auth');
const { createUploadMiddleware } = require('../services/uploadService');

// Create a single upload middleware
const upload = createUploadMiddleware();

// Upload routes
router.post('/zone', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/zones/' + req.file.filename });
});

router.post('/character', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/characters/' + req.file.filename });
});

router.post('/actor', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/actors/' + req.file.filename });
});

router.post('/mob', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ path: '/assets/mobs/' + req.file.filename });
});

// Add the route for move images
router.post('/move', verifyBuilderAccess, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Ensure the path matches the expected directory
    res.json({ path: '/assets/moves/' + req.file.filename }); 
});

module.exports = router; 