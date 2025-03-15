// Mock Redis before importing any modules that use it
jest.mock('../../src/config/redis', () => {
    const mockSubscriber = {
        subscribe: jest.fn().mockImplementation((channel, callback) => {
            // Store the callback for testing
            mockSubscriber.channels[channel] = callback;
            return Promise.resolve();
        }),
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        channels: {}
    };

    return {
        getSubscriber: jest.fn().mockReturnValue(mockSubscriber)
    };
});

// Mock logger to avoid console spam during tests
jest.mock('../../src/config/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
}));

const { getSubscriber } = require('../../src/config/redis');
const logger = require('../../src/config/logger');
const stateService = require('../../src/services/stateService');
const { SocketService } = require('../../src/services/socketService');

describe('SocketService Integration', () => {
    let socketService;
    let mockSubscriber;
    
    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Get the mock subscriber
        mockSubscriber = getSubscriber();
        mockSubscriber.channels = {};
        
        // Create a new instance with real stateService but mocked Redis
        socketService = new SocketService({
            getSubscriber,
            logger,
            stateService
        });
    });
    
    it('should register with Redis for node channels', async () => {
        // Arrange
        const nodeAddress = 'test-node-123';
        
        // Act
        await socketService.subscribeToNodeChat(nodeAddress);
        
        // Assert
        expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
            `node:${nodeAddress}:chat`,
            expect.any(Function)
        );
        expect(socketService.isSubscribed(nodeAddress)).toBe(true);
    });
    
    it('should process messages from Redis and distribute to clients', async () => {
        // This test requires mocking parts of stateService
        // Arrange
        const nodeAddress = 'test-node-123';
        const mockUsers = new Set(['user1', 'user2']);
        const mockSocket1 = { emit: jest.fn() };
        const mockSocket2 = { emit: jest.fn() };
        const mockMessage = { text: 'Hello World', from: 'user1', timestamp: Date.now() };
        
        // Create spies on stateService
        const getUsersInNodeSpy = jest.spyOn(stateService, 'getUsersInNode')
            .mockReturnValue(mockUsers);
        const getClientSpy = jest.spyOn(stateService, 'getClient')
            .mockImplementation((userId) => {
                if (userId === 'user1') return mockSocket1;
                if (userId === 'user2') return mockSocket2;
                return null;
            });
        
        // Act - subscribe and then simulate a message
        await socketService.subscribeToNodeChat(nodeAddress);
        
        // Simulate Redis publishing a message
        const channel = `node:${nodeAddress}:chat`;
        const messageCallback = mockSubscriber.channels[channel];
        messageCallback(JSON.stringify(mockMessage));
        
        // Assert
        expect(getUsersInNodeSpy).toHaveBeenCalledWith(nodeAddress);
        expect(getClientSpy).toHaveBeenCalledWith('user1');
        expect(getClientSpy).toHaveBeenCalledWith('user2');
        expect(mockSocket1.emit).toHaveBeenCalledWith('chat message', mockMessage);
        expect(mockSocket2.emit).toHaveBeenCalledWith('chat message', mockMessage);
        
        // Cleanup
        getUsersInNodeSpy.mockRestore();
        getClientSpy.mockRestore();
    });
    
    it('should unsubscribe from channel when no users are in node', async () => {
        // Arrange
        const nodeAddress = 'test-node-123';
        const channel = `node:${nodeAddress}:chat`;
        
        // Mock getUsersInNode to return empty set
        const getUsersInNodeSpy = jest.spyOn(stateService, 'getUsersInNode')
            .mockReturnValue(new Set());
        
        // Subscribe first
        await socketService.subscribeToNodeChat(nodeAddress);
        expect(socketService.isSubscribed(nodeAddress)).toBe(true);
        
        // Act
        await socketService.unsubscribeFromNodeChat(nodeAddress);
        
        // Assert
        expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(channel);
        expect(socketService.isSubscribed(nodeAddress)).toBe(false);
        
        // Cleanup
        getUsersInNodeSpy.mockRestore();
    });
    
    it('should not unsubscribe when users are still in node', async () => {
        // Arrange
        const nodeAddress = 'test-node-123';
        
        // Mock getUsersInNode to return non-empty set
        const getUsersInNodeSpy = jest.spyOn(stateService, 'getUsersInNode')
            .mockReturnValue(new Set(['user1']));
        
        // Subscribe first
        await socketService.subscribeToNodeChat(nodeAddress);
        expect(socketService.isSubscribed(nodeAddress)).toBe(true);
        
        // Reset the mock to verify if unsubscribe is called
        mockSubscriber.unsubscribe.mockClear();
        
        // Act
        await socketService.unsubscribeFromNodeChat(nodeAddress);
        
        // Assert
        expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
        expect(socketService.isSubscribed(nodeAddress)).toBe(true);
        
        // Cleanup
        getUsersInNodeSpy.mockRestore();
    });
}); 