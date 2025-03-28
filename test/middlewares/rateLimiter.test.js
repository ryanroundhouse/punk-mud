const { rateLimiterMiddleware, rateLimiter } = require('../../src/middlewares/rateLimiter');

describe('RateLimiter Middleware', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.useFakeTimers();
        mockReq = {
            ip: '127.0.0.1',
            connection: {
                remoteAddress: '127.0.0.1'
            }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            resetRateLimit: jest.fn()
        };
        mockNext = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
        rateLimiter.clear();
    });

    it('should allow requests within rate limit', () => {
        // Make 4 requests (under the limit of 5)
        for (let i = 0; i < 4; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(4);
    });

    it('should block requests exceeding rate limit', () => {
        // Make 6 requests (over the limit of 5)
        for (let i = 0; i < 6; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        expect(mockRes.status).toHaveBeenCalledWith(429);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: 'Too many attempts. Please try again later.',
            retryAfter: expect.any(Number)
        });
        expect(mockNext).toHaveBeenCalledTimes(5);
    });

    it('should reset rate limit after window expires', () => {
        // Make 3 requests
        for (let i = 0; i < 3; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        // Fast forward time by 16 minutes (past the 15-minute window)
        jest.advanceTimersByTime(16 * 60 * 1000);

        // Make another request
        rateLimiterMiddleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(4);
    });

    it('should reset rate limit when resetRateLimit is called', () => {
        // Make 3 requests
        for (let i = 0; i < 3; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        // Reset the rate limit
        mockRes.resetRateLimit();

        // Make 5 more requests
        for (let i = 0; i < 5; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(8);
    });

    it('should handle requests from different IPs independently', () => {
        // Make 4 requests from first IP
        for (let i = 0; i < 4; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        // Make 4 requests from second IP
        mockReq.ip = '127.0.0.2';
        mockReq.connection.remoteAddress = '127.0.0.2';
        for (let i = 0; i < 4; i++) {
            rateLimiterMiddleware(mockReq, mockRes, mockNext);
        }

        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(8);
    });
}); 