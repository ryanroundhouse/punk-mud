const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs').promises;
const winston = require('winston');
const { createClient } = require('redis');

const User = require('./models/User');
const { sendAuthCode } = require('./services/emailService');
const Node = require('./models/Node');
const Actor = require('./models/Actor');

const app = express();
const port = process.env.PORT || 3000;

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Global error handler middleware
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

// Add async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Middleware
app.use(express.json());
// Add static file serving middleware
app.use(express.static(path.join(__dirname, 'public')));

// Update the existing request logging middleware
app.use((req, res, next) => {
    logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        ip: req.ip
    });
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

// Add near the start of your server setup, before defining routes
const uploadDir = path.join(__dirname, 'public/assets/zones');
fs.mkdir(uploadDir, { recursive: true })
    .then(() => logger.info('Upload directory ensured:', uploadDir))
    .catch(err => logger.error('Error creating upload directory:', err));

// Add Redis client configuration after other constants
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379'
});

const redisSubscriber = redisClient.duplicate();

// Add Redis connection handling
Promise.all([redisClient.connect(), redisSubscriber.connect()])
    .then(() => {
        logger.info('Connected to Redis');
    })
    .catch(err => {
        logger.error('Redis connection error:', err);
        process.exit(1);
    });

// Add Redis error handling
redisClient.on('error', (err) => {
    logger.error('Redis error:', err);
});

redisSubscriber.on('error', (err) => {
    logger.error('Redis subscriber error:', err);
});

// MongoDB connection
mongoose.connect('mongodb://mongodb:27017/myapp', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
    logger.info('Connected to MongoDB');
})
.catch(err => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
});

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
        
        // Set default location if none exists
        if (!user.currentNode) {
            user.currentNode = '122.124.10.10';
        }
        
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

// Add these after other constants
const connectedClients = new Map(); // stores socket connection per client
const nodeClients = new Map(); // stores list of clients per node
const nodeUsernames = new Map(); // stores username lists per node

// Add a Set to track which node channels we're subscribed to
const subscribedNodes = new Set();

// Add this near the top with other Map declarations
const actorChatStates = new Map(); // tracks last message index per user per actor

// Update the HELP_TEXT constant with proper spacing and HTML entities
const HELP_TEXT = `
Available Commands:
------------------
ls                   List all players and NPCs in current location
ls &lt;name&gt;            View details of player or NPC in current location
chat &lt;actor&gt;         Talk to an NPC in current location
?                    Display this help message

`.trim();

