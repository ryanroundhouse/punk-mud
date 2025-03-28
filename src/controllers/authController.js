const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { emailService } = require('../services/emailService');
const { JWT_SECRET } = require('../middlewares/auth');
const logger = require('../config/logger');

// Generate random 5-digit code
const generateAuthCode = () => Math.floor(10000 + Math.random() * 90000).toString();

// More strict email validation regex that prevents domains starting with dots
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;

async function login(req, res) {
    try {
        const { email } = req.body;
        logger.info(`Processing login for email: ${email}`);
        
        // Validate email format
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Generate auth code
        const authCode = generateAuthCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Log auth code for development
        console.log('Authentication code:', authCode);

        // Update or create user
        await User.findOneAndUpdate(
            { email },
            { 
                email,
                authCode: { code: authCode, expiresAt },
                moves: ['67e5ee92505d5890de625149']  // Set default move explicitly
            },
            { upsert: true }
        );

        // Send auth code via email
        try {
            await emailService.sendAuthCode(email, authCode);
            logger.info('Auth code email sent successfully');
        } catch (emailError) {
            logger.error('Failed to send email:', emailError);
            throw new Error('Failed to send authentication code email');
        }

        res.json({ message: 'Authentication code sent' });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Failed to process login' });
    }
}

async function authenticate(req, res) {
    try {
        const { email, code } = req.body;
        logger.info(`Validating code for email: ${email}`);
        
        const user = await User.findOne({ email });
        
        if (!user || !user.authCode || !user.authCode.code) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        if (user.authCode.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code expired' });
        }

        if (user.authCode.code !== code) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        // Clear the auth code
        user.authCode = undefined;
        
        // Set default location if none exists
        if (!user.currentNode) {
            user.currentNode = '122.124.10.10';
        }
        
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user._id,
                email: user.email,
                avatarName: user.avatarName 
            }, 
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            message: 'Authentication successful',
            user: {
                email: user.email,
                avatarName: user.avatarName
            },
            token
        });
    } catch (error) {
        logger.error('Authentication error:', error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
}

module.exports = {
    login,
    authenticate
}; 