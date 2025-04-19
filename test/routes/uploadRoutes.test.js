const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock User model
jest.mock('../../src/models/User', () => {
    // Create mock functions for method chaining
    const mockSelect = jest.fn();
    const mockLean = jest.fn();
    const mockFindById = jest.fn();
    
    // Setup the method chain: findById returns object with select, select returns object with lean
    mockFindById.mockImplementation(() => ({ select: mockSelect }));
    mockSelect.mockImplementation(() => ({ lean: mockLean }));
    
    return {
        findById: mockFindById,
        findByIdAndUpdate: jest.fn(),
        __esModule: true,
        // Store mock implementations for tests to configure
        _mocks: {
            findById: mockFindById,
            select: mockSelect,
            lean: mockLean
        }
    };
});

// Mock Auth middleware
jest.mock('../../src/middlewares/auth', () => ({
    authenticateToken: (req, res, next) => {
        req.user = { userId: 'testUserId' };
        next();
    },
    verifyBuilderAccess: (req, res, next) => next()
}));

// Mock Upload Service - Use strings instead of path.join
jest.mock('../../src/services/uploadService', () => ({
    createUploadMiddleware: jest.fn(() => ({
        single: jest.fn(() => (req, res, next) => {
            // Use string concatenation instead of path.join
            req.file = {
                filename: 'new_image.png',
                path: '/workspace/public/assets/characters/new_image.png' // Hardcoded mock path
            };
            next();
        })
    }))
}));

// Mock Logger
jest.mock('../../src/config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
    promises: {
        unlink: jest.fn().mockResolvedValue(undefined)
    }
}));

// Define mockUser
const mockUser = {
    _id: 'testUserId',
    image: '/assets/characters/old_image.png'
};

const userWithoutImage = {
    _id: 'testUserId',
    image: null
};

// Create an Express app factory to get a fresh app for each test
function createApp() {
    const app = express();
    app.use(express.json());
    // Import routes fresh each time to ensure it uses the current mocks
    const routes = require('../../src/routes/uploadRoutes');
    app.use('/api/upload', routes);
    return app;
}

// --- Tests --- 
describe('POST /api/upload/character', () => {
    let User;
    let fs;
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules(); // Reset module cache
        
        User = require('../../src/models/User');
        fs = require('fs');
        
        // Configure the mock chain response
        User._mocks.lean.mockResolvedValue(mockUser);
        User.findByIdAndUpdate.mockResolvedValue(null);
        fs.promises.unlink.mockResolvedValue(undefined);
        
        // Reset upload middleware mock - safe to use path here as it's not in jest.mock
        require('../../src/services/uploadService').createUploadMiddleware.mockImplementation(() => ({
            single: jest.fn(() => (req, res, next) => {
                req.file = {
                    filename: 'new_image.png',
                    path: path.join(process.cwd(), 'public/assets/characters/new_image.png')
                };
                next();
            })
        }));
        
        // Create a fresh app for each test
        app = createApp();
    });

    it('should upload new image, update DB, delete old image, and return new path', async () => {
        const expectedNewPath = '/assets/characters/new_image.png';
        const expectedOldFilePath = path.resolve(process.cwd(), 'public', 'assets/characters/old_image.png'.replace(/^\//, ''));

        const response = await request(app)
            .post('/api/upload/character')
            .expect(200);

        expect(response.body).toEqual({ path: expectedNewPath });
        expect(User.findById).toHaveBeenCalledWith('testUserId');
        expect(User._mocks.select).toHaveBeenCalledWith('image');
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith('testUserId', { image: expectedNewPath });
        expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
        expect(fs.promises.unlink).toHaveBeenCalledWith(expectedOldFilePath);
    });

    it('should handle user having no previous image', async () => {
        // Configure specific mock response for this test
        User._mocks.lean.mockResolvedValue(userWithoutImage);
        
        const expectedNewPath = '/assets/characters/new_image.png';

        const response = await request(app)
            .post('/api/upload/character')
            .expect(200);

        expect(response.body).toEqual({ path: expectedNewPath });
        expect(User.findById).toHaveBeenCalledWith('testUserId');
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith('testUserId', { image: expectedNewPath });
        expect(fs.promises.unlink).not.toHaveBeenCalled();
    });

    it('should handle DB update error and attempt to clean up new file', async () => {
        const dbError = new Error('Database unavailable');
        User.findByIdAndUpdate.mockRejectedValue(dbError);
        
        // Match the path used in the route handler
        const newFilePathAbsolute = path.join(process.cwd(), 'public/assets/characters/new_image.png');

        const response = await request(app)
            .post('/api/upload/character')
            .expect(500);

        expect(response.body.error).toContain('Server error');
        expect(User.findByIdAndUpdate).toHaveBeenCalled();
        expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
        expect(fs.promises.unlink).toHaveBeenCalledWith(newFilePathAbsolute);
    });

    it('should handle old file deletion error gracefully', async () => {
        const unlinkError = new Error('Permission denied');
        unlinkError.code = 'EPERM';
        fs.promises.unlink.mockRejectedValue(unlinkError);
        
        const expectedNewPath = '/assets/characters/new_image.png';
        const expectedOldFilePath = path.resolve(process.cwd(), 'public', 'assets/characters/old_image.png'.replace(/^\//, ''));

        const response = await request(app)
            .post('/api/upload/character')
            .expect(200);
        
        expect(response.body).toEqual({ path: expectedNewPath });
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith('testUserId', { image: expectedNewPath });
        expect(fs.promises.unlink).toHaveBeenCalledWith(expectedOldFilePath);
        expect(require('../../src/config/logger').error).toHaveBeenCalledWith(expect.stringContaining('Error deleting old image file'), unlinkError);
    });
}); 