// Update the socket.io connection handling
io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.user.email}`);
    
    // Store socket connection
    connectedClients.set(socket.user.userId, socket);

    // Get user's current node and add them to the node clients map
    User.findById(socket.user.userId)
        .then(user => {
            if (user && user.currentNode) {
                addUserToNode(socket.user.userId, user.currentNode);
                // Subscribe to the node's chat channel
                subscribeToNodeChat(user.currentNode);
            }
        })
        .catch(err => logger.error('Error fetching user location:', err));

    // Handle chat messages
    socket.on('chat message', async (message) => {
        try {
            const user = await User.findById(socket.user.userId);
            if (!user || !user.avatarName || !user.currentNode) {
                throw new Error('User not found or missing required data');
            }

            const chatMessage = {
                username: user.avatarName,
                message: message,
                timestamp: new Date()
            };

            // Only publish to Redis, don't emit directly
            await redisClient.publish(
                `node:${user.currentNode}:chat`,
                JSON.stringify(chatMessage)
            );
        } catch (error) {
            logger.error('Error handling chat message:', error);
            socket.emit('chat message', {
                username: 'SYSTEM',
                message: 'Error sending message',
                timestamp: new Date()
            });
        }
    });

    // Update the console command handler
    socket.on('console command', async (data) => {
        try {
            const user = await User.findById(socket.user.userId);
            if (!user || !user.currentNode) {
                throw new Error('User not found or missing location data');
            }

            switch (data.command) {
                case 'list':
                    const nodeUsers = nodeUsernames.get(user.currentNode) || [];
                    
                    // Get actors in this location
                    const actors = await Actor.find({ location: user.currentNode });
                    const actorNames = actors.map(actor => actor.name);
                    
                    if (data.target) {
                        // Check players first
                        const targetUser = nodeUsers.find(
                            username => username === data.target
                        );
                        
                        if (targetUser) {
                            socket.emit('console response', {
                                type: 'list',
                                redirect: true,
                                target: targetUser
                            });
                            return;
                        }
                        
                        // Then check actors
                        const targetActor = actors.find(
                            actor => actor.name === data.target
                        );
                        
                        if (targetActor) {
                            socket.emit('console response', {
                                type: 'list',
                                redirect: true,
                                target: targetActor.name,
                                isActor: true,
                                description: targetActor.description
                            });
                            return;
                        }

                        socket.emit('console response', {
                            type: 'error',
                            message: `Character "${data.target}" not found in this location.`
                        });
                    } else {
                        socket.emit('console response', {
                            type: 'list',
                            users: nodeUsers,
                            actors: actorNames
                        });
                    }
                    break;

                case 'help':
                    socket.emit('console response', {
                        type: 'info',
                        message: HELP_TEXT
                    });
                    break;
                    
                case 'chat':
                    if (!data.target) {
                        socket.emit('console response', {
                            type: 'error',
                            message: 'Usage: chat <actor name>'
                        });
                        break;
                    }

                    // Get actors in current location
                    const locationActors = await Actor.find({ location: user.currentNode });
                    const targetActor = locationActors.find(
                        actor => actor.name.toLowerCase() === data.target.toLowerCase()
                    );

                    if (!targetActor) {
                        socket.emit('console response', {
                            type: 'error',
                            message: `${data.target} is not here.`
                        });
                        break;
                    }

                    if (!targetActor.chatMessages || targetActor.chatMessages.length === 0) {
                        socket.emit('console response', {
                            type: 'chat',
                            message: `${targetActor.name} has nothing to say.`
                        });
                        break;
                    }

                    // Get or initialize chat state for this user and actor
                    const stateKey = `${socket.user.userId}-${targetActor.id}`;
                    let currentIndex = actorChatStates.get(stateKey) || 0;

                    // Sort messages by order
                    const sortedMessages = [...targetActor.chatMessages].sort((a, b) => a.order - b.order);

                    // Get next message
                    const message = sortedMessages[currentIndex];

                    // Update index for next time, wrapping around if needed
                    currentIndex = (currentIndex + 1) % sortedMessages.length;
                    actorChatStates.set(stateKey, currentIndex);

                    socket.emit('console response', {
                        type: 'chat',
                        message: `${targetActor.name} says: "${message.message}"`
                    });
                    break;

                default:
                    socket.emit('console response', {
                        type: 'error',
                        message: 'Unknown command'
                    });
            }
        } catch (error) {
            logger.error('Error handling console command:', error);
            socket.emit('console response', {
                type: 'error',
                message: 'Error processing command'
            });
        }
    });

    socket.on('disconnect', async () => {
        logger.info(`User disconnected: ${socket.user.email}`);
        
        try {
            const user = await User.findById(socket.user.userId);
            if (user && user.currentNode) {
                // Clear all actor chat states for this user
                clearActorChatStates(socket.user.userId, user.currentNode);
                
                // Only need the general message for disconnection
                await publishSystemMessage(
                    user.currentNode, 
                    `${user.avatarName} has disconnected.`,
                    null,
                    user._id.toString()
                );
            }
            
            removeUserFromAllNodes(socket.user.userId);
            connectedClients.delete(socket.user.userId);
        } catch (error) {
            logger.error('Error handling disconnect:', error);
        }
    });
});

// Helper functions for managing node clients
function addUserToNode(userId, nodeAddress) {
    if (!nodeClients.has(nodeAddress)) {
        nodeClients.set(nodeAddress, new Set());
    }
    nodeClients.get(nodeAddress).add(userId);
    
    // Update the usernames list and broadcast
    updateNodeUsernames(nodeAddress);
    logger.info(`User ${userId} added to node ${nodeAddress}`);
}

function removeUserFromNode(userId, nodeAddress) {
    const nodeSet = nodeClients.get(nodeAddress);
    if (nodeSet) {
        nodeSet.delete(userId);
        // Clear actor chat states when leaving node
        clearActorChatStates(userId, nodeAddress);
        
        if (nodeSet.size === 0) {
            nodeClients.delete(nodeAddress);
            nodeUsernames.delete(nodeAddress);
            // Unsubscribe from empty node's chat
            unsubscribeFromNodeChat(nodeAddress);
        } else {
            // Update the usernames list and broadcast
            updateNodeUsernames(nodeAddress);
        }
    }
}

function removeUserFromAllNodes(userId) {
    for (const [nodeAddress, users] of nodeClients.entries()) {
        if (users.has(userId)) {
            removeUserFromNode(userId, nodeAddress);
        }
    }
}

async function subscribeToNodeChat(nodeAddress) {
    const channel = `node:${nodeAddress}:chat`;
    
    // Only subscribe if we haven't already
    if (!subscribedNodes.has(channel)) {
        await redisSubscriber.subscribe(channel, (message) => {
            try {
                const chatMessage = JSON.parse(message);
                // Get the node's users and emit to each one
                const nodeUsers = nodeClients.get(nodeAddress);
                if (nodeUsers) {
                    nodeUsers.forEach(userId => {
                        const userSocket = connectedClients.get(userId);
                        if (userSocket) {
                            userSocket.emit('chat message', chatMessage);
                        }
                    });
                }
            } catch (error) {
                logger.error('Error broadcasting chat message:', error);
            }
        });
        subscribedNodes.add(channel);
        logger.info(`Subscribed to chat channel for node ${nodeAddress}`);
    }
}

async function unsubscribeFromNodeChat(nodeAddress) {
    const channel = `node:${nodeAddress}:chat`;
    // Only unsubscribe if no users are left in the node
    const nodeUsers = nodeClients.get(nodeAddress);
    if (!nodeUsers || nodeUsers.size === 0) {
        await redisSubscriber.unsubscribe(channel);
        subscribedNodes.delete(channel);
        logger.info(`Unsubscribed from chat channel for node ${nodeAddress}`);
    }
}

// Update the multer storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public/assets/zones');
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Keep the file extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'zone-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Middleware to verify builder access
const verifyBuilderAccess = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user || !user.isBuilder) {
            return res.status(403).json({ error: 'Not authorized to access builder' });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Node endpoints
app.post('/api/nodes', verifyBuilderAccess, asyncHandler(async (req, res) => {
    const { name, address, description, image, exits } = req.body;
    
    if (!name || !address || !description) {
        throw new Error('Missing required fields');
    }

    // Check if node with address already exists
    const existingNode = await Node.findOne({ address });
    if (existingNode) {
        logger.info('Updating existing node', {
            address,
            userId: req.user._id
        });

        // Update existing node
        existingNode.name = name;
        existingNode.description = description;
        existingNode.image = image;
        existingNode.exits = exits;
        existingNode.updatedAt = Date.now();
        
        await existingNode.save();
        
        logger.info('Node updated successfully', {
            nodeId: existingNode._id,
            address
        });
        
        return res.json(existingNode);
    }

    // Create new node
    const node = new Node({
        name,
        address,
        description,
        image,
        exits
    });
    
    await node.save();
    
    logger.info('New node created', {
        nodeId: node._id,
        address,
        userId: req.user._id
    });
    
    res.status(201).json(node);
}));

// Add a new endpoint for getting public node information
app.get('/api/nodes/public', authenticateToken, async (req, res) => {
    try {
        const nodes = await Node.find({}, 'address name'); // Only return address and name fields
        res.json(nodes);
    } catch (error) {
        logger.error('Error fetching public nodes:', error);
        res.status(500).json({ error: 'Error fetching nodes' });
    }
});

// Keep the existing /api/nodes endpoint for builders
app.get('/api/nodes', verifyBuilderAccess, async (req, res) => {
    try {
        const nodes = await Node.find().sort({ name: 1 });
        res.json(nodes);
    } catch (error) {
        logger.error('Error fetching nodes:', error);
        res.status(500).json({ error: 'Error fetching nodes' });
    }
});

app.delete('/api/nodes/:address', verifyBuilderAccess, async (req, res) => {
    try {
        const node = await Node.findOneAndDelete({ address: req.params.address });
        if (!node) {
            return res.status(404).json({ error: 'Node not found' });
        }
        
        // If node had an image, delete it
        if (node.image) {
            const imagePath = path.join(__dirname, 'public', node.image);
            await fs.unlink(imagePath).catch(console.error);
        }
        
        res.json({ message: 'Node deleted successfully' });
    } catch (error) {
        console.error('Error deleting node:', error);
        res.status(500).json({ error: 'Error deleting node' });
    }
});

// Image upload endpoint
app.post('/api/upload-image', verifyBuilderAccess, asyncHandler(async (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            logger.error('Upload error:', err);
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        error: 'File too large',
                        details: 'Maximum file size is 5MB'
                    });
                }
            }
            return res.status(500).json({
                error: 'Upload failed',
                details: 'Unable to process image upload'
            });
        }

        if (!req.file) {
            logger.error('No file in request');
            return res.status(400).json({
                error: 'No file',
                details: 'No image file provided'
            });
        }

        logger.info('File upload details:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            filename: req.file.filename,
            path: req.file.path,
            size: req.file.size
        });

        try {
            const relativePath = '/assets/zones/' + req.file.filename;
            
            // Verify file exists after upload
            const fullPath = path.join(__dirname, 'public', relativePath);
            await fs.access(fullPath);
            
            logger.info('Image upload successful', {
                relativePath,
                fullPath,
                exists: true
            });
            
            res.json({ path: relativePath });
        } catch (error) {
            logger.error('Error verifying uploaded file:', error);
            throw error;
        }
    });
}));

// Replace app.listen with server.listen
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled Rejection:', error);
    process.exit(1);
});

// Add error handling middleware last
app.use(errorHandler);

// Add this temporary debug endpoint
app.get('/api/check-image/:filename', (req, res) => {
    const imagePath = path.join(__dirname, 'public/assets/zones', req.params.filename);
    fs.access(imagePath)
        .then(() => res.json({ exists: true, path: imagePath }))
        .catch(() => res.json({ exists: false, path: imagePath }));
});

// Update the node endpoint to check and update player location
app.get('/api/nodes/:address', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const oldNode = user.currentNode;
        const targetAddress = req.params.address === 'current' ? user.currentNode : req.params.address;

        logger.info('Fetching node:', { targetAddress, userId: user._id });

        const node = await Node.findOne({ address: targetAddress });
        if (!node) {
            // If node not found, reset to starting node
            user.currentNode = '122.124.10.10';
            await user.save();
            
            const startNode = await Node.findOne({ address: '122.124.10.10' });
            if (!startNode) {
                return res.status(404).json({ error: 'Starting node not found - critical error' });
            }
            return res.json(startNode);
        }

        // If moving to a new node, update the node clients maps
        if (targetAddress !== oldNode) {
            // Remove from old node
            if (oldNode) {
                const oldNodeData = await Node.findOne({ address: oldNode });
                removeUserFromNode(user._id.toString(), oldNode);
                // Publish exit message
                await publishSystemMessage(
                    oldNode, 
                    `${user.avatarName} has left.`,
                    `You have left ${oldNodeData ? oldNodeData.name : 'the area'}.`,
                    user._id.toString()
                );
            }
            
            // Add to new node
            addUserToNode(user._id.toString(), targetAddress);
            // Update subscriptions
            if (oldNode) {
                await unsubscribeFromNodeChat(oldNode);
            }
            await subscribeToNodeChat(targetAddress);
            
            // Publish entry message with personalized message for the entering user
            await publishSystemMessage(
                targetAddress,
                `${user.avatarName} has entered.`,
                `You have entered ${node.name}.`,
                user._id.toString()
            );

            // Send initial users list to the joining user
            const userSocket = connectedClients.get(user._id.toString());
            if (userSocket) {
                const usernames = nodeUsernames.get(targetAddress) || [];
                userSocket.emit('users update', usernames);
            }
        }

        // If moving to a new node, verify the movement
        if (targetAddress !== user.currentNode) {
            const currentNode = await Node.findOne({ address: user.currentNode });
            if (!currentNode) {
                // If current node is invalid, reset to starting node
                user.currentNode = '122.124.10.10';
                await user.save();
                return res.status(400).json({ error: 'Invalid current location - reset to start' });
            }

            // Check if there's a valid exit from the current node to the target node
            const hasValidExit = currentNode.exits.some(exit => exit.target === targetAddress);
            if (!hasValidExit) {
                return res.status(403).json({ error: 'Invalid movement - nodes are not connected' });
            }

            // Update user's location after successful movement validation
            user.currentNode = targetAddress;
            await user.save();
        }

        res.json(node);
    } catch (error) {
        logger.error('Error fetching node:', error);
        res.status(500).json({ error: 'Error fetching node' });
    }
});

// Add endpoint to get user's current location
app.get('/api/user/location', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ currentNode: user.currentNode });
    } catch (error) {
        logger.error('Error fetching user location:', error);
        res.status(500).json({ error: 'Error fetching user location' });
    }
});

// Add graceful shutdown handling for Redis
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    await redisClient.quit();
    await redisSubscriber.quit();
    process.exit(0);
});

// Update the publishSystemMessage function
async function publishSystemMessage(nodeAddress, message, personalMessage, userId) {
    const baseMessage = {
        username: 'SYSTEM',
        timestamp: new Date(),
        type: 'system'
    };

    // Get the node's users
    const nodeUsers = nodeClients.get(nodeAddress);
    if (nodeUsers) {
        // For system messages, emit directly instead of using Redis
        // This prevents duplicate system messages
        nodeUsers.forEach(targetUserId => {
            const userSocket = connectedClients.get(targetUserId);
            if (userSocket) {
                if (targetUserId === userId && personalMessage) {
                    userSocket.emit('chat message', {
                        ...baseMessage,
                        message: personalMessage
                    });
                } else {
                    userSocket.emit('chat message', {
                        ...baseMessage,
                        message: message
                    });
                }
            }
        });
    }
}

// Add this new function to handle username updates
async function updateNodeUsernames(nodeAddress) {
    try {
        const nodeSet = nodeClients.get(nodeAddress);
        if (!nodeSet) return;

        // Get usernames for all users in the node
        const usernames = [];
        for (const userId of nodeSet) {
            const user = await User.findById(userId);
            if (user && user.avatarName) {
                usernames.push(user.avatarName);
            }
        }

        // Store the username list
        nodeUsernames.set(nodeAddress, usernames);

        // Broadcast to all users in the node
        const nodeUsers = nodeClients.get(nodeAddress);
        if (nodeUsers) {
            nodeUsers.forEach(userId => {
                const userSocket = connectedClients.get(userId);
                if (userSocket) {
                    userSocket.emit('users update', usernames);
                }
            });
        }
    } catch (error) {
        logger.error('Error updating node usernames:', error);
    }
}

// Get character data
app.get('/api/user/character', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
});

// Update character data
app.post('/api/user/character', authenticateToken, async (req, res) => {
    try {
        const { description, image } = req.body;
        
        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { 
                description,
                image
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image
        });
    } catch (error) {
        logger.error('Error updating character:', error);
        res.status(500).json({ error: 'Error updating character' });
    }
});

// Add character image upload endpoint
app.post('/api/upload-character-image', authenticateToken, asyncHandler(async (req, res) => {
    const uploadDir = path.join(__dirname, 'public/assets/characters');
    await fs.mkdir(uploadDir, { recursive: true });

    const characterUpload = multer({
        storage: multer.diskStorage({
            destination: uploadDir,
            filename: function (req, file, cb) {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, 'character-' + uniqueSuffix + ext);
            }
        }),
        limits: {
            fileSize: 5 * 1024 * 1024 // 5MB limit
        },
        fileFilter: (req, file, cb) => {
            const allowedTypes = /jpeg|jpg|png|gif/;
            const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = allowedTypes.test(file.mimetype);
            
            if (extname && mimetype) {
                return cb(null, true);
            }
            cb(new Error('Only image files are allowed!'));
        }
    }).single('image');

    characterUpload(req, res, async (err) => {
        if (err) {
            logger.error('Upload error:', err);
            return res.status(400).json({
                error: 'Upload failed',
                details: err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                error: 'No file',
                details: 'No image file provided'
            });
        }

        try {
            const relativePath = '/assets/characters/' + req.file.filename;
            res.json({ path: relativePath });
        } catch (error) {
            logger.error('Error processing uploaded file:', error);
            throw error;
        }
    });
}));

// Add this endpoint after the other character-related endpoints
app.get('/api/user/character/:username', authenticateToken, async (req, res) => {
    try {
        // Find user by avatar name
        const character = await User.findOne({ avatarName: req.params.username });
        
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        // Only return public information
        res.json({
            avatarName: character.avatarName,
            description: character.description,
            image: character.image
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
});

// Get all actors
app.get('/api/actors', verifyBuilderAccess, async (req, res) => {
    try {
        const actors = await Actor.find().sort({ name: 1 });
        res.json(actors);
    } catch (error) {
        logger.error('Error fetching actors:', error);
        res.status(500).json({ error: 'Error fetching actors' });
    }
});

// Create or update actor
app.post('/api/actors', verifyBuilderAccess, asyncHandler(async (req, res) => {
    const { id, name, description, image, location, chatMessages } = req.body;
    
    // Only check for name and description as required fields
    if (!name || !description) {
        throw new Error('Missing required fields: name and description are required');
    }

    // If id is provided, update existing actor
    if (id) {
        const existingActor = await Actor.findById(id);
        if (!existingActor) {
            return res.status(404).json({ error: 'Actor not found' });
        }

        logger.info('Updating existing actor', {
            id,
            name,
            userId: req.user._id
        });

        // Update existing actor
        existingActor.name = name;
        existingActor.description = description;
        existingActor.image = image;
        existingActor.location = location;
        existingActor.chatMessages = chatMessages;
        existingActor.updatedAt = Date.now();
        
        await existingActor.save();
        
        logger.info('Actor updated successfully', {
            actorId: existingActor._id,
            name
        });
        
        return res.json(existingActor);
    }

    // Create new actor (id will be auto-generated)
    const actor = new Actor({
        name,
        description,
        image,
        location,
        chatMessages
    });
    
    await actor.save();
    
    logger.info('New actor created', {
        actorId: actor._id,
        name,
        userId: req.user._id
    });
    
    res.status(201).json(actor);
}));

// Delete actor
app.delete('/api/actors/:id', verifyBuilderAccess, async (req, res) => {
    try {
        const actor = await Actor.findByIdAndDelete(req.params.id);
        if (!actor) {
            return res.status(404).json({ error: 'Actor not found' });
        }
        
        // If actor had an image, delete it
        if (actor.image) {
            const imagePath = path.join(__dirname, 'public', actor.image);
            await fs.unlink(imagePath).catch(err => 
                logger.error('Error deleting actor image:', err)
            );
        }
        
        logger.info('Actor deleted successfully', {
            actorId: actor._id,
            name: actor.name,
            userId: req.user._id
        });
        
        res.json({ message: 'Actor deleted successfully' });
    } catch (error) {
        logger.error('Error deleting actor:', error);
        res.status(500).json({ error: 'Error deleting actor' });
    }
});

// Keep only the helper function for clearing actor chat states
function clearActorChatStates(userId, nodeAddress) {
    // Get all actors in the location
    Actor.find({ location: nodeAddress })
        .then(actors => {
            // Clear chat state for each actor
            actors.forEach(actor => {
                const stateKey = `${userId}-${actor.id}`;
                actorChatStates.delete(stateKey);
            });
        })
        .catch(err => logger.error('Error clearing actor chat states:', err));
}

// Add this near the other upload configurations
const actorUpload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadDir = path.join(__dirname, 'public/assets/actors');
            fs.mkdir(uploadDir, { recursive: true })
                .then(() => cb(null, uploadDir))
                .catch(err => cb(err));
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            cb(null, 'actor-' + uniqueSuffix + ext);
        }
    }),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Add a new endpoint for actor image uploads
app.post('/api/upload-actor-image', verifyBuilderAccess, asyncHandler(async (req, res) => {
    actorUpload.single('image')(req, res, async (err) => {
        if (err) {
            logger.error('Actor image upload error:', err);
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        error: 'File too large',
                        details: 'Maximum file size is 5MB'
                    });
                }
            }
            return res.status(500).json({
                error: 'Upload failed',
                details: err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                error: 'No file',
                details: 'No image file provided'
            });
        }

        try {
            const relativePath = '/assets/actors/' + req.file.filename;
            
            // Verify file exists after upload
            const fullPath = path.join(__dirname, 'public', relativePath);
            await fs.access(fullPath);
            
            logger.info('Actor image upload successful', {
                relativePath,
                fullPath,
                exists: true
            });
            
            res.json({ path: relativePath });
        } catch (error) {
            logger.error('Error verifying uploaded actor image:', error);
            throw error;
        }
    });
})); 