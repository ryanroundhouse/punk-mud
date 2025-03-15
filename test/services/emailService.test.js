const { EmailService } = require('../../src/services/emailService');

describe('EmailService', () => {
    // Mock dependencies
    let mockMailgun;
    let mockLogger;
    let mockConfig;
    let mockMessagesSend;
    let emailService;

    beforeEach(() => {
        // Create mock for messages().send()
        mockMessagesSend = jest.fn().mockResolvedValue({ id: 'message123' });
        
        // Create mock for mailgun
        mockMailgun = jest.fn().mockReturnValue({
            messages: jest.fn().mockReturnValue({
                send: mockMessagesSend
            })
        });
        
        // Create mock logger
        mockLogger = {
            error: jest.fn(),
            info: jest.fn(),
            debug: jest.fn()
        };
        
        // Create mock config
        mockConfig = {
            apiKey: 'test-api-key',
            domain: 'test-domain.com'
        };
        
        // Create service instance with mocked dependencies
        emailService = new EmailService({
            mailgun: mockMailgun,
            logger: mockLogger,
            config: mockConfig
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('validateConfig', () => {
        it('should return true when config is valid', () => {
            const result = emailService.validateConfig();
            expect(result).toBe(true);
        });

        it('should throw an error when apiKey is missing', () => {
            emailService.config.apiKey = null;
            
            expect(() => {
                emailService.validateConfig();
            }).toThrow('Email service not configured properly');
            
            expect(mockLogger.error).toHaveBeenCalledWith('Mailgun configuration missing');
        });

        it('should throw an error when domain is missing', () => {
            emailService.config.domain = null;
            
            expect(() => {
                emailService.validateConfig();
            }).toThrow('Email service not configured properly');
            
            expect(mockLogger.error).toHaveBeenCalledWith('Mailgun configuration missing');
        });
    });

    describe('createMailgunClient', () => {
        it('should create a mailgun client with correct config', () => {
            emailService.createMailgunClient();
            
            expect(mockMailgun).toHaveBeenCalledWith({
                apiKey: mockConfig.apiKey,
                domain: mockConfig.domain
            });
        });
    });

    describe('createMailOptions', () => {
        it('should create mail options with correct data', () => {
            const email = 'test@example.com';
            const code = '123456';
            
            const result = emailService.createMailOptions(email, code);
            
            expect(result).toEqual({
                from: `PUNK MUD <noreply@${mockConfig.domain}>`,
                to: email,
                subject: 'PUNK MUD Authentication Code',
                html: expect.stringContaining(code)
            });
        });
    });

    describe('sendAuthCode', () => {
        it('should send an email successfully', async () => {
            const email = 'test@example.com';
            const code = '123456';
            
            await emailService.sendAuthCode(email, code);
            
            expect(mockMailgun).toHaveBeenCalled();
            expect(mockMessagesSend).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Auth code email sent successfully:',
                { email }
            );
        });

        it('should throw an error when sending fails', async () => {
            const email = 'test@example.com';
            const code = '123456';
            const error = new Error('Sending failed');
            
            mockMessagesSend.mockRejectedValueOnce(error);
            
            await expect(emailService.sendAuthCode(email, code)).rejects.toThrow('Failed to send email');
            
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to send auth code email:',
                { email, error }
            );
        });
    });
}); 