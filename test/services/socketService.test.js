const { SocketService } = require('../../src/services/socketService');
const { StateService } = require('../../src/services/stateService');
const { MessageService } = require('../../src/services/messageService');

describe('SocketService', () => {
    let socketService;
    let mockStateService;
    let mockMessageService;
    let mockLogger;
    let mockSubscriber;
    let mockSocket1;
    let mockSocket2;

    beforeEach(() => {
        mockSocket1 = {
            id: 'socket1',
            emit: jest.fn()
        };
        mockSocket2 = {
            id: 'socket2',
            emit: jest.fn()
        };

        // Create mock state service with spies
        mockStateService = {
            getUsersInNode: jest.fn(),
            getClient: jest.fn(),
            addClient: jest.fn(),
            removeClient: jest.fn(),
            addUserToNodeAndUpdateUsernames: jest.fn(),
            removeUserFromNodeAndUpdateUsernames: jest.fn(),
            User: {
                findById: jest.fn()
            }
        };

        mockMessageService = {
            sendChatMessage: jest.fn()
        };

        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        mockSubscriber = {
            subscribe: jest.fn(),
            unsubscribe: jest.fn()
        };

        socketService = new SocketService({
            getSubscriber: () => mockSubscriber,
            logger: mockLogger,
            stateService: mockStateService,
            messageService: mockMessageService
        });
    });

    describe('User Connection Management', () => {
        it('should broadcast system messages when users connect and disconnect', async () => {
            // Setup initial state with two users
            const mockNodeUsers = new Set(['user1']);  // Only user1 remains when checking disconnect
            mockStateService.getUsersInNode
                .mockImplementation((nodeAddress) => {
                    // Return different sets based on when it's called
                    if (mockStateService.getUsersInNode.mock.calls.length === 1) {
                        // First call during disconnect - return only user1 as user2 was just removed
                        return mockNodeUsers;
                    }
                    // Second call during connect - return both users
                    return new Set(['user1', 'user2']);
                });

            mockStateService.getClient
                .mockImplementation((userId) => {
                    if (userId === 'user1') return mockSocket1;
                    if (userId === 'user2') return mockSocket2;
                    return null;
                });

            // Simulate user2 disconnecting
            await socketService.handleDisconnect('user2', 'node1', 'User Two');

            // Verify disconnect message was broadcast only to remaining user (user1)
            expect(mockSocket1.emit).toHaveBeenCalledWith('chat message', {
                username: 'SYSTEM',
                message: 'User Two has disconnected.',
                timestamp: expect.any(String)
            });
            // User2's socket should not receive the disconnect message as they're already gone
            expect(mockSocket2.emit).not.toHaveBeenCalled();

            // Reset the mock
            mockSocket1.emit.mockClear();
            mockSocket2.emit.mockClear();

            // Simulate user2 reconnecting
            await socketService.handleConnect('user2', 'node1', 'User Two');

            // Verify connect message was broadcast to both users
            expect(mockSocket1.emit).toHaveBeenCalledWith('chat message', {
                username: 'SYSTEM',
                message: 'User Two has connected.',
                timestamp: expect.any(String)
            });
            expect(mockSocket2.emit).toHaveBeenCalledWith('chat message', {
                username: 'SYSTEM',
                message: 'User Two has connected.',
                timestamp: expect.any(String)
            });
        });
    });

    // ... existing tests ...
}); 