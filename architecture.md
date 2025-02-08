# Punk Mud Architectural guide

This document outlines the recommended structure for organizing a Node.js server that handles both REST API requests and WebSocket communication. This structure ensures maintainability, scalability, and modularity.

## **Project Structure**

```
/project-root
│── /src
│   │── /config          # Configuration files (e.g., environment variables, constants)
│   │── /controllers     # Business logic for handling API requests and core application logic
│   │── /routes          # Express route definitions
│   │── /services        # Reusable service logic (e.g., database, caching, shared state, Redis pub/sub)
│   │── /sockets         # WebSocket event handlers
│   │── /middlewares     # Express middleware (authentication, logging, etc.)
│   │── /models          # Database models (Mongoose schemas)
│   │── /utils           # Utility functions/helpers
│   │── app.js           # Express app setup
│   │── server.js        # Server entry point
│── /public              # Static HTML files served to browsers
│── /scripts             # Ad-hoc database migration/modification scripts
│── /tests               # Unit/integration tests
│── package.json
│── .env
│── README.md
```

## **Key Components and Responsibilities**

### **1.** server.js

- Entry point for the server.
- Sets up both Express and WebSocket servers.
- Passes the WebSocket server to the socket handler.

#### Example:

```js
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = require('./src/app');
const socketHandler = require('./src/sockets/socketHandler');
const logger = require('./src/config/logger');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

socketHandler(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
```

### **2.** app.js

- Initializes the Express application.
- Loads middleware and routes.

#### Example:

```js
const express = require('express');
const routes = require('./routes');
const cors = require('cors');
const mongoose = require('mongoose');
const logger = require('./config/logger');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', routes);
app.use(express.static('public')); // Serve static HTML files

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

module.exports = app;
```

### **3.** /routes

- Defines REST API endpoints.

#### Example (`routes/index.js`):

```js
const express = require('express');
const userController = require('../controllers/userController');
const router = express.Router();

router.get('/users', userController.getUsers);

module.exports = router;
```

### **4.** /controllers

- Implements business logic and handles API requests.

#### Example (`controllers/userController.js`):

```js
const stateService = require('../services/stateService');

exports.getUsers = (req, res) => {
  res.json(stateService.getAllUsers());
};
```

### **5.** /sockets

- Manages WebSocket event handling.

#### Example (`sockets/socketHandler.js`):

```js
const stateService = require('../services/stateService');
const redis = require('../services/redisService');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    stateService.addUser(socket.id, { online: true });
    redis.subscribe('channelName', (message) => {
      socket.emit('message', message);
    });

    socket.on('message', (data) => {
      redis.publish('channelName', data);
    });

    socket.on('disconnect', () => {
      stateService.removeUser(socket.id);
    });
  });
};
```

### **6.** /services

- Provides shared state management.
- Handles Redis pub/sub communication.
- Manages MongoDB interactions.

#### Example (`services/stateService.js`):

```js
class StateService {
  constructor() {
    this.userSessions = new Map();
  }

  addUser(id, data) {
    this.userSessions.set(id, data);
  }

  getUser(id) {
    return this.userSessions.get(id);
  }

  removeUser(id) {
    this.userSessions.delete(id);
  }

  getAllUsers() {
    return Array.from(this.userSessions.values());
  }
}

module.exports = new StateService();
```

## **Best Practices**

1. **Separation of Concerns** – Keep API, WebSocket, and database logic modular.
2. **Encapsulation** – Use shared services instead of global variables.
3. **Scalability** – Follow this modular structure to make extensions easier.
4. **Testability** – Organize logic so it can be tested independently.
5. **Security** – Use middleware for authentication and authorization.
6. **Error Handling** – Implement centralized error handling to manage failures gracefully.
7. **Environment Variables** – Store sensitive configurations (API keys, database URLs) in `.env` files and avoid hardcoding them.
8. **Logging** – Use a proper logging mechanism (`winston`) instead of `console.log` for better debugging and monitoring.
9. **Performance Optimization** – Use caching strategies (e.g., Redis) to improve performance and reduce database load.

By following this structure, your Node.js server will be maintainable, scalable, and easy to understand for both humans and AI systems.

