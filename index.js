const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const User = require('./models/User');
const { sendAuthCode } = require('./services/emailService');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
// Add static file serving middleware
app.use(express.static(path.join(__dirname, 'public')));

// Add logging middleware for all requests
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (Object.keys(req.body).length > 0) {
    console.log('Request body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Add middleware to verify JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

// Add at the top with other constants
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // In production, always use environment variable

// MongoDB connection
mongoose.connect('mongodb://mongodb:27017/myapp', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Generate random 5-digit code
const generateAuthCode = () => Math.floor(10000 + Math.random() * 90000).toString();

// Login route - Step 1
app.post('/api/login', async (req, res) => {
    console.log('\n=== LOGIN REQUEST ===');
    try {
        const { email } = req.body;
        console.log(`Processing login for email: ${email}`);
        
        // Generate auth code
        const authCode = generateAuthCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        console.log(`Generated auth code: ${authCode}`);

        // Update or create user
        await User.findOneAndUpdate(
            { email },
            { 
                email,
                authCode: { code: authCode, expiresAt }
            },
            { upsert: true }
        );
        console.log('User record updated in database');

        // Send auth code via email
        try {
            await sendAuthCode(email, authCode);
            console.log('Auth code email sent successfully');
        } catch (emailError) {
            console.error('Failed to send email:', emailError);
            throw new Error('Failed to send authentication code email');
        }

        console.log('Login request completed successfully');
        res.json({ message: 'Authentication code sent' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to process login' });
    }
});

// Authenticate route - Step 2
app.post('/api/authenticate', async (req, res) => {
    console.log('\n=== AUTHENTICATION REQUEST ===');
    try {
        const { email, code } = req.body;
        console.log(`Validating code for email: ${email}`);
        console.log(`Submitted code: ${code}`);
        
        const user = await User.findOne({ email });
        
        if (!user || !user.authCode || !user.authCode.code) {
            console.log('Invalid request: No pending authentication found');
            return res.status(400).json({ error: 'Invalid request' });
        }

        console.log('Stored auth code:', user.authCode.code);
        console.log('Expiration time:', user.authCode.expiresAt);
        console.log('Current time:', new Date());

        if (user.authCode.expiresAt < new Date()) {
            console.log('Authentication failed: Code expired');
            return res.status(400).json({ error: 'Code expired' });
        }

        if (user.authCode.code !== code) {
            console.log('Authentication failed: Invalid code');
            return res.status(400).json({ error: 'Invalid code' });
        }

        // Clear the auth code
        user.authCode = undefined;
        await user.save();
        console.log('Authentication successful - auth code cleared');

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

        // Return user details and token
        res.json({ 
            message: 'Authentication successful',
            user: {
                email: user.email,
                avatarName: user.avatarName
            },
            token
        });
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});

// Avatar registration route
app.post('/api/register-avatar', authenticateToken, async (req, res) => {
    console.log('\n=== AVATAR REGISTRATION REQUEST ===');
    try {
        const { avatarName } = req.body;
        const email = req.user.email; // Get email from JWT payload
        console.log(`Registering avatar name "${avatarName}" for email: ${email}`);

        // Check if avatar name is already taken
        const existingAvatar = await User.findOne({ avatarName });
        if (existingAvatar) {
            console.log('Avatar name already taken');
            return res.status(400).json({ error: 'Avatar name already taken' });
        }

        // Update user with avatar name
        const user = await User.findOneAndUpdate(
            { email },
            { avatarName },
            { new: true }
        );

        if (!user) {
            console.log('User not found');
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('Avatar registration successful');
        res.json({ message: 'Avatar registered successfully' });
    } catch (error) {
        console.error('Avatar registration error:', error);
        res.status(500).json({ error: 'Failed to register avatar' });
    }
});

// Add a route to verify token and get user data
app.get('/api/verify-token', authenticateToken, (req, res) => {
    res.json({ 
        user: {
            email: req.user.email,
            avatarName: req.user.avatarName
        }
    });
});

// Basic route - modify to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create HTTP server explicitly
const server = http.createServer(app);
const io = new Server(server);

// Add socket.io authentication and connection handling
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        socket.user = verified;
        next();
    } catch (error) {
        next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.email}`);

    // Handle chat messages
    socket.on('chat message', async (message) => {
        try {
            // Fetch latest user data to ensure we have current avatar name
            const user = await User.findById(socket.user.userId);
            if (!user || !user.avatarName) {
                throw new Error('User not found or missing avatar name');
            }

            // Broadcast the message to all connected clients
            io.emit('chat message', {
                username: user.avatarName,
                message: message,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Error handling chat message:', error);
            // Send error only to the sender
            socket.emit('chat message', {
                username: 'SYSTEM',
                message: 'Error sending message',
                timestamp: new Date()
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.user.email}`);
    });
});

// Replace app.listen with server.listen
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 