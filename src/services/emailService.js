const mailgun = require('mailgun-js');
const logger = require('../config/logger');

class EmailService {
    constructor(dependencies = {}) {
        this.mailgun = dependencies.mailgun || mailgun;
        this.logger = dependencies.logger || logger;
        this.config = dependencies.config || {
            apiKey: process.env.MAILGUN_API_KEY,
            domain: process.env.MAILGUN_DOMAIN
        };
    }

    validateConfig() {
        if (!this.config.apiKey || !this.config.domain) {
            this.logger.error('Mailgun configuration missing');
            throw new Error('Email service not configured properly');
        }
        return true;
    }

    createMailgunClient() {
        return this.mailgun({
            apiKey: this.config.apiKey,
            domain: this.config.domain
        });
    }

    createMailOptions(email, code) {
        return {
            from: `PUNK MUD <noreply@${this.config.domain}>`,
            to: email,
            subject: 'PUNK MUD Authentication Code',
            html: `
                <div style="font-family: 'Courier New', monospace; color: #00fff9; background-color: #0a0a0f; padding: 20px; border-radius: 10px;">
                    <h1 style="color: #ff2e88;">PUNK MUD</h1>
                    <p>Your authentication code is:</p>
                    <h2 style="color: #ff2e88; letter-spacing: 5px;">${code}</h2>
                    <p>This code will expire in 10 minutes.</p>
                    <p>If you didn't request this code, please ignore this email.</p>
                </div>
            `
        };
    }

    async sendAuthCode(email, code) {
        this.validateConfig();
        
        const mg = this.createMailgunClient();
        const mailOptions = this.createMailOptions(email, code);

        try {
            await mg.messages().send(mailOptions);
            this.logger.info('Auth code email sent successfully:', { email });
        } catch (error) {
            this.logger.error('Failed to send auth code email:', { email, error });
            throw new Error('Failed to send email');
        }
    }
}

// Create and export a singleton instance for direct use
const emailService = new EmailService();

module.exports = {
    EmailService,
    emailService
}; 