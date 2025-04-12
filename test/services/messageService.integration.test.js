const messageService = require('../../src/services/messageService');
const { MessageService } = require('../../src/services/messageService');
const stateService = require('../../src/services/stateService');

// Mock stateService methods
jest.mock('../../src/services/stateService', () => ({
    getClient: jest.fn()
}));

describe('MessageService Integration', () => {
    let mockSocket;

    beforeEach(() => {
        // Setup mock socket
        mockSocket = {
            connected: true,
            emit: jest.fn().mockReturnValue(true)
        };
        
        // Configure stateService mock
        stateService.getClient.mockReturnValue(mockSocket);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Singleton instance', () => {
        it('should export a singleton instance that works with existing code', () => {
            // Test that the export is an instance of MessageService
            expect(messageService).toBeInstanceOf(MessageService);
            
            // Test that the singleton instance works
            const userId = 'user123';
            const message = 'Test message';
            
            const result = messageService.sendSuccessMessage(userId, message);
            
            expect(stateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockSocket.emit).toHaveBeenCalledWith('console response', {
                type: 'success',
                message
            });
            expect(result).toBe(true);
        });
    });

    describe('Class constructor', () => {
        it('should allow creating a new instance with custom dependencies', () => {
            const mockCustomStateService = {
                getClient: jest.fn().mockReturnValue(mockSocket)
            };
            
            const mockCustomLogger = {
                error: jest.fn()
            };
            
            const customMessageService = new MessageService({
                stateService: mockCustomStateService,
                logger: mockCustomLogger
            });
            
            const userId = 'user123';
            const message = 'Test message';
            
            const result = customMessageService.sendErrorMessage(userId, message);
            
            expect(mockCustomStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockSocket.emit).toHaveBeenCalledWith('console response', {
                type: 'error',
                message
            });
            expect(result).toBe(true);
        });
    });

    describe('Compatibility with other services', () => {
        it('should work with the same interface as before refactoring', () => {
            // This test simulates how other services like combatService use messageService
            const userId = 'user123';
            
            // Test all message types to ensure compatibility
            messageService.sendCombatMessage(userId, 'Combat message', 'Combat hint');
            messageService.sendErrorMessage(userId, 'Error message');
            messageService.sendSuccessMessage(userId, 'Success message');
            messageService.sendInfoMessage(userId, 'Info message');
            messageService.sendMoveMessage(userId, 'Move message');
            messageService.sendQuestsMessage(userId, 'Quests message');
            messageService.sendListResponse(userId, 'List data');
            messageService.sendChatMessage(userId, 'Chat message');
            messageService.sendPlayerStatusMessage(userId, 'Status message');
            
            // Verify all calls happened with the correct types
            expect(mockSocket.emit).toHaveBeenCalledTimes(9);
            
            // For combat message, only verify the required fields
            const combatCall = mockSocket.emit.mock.calls[0][1];
            expect(combatCall.type).toBe('combat');
            expect(combatCall.message).toBe('Combat message');
            expect(combatCall.hint).toBe('Combat hint');
            
            // For other messages, verify exact structure since they're simpler
            expect(mockSocket.emit).toHaveBeenNthCalledWith(2, 'console response', {
                type: 'error',
                message: 'Error message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(3, 'console response', {
                type: 'success',
                message: 'Success message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(4, 'console response', {
                type: 'info',
                message: 'Info message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(5, 'console response', {
                type: 'move',
                message: 'Move message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(6, 'console response', {
                type: 'quests',
                message: 'Quests message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(7, 'console response', {
                type: 'list',
                message: 'List data'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(8, 'console response', {
                type: 'chat',
                message: 'Chat message'
            });
            expect(mockSocket.emit).toHaveBeenNthCalledWith(9, 'console response', {
                type: 'playerStatus',
                message: 'Status message'
            });
        });

        it('should handle hint parameter in sendCombatMessage correctly', () => {
            const userId = 'user123';
            const message = 'Combat message';
            const hint = 'Combat hint';
            
            const result = messageService.sendCombatMessage(userId, message, hint);
            
            expect(result).toBe(true);
            expect(stateService.getClient).toHaveBeenCalledWith(userId);
            
            // Only verify the required fields we care about
            const emittedData = mockSocket.emit.mock.calls[0][1];
            expect(emittedData.type).toBe('combat');
            expect(emittedData.message).toBe(message);
            expect(emittedData.hint).toBe(hint);
        });
    });
}); 