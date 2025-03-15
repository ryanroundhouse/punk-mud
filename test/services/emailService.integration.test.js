const { EmailService } = require('../../src/services/emailService');
const logger = require('../../src/config/logger');

// These tests will be skipped by default since they require actual API keys
// To run them, you need to set up environment variables and remove the .skip
describe.skip('EmailService Integration', () => {
    let emailService;
    
    beforeAll(() => {
        // For integration tests, we use the actual dependencies
        // but we can still override the config if needed
        emailService = new EmailService({
            logger: logger
            // Using actual mailgun and process.env config
        });
    });
    
    describe('sendAuthCode', () => {
        it('should send an actual email', async () => {
            // This test will only run if MAILGUN_API_KEY and MAILGUN_DOMAIN are set
            // and if the test is not skipped
            if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
                console.warn('Skipping email integration test - missing Mailgun config');
                return;
            }
            
            const testEmail = process.env.TEST_EMAIL || 'test@example.com';
            const testCode = '123456';
            
            // This will actually send an email if run
            await expect(emailService.sendAuthCode(testEmail, testCode))
                .resolves.not.toThrow();
                
            // We can't easily verify the email was received, but we can verify
            // it doesn't throw an error when properly configured
        }, 10000); // Increase timeout for API call
        
        it('should throw an error with invalid config', async () => {
            // Create a service with invalid config
            const invalidService = new EmailService({
                logger: logger,
                config: {
                    apiKey: 'invalid-key',
                    domain: 'invalid-domain.com'
                }
            });
            
            const testEmail = 'test@example.com';
            const testCode = '123456';
            
            // Should throw an error when trying to send
            await expect(invalidService.sendAuthCode(testEmail, testCode))
                .rejects.toThrow('Failed to send email');
        });
    });
}); 