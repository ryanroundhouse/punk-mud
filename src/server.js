const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const socketHandler = require('./sockets/socketHandler');
const logger = require('./config/logger');
const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');

async function startServer() {
    try {
        // Create HTTP server
        const server = http.createServer(app);
        
        // Initialize Socket.IO
        const io = new Server(server);
        
        // Connect to databases
        await connectDB();
        await connectRedis();
        
        // Initialize socket handlers
        socketHandler(io);
        
        // Start server
        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.info(`Server is running on port ${port}`);
        });
        
        // Handle graceful shutdown
        process.on('SIGTERM', async () => {
            logger.info('SIGTERM received. Shutting down gracefully...');
            await require('./config/redis').disconnect();
            process.exit(0);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled Rejection:', error);
    process.exit(1);
});

startServer(); 