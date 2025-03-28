const { login, authenticate } = require('../../src/controllers/authController');
const User = require('../../src/models/User');
const { EmailService } = require('../../src/services/emailService');
const logger = require('../../src/config/logger');

// Mock dependencies
jest.mock('../../src/models/User');
jest.mock('../../src/config/logger');

// Mock mailgun-js
jest.mock('mailgun-js', () => {
    const mockMessagesSend = jest.fn().mockResolvedValue({ id: 'message123' });
    return jest.fn().mockReturnValue({
        messages: jest.fn().mockReturnValue({
            send: mockMessagesSend
        })
    });
});

describe('AuthController', () => {
    let mockReq;
    let mockRes;
    let mockJson;
    let mockStatus;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup mock response
        mockJson = jest.fn();
        mockStatus = jest.fn().mockReturnValue({ json: mockJson });
        mockRes = {
            status: mockStatus,
            json: mockJson
        };

        // Setup mock request
        mockReq = {
            body: {}
        };

        // Mock User.findOneAndUpdate
        User.findOneAndUpdate.mockResolvedValue({
            email: 'test@example.com',
            authCode: { code: '12345', expiresAt: new Date() }
        });
    });

    describe('login', () => {
        it('should accept valid email addresses', async () => {
            mockReq.body.email = 'test@example.com';
            
            await login(mockReq, mockRes);

            expect(mockStatus).not.toHaveBeenCalled();
            expect(User.findOneAndUpdate).toHaveBeenCalled();
            expect(mockJson).toHaveBeenCalledWith({ message: 'Authentication code sent' });
        });

        it('should create new user with default move', async () => {
            mockReq.body.email = 'newuser@example.com';
            
            await login(mockReq, mockRes);

            expect(User.findOneAndUpdate).toHaveBeenCalledWith(
                { email: 'newuser@example.com' },
                expect.objectContaining({
                    email: 'newuser@example.com',
                    moves: ['67e5ee92505d5890de625149']  // Default move ID
                }),
                { upsert: true }
            );
        });

        describe('invalid email addresses', () => {
            const invalidEmails = [
                'notanemail',
                'missing@domain',
                'missingdomain@',
                '@missinglocal',
                'missing@.com',
                'test@domain.',
                'test@.domain.com'
            ];

            invalidEmails.forEach(email => {
                it(`should reject invalid email: ${email}`, async () => {
                    mockReq.body.email = email;
                    
                    await login(mockReq, mockRes);

                    expect(mockStatus).toHaveBeenCalledWith(400);
                    expect(mockJson).toHaveBeenCalledWith({ error: 'Invalid email format' });
                    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
                });
            });
        });

        it('should handle email service errors', async () => {
            mockReq.body.email = 'test@example.com';
            const mockMailgun = require('mailgun-js');
            const mockMessagesSend = mockMailgun().messages().send;
            mockMessagesSend.mockRejectedValueOnce(new Error('Email service error'));
            
            await login(mockReq, mockRes);

            expect(mockStatus).toHaveBeenCalledWith(500);
            expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to process login' });
            expect(logger.error).toHaveBeenCalled();
        });
    });
}); 