const mailgun = require('mailgun-js');
const logger = require('../config/logger');

async function sendAuthCode(email, code) {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
        logger.error('Mailgun configuration missing');
        throw new Error('Email service not configured properly');
    }

    const mg = mailgun({
        apiKey: process.env.MAILGUN_API_KEY,
        domain: process.env.MAILGUN_DOMAIN
    });

    const mailOptions = {
        from: `PUNK MUD <noreply@${process.env.MAILGUN_DOMAIN}>`,
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

    try {
        await mg.messages().send(mailOptions);
        logger.info('Auth code email sent successfully:', { email });
    } catch (error) {
        logger.error('Failed to send auth code email:', { email, error });
        throw new Error('Failed to send email');
    }
}

module.exports = {
    sendAuthCode
}; 