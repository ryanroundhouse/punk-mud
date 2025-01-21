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

const User = require('./models/User');
const { sendAuthCode } = require('./services/emailService');

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

// Node Schema
const nodeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function(v) {
                return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(v);
            },
            message: props => `${props.value} is not a valid IP address!`
        }
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: ''
    },
    exits: [{
        direction: {
            type: String,
            required: true
        },
        target: {
            type: String,
            required: true
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Node = mongoose.model('Node', nodeSchema);

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

app.get('/api/nodes', verifyBuilderAccess, async (req, res) => {
    try {
        const nodes = await Node.find().sort({ name: 1 });
        res.json(nodes);
    } catch (error) {
        console.error('Error fetching nodes:', error);
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

// Add to User schema
const userSchema = new mongoose.Schema({
    // ... existing user schema fields ...
    isBuilder: {
        type: Boolean,
        default: false
    }
});

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

// Add this endpoint to get a specific node
app.get('/api/nodes/:address', authenticateToken, async (req, res) => {
    try {
        const node = await Node.findOne({ address: req.params.address });
        if (!node) {
            return res.status(404).json({ error: 'Node not found' });
        }
        res.json(node);
    } catch (error) {
        logger.error('Error fetching node:', error);
        res.status(500).json({ error: 'Error fetching node' });
    }
}); 