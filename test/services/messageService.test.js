const { MessageService } = require('../../src/services/messageService');

describe('MessageService', () => {
    let messageService;
    let mockLogger;
    let mockStateService;
    let mockSocket;

    beforeEach(() => {
        // Setup mocks
        mockSocket = {
            connected: true,
            emit: jest.fn().mockReturnValue(true)
        };

        mockStateService = {
            getClient: jest.fn().mockReturnValue(mockSocket)
        };

        mockLogger = {
            error: jest.fn()
        };

        // Create MessageService with mocked dependencies
        messageService = new MessageService({
            logger: mockLogger,
            stateService: mockStateService
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('sendConsoleResponse', () => {
        it('should emit a console response event when socket is valid', () => {
            const userId = 'user123';
            const message = 'Test message';
            const type = 'test';

            const result = messageService.sendConsoleResponse(userId, message, type);

            expect(mockStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockSocket.emit).toHaveBeenCalledWith('console response', {
                type,
                message
            });
            expect(result).toBe(true);
        });

        it('should return false when socket is not found', () => {
            const userId = 'user123';
            const message = 'Test message';
            const type = 'test';

            mockStateService.getClient.mockReturnValueOnce(null);

            const result = messageService.sendConsoleResponse(userId, message, type);

            expect(mockStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'No valid socket found for message:',
                { userId, type, message }
            );
            expect(result).toBe(false);
        });

        it('should return false when socket is disconnected', () => {
            const userId = 'user123';
            const message = 'Test message';
            const type = 'test';

            mockSocket.connected = false;

            const result = messageService.sendConsoleResponse(userId, message, type);

            expect(mockStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'No valid socket found for message:',
                { userId, type, message }
            );
            expect(result).toBe(false);
        });

        it('should handle errors and return false', () => {
            const userId = 'user123';
            const message = 'Test message';
            const type = 'test';
            const error = new Error('Test error');

            mockStateService.getClient.mockImplementationOnce(() => {
                throw error;
            });

            const result = messageService.sendConsoleResponse(userId, message, type);

            expect(mockStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockLogger.error).toHaveBeenCalledWith('Error sending console response:', error);
            expect(result).toBe(false);
        });
    });

    describe('message type functions', () => {
        const userId = 'user123';
        const message = 'Test message';

        beforeEach(() => {
            // Spy on sendConsoleResponse and directly on socket.emit
            jest.spyOn(messageService, 'sendConsoleResponse');
            jest.spyOn(mockSocket, 'emit');
        });

        it('should call sendConsoleResponse with combat type', () => {
            messageService.sendCombatMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'combat');
        });

        it('should call sendConsoleResponse with error type', () => {
            messageService.sendErrorMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'error');
        });

        it('should call sendConsoleResponse with success type', () => {
            messageService.sendSuccessMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'success');
        });

        it('should call sendConsoleResponse with info type', () => {
            messageService.sendInfoMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'info');
        });

        it('should call sendConsoleResponse with move type', () => {
            messageService.sendMoveMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'move');
        });

        it('should call sendConsoleResponse with quests type', () => {
            messageService.sendQuestsMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'quests');
        });

        it('should call sendConsoleResponse with list type', () => {
            messageService.sendListResponse(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'list');
        });

        it('should call sendConsoleResponse with chat type', () => {
            messageService.sendChatMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'chat');
        });

        it('should call sendConsoleResponse with playerStatus type', () => {
            messageService.sendPlayerStatusMessage(userId, message);
            expect(messageService.sendConsoleResponse).toHaveBeenCalledWith(userId, message, 'playerStatus');
        });
    });

    describe('sendCombatMessage with hint', () => {
        it('should support hint parameter', () => {
            const userId = 'user123';
            const message = 'Test message';
            const hint = 'Test hint';

            // The implementation bypasses sendConsoleResponse when hint is provided
            // So we should spy on the socket.emit method instead
            messageService.sendCombatMessage(userId, message, hint);

            expect(mockStateService.getClient).toHaveBeenCalledWith(userId);
            expect(mockSocket.emit).toHaveBeenCalledWith('console response', {
                type: 'combat',
                message,
                hint
            });
        });
    });
}); 