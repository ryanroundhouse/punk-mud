# PUNK MUD Client-Server Interface Documentation

This document provides a comprehensive overview of all client-server interactions in PUNK MUD, organized from the client's perspective.

## Table of Contents
- [REST API Endpoints](#rest-api-endpoints)
- [Outbound Messages (Client to Server)](#outbound-messages-client-to-server)
- [Inbound Messages (Server to Client)](#inbound-messages-server-to-client)

## REST API Endpoints

### Authentication and User Data
- `GET /api/auth/verify-token`
  - **Purpose**: Verifies JWT token validity
  - **Request**: Token in Authorization header
  - **Response**: Success/Error
  - **Used**: On game page load to ensure user is authenticated

### Combat
- `GET /api/combat/status`
  - **Purpose**: Checks if user is in combat
  - **Request**: Token in Authorization header
  - **Response**: Combat status object (inCombat, enemyName, playerHealth, enemyHealth)
  - **Used**: On page load to restore combat state

## Outbound Messages (Client to Server)

### Socket Connection
- **Socket Connection with Authentication**
  - **Purpose**: Establishes authenticated WebSocket connection
  - **Data**: JWT token in auth object
  - **Sent**: On page load after token verification
  - **Example**:
  ```javascript
  socket = io({
      auth: {
          token: token
      }
  });
  ```

### Node Data
- **Event**: `get node data`
  - **Purpose**: Requests node data for the current location or a specific address
  - **Data**: Object with optional address parameter
  - **Triggered**: On page load, after movement, or when requesting a specific location
  - **Example**:
  ```javascript
  // Request current location
  socket.emit('get node data');
  
  // Request specific location
  socket.emit('get node data', { address: 'city.center' });
  ```

### Chat Messages
- **Event**: `chat message`
  - **Purpose**: Sends a chat message to current location
  - **Data**: String containing message text
  - **Triggered**: When user enters text in chat input and presses Send or Enter
  - **Example**: 
  ```javascript
  socket.emit('chat message', "Hello everyone!");
  ```

### Console Commands
- **Event**: `console command`
  - **Purpose**: Sends game commands for processing
  - **Data**: Object containing command name and parameters
  - **Triggered**: When user enters commands in terminal and presses Enter
  - **Examples**:
  
  ```javascript
  // Movement commands
  socket.emit('console command', { 
      command: 'move',
      direction: 'north'
  });
  
  // List command (with optional target)
  socket.emit('console command', { 
      command: 'list',
      target: 'playerName' // Optional, for examining a specific entity
  });
  
  // Chat with NPC/mob
  socket.emit('console command', {
      command: 'chat',
      target: 'actorName'
  });
  
  // Fight with mob
  socket.emit('console command', {
      command: 'fight',
      target: 'mobName'
  });
  
  // View quests
  socket.emit('console command', { command: 'quests' });
  
  // Help command
  socket.emit('console command', { command: 'help' });
  
  // Direct numeric input (for event choices)
  socket.emit('console command', { command: '1' });
  
  // Combat commands (attack, flee, etc.)
  socket.emit('console command', { command: 'attack' });
  socket.emit('console command', { command: 'flee' });
  
  // Rest to recover HP
  socket.emit('console command', { command: 'rest' });
  ```

## Inbound Messages (Server to Client)

### Connection Events
- **Event**: `connect_error`
  - **Purpose**: Notifies of connection errors
  - **Data**: Error object
  - **Action**: Logs error to console

### Node Data
- **Event**: `node data`
  - **Purpose**: Receives node information for display
  - **Data**: Node object with name, description, image, exits, etc.
  - **Action**: Updates UI with node information
  - **Example**:
  ```javascript
  {
    address: "city.center",
    name: "City Center",
    description: "A bustling plaza surrounded by neon signs and holographic advertisements.",
    image: "/assets/locations/city_center.jpg",
    exits: [
      {direction: "north", targetName: "Shopping District", targetAddress: "city.shops"},
      {direction: "south", targetName: "Residential Zone", targetAddress: "city.residential"}
    ],
    isRestPoint: true,
    enemies: []
  }
  ```

### Chat Events
- **Event**: `chat message`
  - **Purpose**: Receives chat messages from other users or system
  - **Data**: Object containing `username`, `message`, and `timestamp`
  - **Action**: Displays in chat panel, stores in local storage
  - **Example**:
  ```javascript
  {
    username: "PlayerName",
    message: "Hello everyone!",
    timestamp: "2023-04-01T12:34:56.789Z"
  }
  ```
  - **Special Case**: System messages have username "SYSTEM"

### User Presence
- **Event**: `users update`
  - **Purpose**: Updates list of users in current location
  - **Data**: Array of usernames
  - **Action**: Updates "Users Present" list in UI
  - **Example**:
  ```javascript
  ["PlayerOne", "PlayerTwo", "PlayerThree"]
  ```

### Console Responses
- **Event**: `console response`
  - **Purpose**: Receives responses to console commands
  - **Data**: Object with type and message
  - **Action**: Displays in terminal with appropriate formatting based on type
  - **Types and Examples**:

  - **Default Response**
    ```javascript
    {
      type: 'default',
      message: 'Command processed successfully'
    }
    ```

  - **Error Response**
    ```javascript
    {
      type: 'error',
      message: 'Unknown command'
    }
    ```

  - **Success Response**
    ```javascript
    {
      type: 'success',
      message: 'You successfully completed the quest!'
    }
    ```

  - **Move Response** (triggers node reload)
    ```javascript
    {
      type: 'move',
      message: 'You move north to City Center'
    }
    ```

  - **Combat Response**
    ```javascript
    {
      type: 'combat',
      message: 'You attack Cyber Punk for 15 damage!',
      hint: 'Type ? to see available combat commands.' // Optional hint
    }
    ```

  - **List Response** (room contents)
    ```javascript
    {
      type: 'list',
      message: 'Players and NPCs in room...',
      users: ["PlayerOne", "PlayerTwo"],
      actors: ["Shopkeeper", "Guard"],
      enemies: [
        {name: "Cyber Punk", level: 5}
      ],
      playerLevel: 4
    }
    ```

  - **Actor/Character Inspection** (opens modal)
    ```javascript
    {
      type: 'list',
      redirect: true,
      target: 'Shopkeeper',
      isActor: true,
      description: 'A friendly shopkeeper who sells various items.',
      image: '/images/shopkeeper.jpg'
    }
    ```

  - **Quest Information**
    ```javascript
    {
      type: 'quests',
      message: 'Active Quests:\n--------------\nFind the lost data chip\n  Hint: Check the abandoned server room'
    }
    ```

  - **Player Status** (updates health/energy bars)
    ```javascript
    {
      type: 'playerStatus',
      message: 'HP: 85/100 | Energy: 25/30'
    }
    ```

  - **Event Response** (story events)
    ```javascript
    {
      type: 'event',
      message: 'The mysterious figure approaches you...',
      isEndOfEvent: false
    }
    ```

### Story Events
- **Event**: `event start`
  - **Purpose**: Notifies start of a story event
  - **Data**: Object with message
  - **Action**: Displays event message in terminal
  - **Example**:
  ```javascript
  {
    message: "A stranger approaches you with an offer..."
  }
  ```

- **Event**: `event choice`
  - **Purpose**: Presents choices for a story event
  - **Data**: Object with message containing choices
  - **Action**: Displays choices in terminal
  - **Example**:
  ```javascript
  {
    message: "1. Accept the offer\n2. Decline politely\n3. Walk away"
  }
  ```

- **Event**: `event end`
  - **Purpose**: Notifies end of a story event
  - **Data**: Object with message
  - **Action**: Displays event conclusion in terminal
  - **Example**:
  ```javascript
  {
    message: "The stranger nods and walks away."
  }
  ```

### Death Events
- **Event**: `player death`
  - **Purpose**: Notifies that player has died
  - **Data**: No specific data
  - **Action**: Refreshes location and displays death message
  - **Visual**: Adds a red "YOU HAVE DIED" separator in terminal

## Local Storage

The client uses localStorage to maintain state across sessions:

- `token`: JWT authentication token
- `chatMessages`: Recent chat messages (up to 50)
- `commandHistory`: Command history for up/down arrow navigation (up to 50 commands)
- `terminalHistory`: Recent terminal commands and responses (up to 20 entries)