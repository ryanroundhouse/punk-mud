# MessageService Refactoring

## Overview

The `MessageService` has been refactored to support dependency injection, making it more testable while maintaining backward compatibility with existing code.

## Key Changes

1. Added constructor with dependency injection
2. Modified `sendCombatMessage` to properly handle hint parameter with special socket handling
3. Exported both singleton instance and class constructor

## Special Note on `sendCombatMessage`

The `sendCombatMessage` method has special handling for when a hint parameter is provided. When a hint is included:
- It bypasses the regular `sendConsoleResponse` method
- It directly emits to the socket with a properly structured response that includes the hint
- This ensures the client receives a properly formatted message with type, message content, and hint

## Usage in Production Code

Existing code using `messageService` will continue to work without changes:

```javascript
const messageService = require('./messageService');

messageService.sendSuccessMessage(userId, 'Success!');
```

## Usage in Test Code

There are two ways to use the MessageService in tests:

### 1. Creating a New Instance with Mocked Dependencies

```javascript
const { MessageService } = require('../../src/services/messageService');

// Create mock dependencies
const mockStateService = {
    getClient: jest.fn().mockReturnValue({
        connected: true,
        emit: jest.fn()
    })
};

const mockLogger = {
    error: jest.fn()
};

// Create MessageService with mocked dependencies
const messageService = new MessageService({
    stateService: mockStateService,
    logger: mockLogger
});

// Test your methods
messageService.sendSuccessMessage('user123', 'Test message');
expect(mockStateService.getClient).toHaveBeenCalledWith('user123');
```

### 2. Mocking the Singleton Instance

```javascript
const messageService = require('../../src/services/messageService');

// Mock the dependencies that MessageService uses
jest.mock('../../src/services/stateService', () => ({
    getClient: jest.fn().mockReturnValue({
        connected: true,
        emit: jest.fn()
    })
}));

// Test using the singleton
messageService.sendErrorMessage('user123', 'Error message');
```

## Methods

| Method | Description | Parameters | Notes |
|--------|-------------|------------|-------|
| `sendConsoleResponse` | Base method for sending any message | `userId`, `message`, `type` | Core method used by most other methods |
| `sendCombatMessage` | Send combat-type message | `userId`, `message`, `hint` (optional) | Special handling when hint is provided |
| `sendErrorMessage` | Send error-type message | `userId`, `message` | |
| `sendSuccessMessage` | Send success-type message | `userId`, `message` | |
| `sendInfoMessage` | Send info-type message | `userId`, `message` | |
| `sendMoveMessage` | Send move-type message | `userId`, `message` | |
| `sendQuestsMessage` | Send quests-type message | `userId`, `message` | |
| `sendListResponse` | Send list-type message | `userId`, `data` | |
| `sendChatMessage` | Send chat-type message | `userId`, `message` | |
| `sendPlayerStatusMessage` | Send status-type message | `userId`, `message` | | 