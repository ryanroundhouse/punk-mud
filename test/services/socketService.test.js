const { SocketService } = require('../../src/services/socketService');

describe('SocketService', () => {
    // Mock dependencies
    let mockGetSubscriber;
    let mockSubscriber;
    let mockLogger;
    let mockStateService;
    let socketService;
    
    beforeEach(() => {
        // Create mock subscriber with subscribe/unsubscribe methods
        mockSubscriber = {
            subscribe: jest.fn().mockResolvedValue(undefined),
            unsubscribe: jest.fn().mockResolvedValue(undefined)
        };
        
        // Create mock getSubscriber function
        mockGetSubscriber = jest.fn().mockReturnValue(mockSubscriber);
        
        // Create mock logger
        mockLogger = {
            error: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        };
        
        // Create mock stateService
        mockStateService = {
            getUsersInNode: jest.fn(),
            getClient: jest.fn()
        };
        
        // Create service instance with mocked dependencies
        socketService = new SocketService({
            getSubscriber: mockGetSubscriber,
            logger: mockLogger,
            stateService: mockStateService
        });
    });
    
    afterEach(() => {
        jest.clearAllMocks();
    });
    
    describe('subscribeToNodeChat', () => {
        it('should subscribe to the node chat channel if not already subscribed', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            
            // Act
            await socketService.subscribeToNodeChat(nodeAddress);
            
            // Assert
            expect(mockGetSubscriber).toHaveBeenCalledTimes(1);
            expect(mockSubscriber.subscribe).toHaveBeenCalledWith(channel, expect.any(Function));
            expect(socketService.subscribedNodes.has(channel)).toBeTruthy();
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(nodeAddress));
        });
        
        it('should not subscribe if already subscribed', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            socketService.subscribedNodes.add(channel); // Already subscribed
            
            // Act
            await socketService.subscribeToNodeChat(nodeAddress);
            
            // Assert
            expect(mockGetSubscriber).not.toHaveBeenCalled();
            expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
        });
        
        it('should handle message delivery correctly', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const userId1 = 'user1';
            const userId2 = 'user2';
            const mockSocket1 = { emit: jest.fn() };
            const mockSocket2 = { emit: jest.fn() };
            const mockNodeUsers = new Set([userId1, userId2]);
            const mockChatMessage = { from: 'user1', content: 'Hello', timestamp: Date.now() };
            
            mockStateService.getUsersInNode.mockReturnValue(mockNodeUsers);
            mockStateService.getClient.mockImplementation((userId) => {
                if (userId === userId1) return mockSocket1;
                if (userId === userId2) return mockSocket2;
                return null;
            });
            
            // Capture the callback function when subscribe is called
            let subscribeCb;
            mockSubscriber.subscribe.mockImplementation((channel, callback) => {
                subscribeCb = callback;
                return Promise.resolve();
            });
            
            // Act - Subscribe and then trigger the message callback
            await socketService.subscribeToNodeChat(nodeAddress);
            subscribeCb(JSON.stringify(mockChatMessage)); // Simulate receiving a message
            
            // Assert
            expect(mockStateService.getUsersInNode).toHaveBeenCalledWith(nodeAddress);
            expect(mockStateService.getClient).toHaveBeenCalledWith(userId1);
            expect(mockStateService.getClient).toHaveBeenCalledWith(userId2);
            expect(mockSocket1.emit).toHaveBeenCalledWith('chat message', mockChatMessage);
            expect(mockSocket2.emit).toHaveBeenCalledWith('chat message', mockChatMessage);
        });
        
        it('should handle JSON parse error', async () => {
            // Arrange
            const nodeAddress = 'node123';
            
            // Capture the callback function when subscribe is called
            let subscribeCb;
            mockSubscriber.subscribe.mockImplementation((channel, callback) => {
                subscribeCb = callback;
                return Promise.resolve();
            });
            
            // Act - Subscribe and then trigger the message callback with invalid JSON
            await socketService.subscribeToNodeChat(nodeAddress);
            subscribeCb('invalid json data');
            
            // Assert
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error broadcasting chat message:',
                expect.any(Error)
            );
        });
    });
    
    describe('unsubscribeFromNodeChat', () => {
        it('should unsubscribe when no users are in the node', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            socketService.subscribedNodes.add(channel); // Add to subscribed set
            mockStateService.getUsersInNode.mockReturnValue(null);
            
            // Act
            await socketService.unsubscribeFromNodeChat(nodeAddress);
            
            // Assert
            expect(mockGetSubscriber).toHaveBeenCalledTimes(1);
            expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(channel);
            expect(socketService.subscribedNodes.has(channel)).toBeFalsy();
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(nodeAddress));
        });
        
        it('should unsubscribe when node users set is empty', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            socketService.subscribedNodes.add(channel); // Add to subscribed set
            mockStateService.getUsersInNode.mockReturnValue(new Set()); // Empty set
            
            // Act
            await socketService.unsubscribeFromNodeChat(nodeAddress);
            
            // Assert
            expect(mockGetSubscriber).toHaveBeenCalledTimes(1);
            expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith(channel);
            expect(socketService.subscribedNodes.has(channel)).toBeFalsy();
        });
        
        it('should not unsubscribe when there are users in the node', async () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            socketService.subscribedNodes.add(channel); // Add to subscribed set
            mockStateService.getUsersInNode.mockReturnValue(new Set(['user1'])); // Non-empty set
            
            // Act
            await socketService.unsubscribeFromNodeChat(nodeAddress);
            
            // Assert
            expect(mockGetSubscriber).not.toHaveBeenCalled();
            expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
            expect(socketService.subscribedNodes.has(channel)).toBeTruthy();
        });
    });
    
    describe('isSubscribed', () => {
        it('should return true when subscribed to node channel', () => {
            // Arrange
            const nodeAddress = 'node123';
            const channel = `node:${nodeAddress}:chat`;
            socketService.subscribedNodes.add(channel);
            
            // Act
            const result = socketService.isSubscribed(nodeAddress);
            
            // Assert
            expect(result).toBeTruthy();
        });
        
        it('should return false when not subscribed to node channel', () => {
            // Arrange
            const nodeAddress = 'node123';
            
            // Act
            const result = socketService.isSubscribed(nodeAddress);
            
            // Assert
            expect(result).toBeFalsy();
        });
    });
}); 