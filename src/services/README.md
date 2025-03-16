# Services

This directory contains service modules that handle different aspects of the application's business logic.

## Service Structure

- **eventNodeService.js**: Handles operations related to event nodes, such as finding, validating, and manipulating nodes in the event tree.
- **eventService.js**: Handles events, including starting events, processing choices, and formatting responses.
- **eventStateManager.js**: Manages event state for users, including tracking active events, client sockets, and room memberships.
- **stateService.js**: Manages application state, including clients, node connections, and combat state. Delegates event state management to EventStateManager.

## Event Node Service

The EventNodeService provides functionality for working with event nodes, including:

- Finding nodes in an event tree by ID
- Ensuring nodes have unique IDs
- Validating node structure
- Ensuring consistent quest events across choices
- Cloning nodes for safe manipulation
- Loading nodes from the database

## Event State Manager

The EventStateManager is responsible for managing event state for users, which was refactored from eventService.js to improve separation of concerns and testability. It handles:

- Getting, setting, and clearing active events for users
- Tracking whether users are currently in events
- Managing client sockets
- Tracking users in rooms/nodes

### Design Decisions

1. **Separation of Concerns**: We extracted event state management into a dedicated class to separate it from general state management and event processing logic.

2. **Singleton Pattern**: We use a singleton pattern for EventStateManager since it represents a global state shared across the application.

3. **Testability**: We export both the class and a singleton instance to make unit testing easier.

4. **Delegation**: The StateService delegates event-related functionality to EventStateManager, which allows for a clean transition and maintains backward compatibility.

5. **Deep Cloning**: We deep clone event nodes to prevent reference issues and ensure data integrity.

6. **History Tracking**: We maintain a history of nodes visited in an event to support navigation and debugging.

## State Service

The StateService manages application state outside of events, including:

- Client connections
- Node/room memberships
- Combat state
- Player mobs and effects

For event-related state, it now delegates to the EventStateManager to maintain separation of concerns.

## How to Use

### EventStateManager

```javascript
const eventStateManager = require('./eventStateManager');

// Check if user is in an event
const isInEvent = eventStateManager.isInEvent(userId);

// Get active event
const activeEvent = eventStateManager.getActiveEvent(userId);

// Set active event
eventStateManager.setActiveEvent(userId, eventId, node, actorId, isStoryEvent);

// Clear active event
eventStateManager.clearActiveEvent(userId);

// Manage sockets and rooms
eventStateManager.setClientSocket(userId, socket);
eventStateManager.addUserToRoom(userId, roomId, socketId);
eventStateManager.getUsersInRoom(roomId);
```

### StateService

```javascript
const stateService = require('./stateService');

// Event state management (delegates to EventStateManager)
const activeEvent = stateService.getActiveEvent(userId);
stateService.setActiveEvent(userId, eventId, node, actorId, isStoryEvent);
stateService.clearActiveEvent(userId);

// Other state management
stateService.setUserCombatState(userId, combatState);
stateService.addClient(userId, socket);
stateService.addUserToNode(userId, nodeAddress);
``` 