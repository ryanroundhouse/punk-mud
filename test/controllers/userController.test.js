const mongoose = require('mongoose');
const { getAllUsers, getUserById, calculateExpProgress } = require('../../src/controllers/userController');

// Mock models and dependencies
jest.mock('../../src/models/User', () => ({
    find: jest.fn(),
    findById: jest.fn()
}));

const User = require('../../src/models/User');
const logger = require('../../src/config/logger');

// Mock logger
jest.mock('../../src/config/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
}));

describe('User Controller', () => {
    let req, res, statusStub, jsonStub;

    beforeEach(() => {
        // Setup request and response objects
        req = {
            user: { isBuilder: true },
            params: {}
        };
        
        jsonStub = jest.fn();
        statusStub = jest.fn().mockReturnValue({ json: jsonStub });
        res = {
            json: jsonStub,
            status: statusStub
        };
        
        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('calculateExpProgress', () => {
        it('should correctly calculate exp progress for level 1', () => {
            const result = calculateExpProgress(50, 1);
            expect(result).toEqual({
                current: 50,
                required: 100,
                percentage: 50
            });
        });

        it('should correctly calculate exp progress for higher levels', () => {
            const result = calculateExpProgress(150, 2);
            expect(result).toEqual({
                current: 50, // 150 - 100 (level 1 threshold)
                required: 141, // 241 (level 3 threshold) - 100 (level 2 threshold)
                percentage: 35 // Math.floor((50/141) * 100)
            });
        });

        it('should return 100% progress when level is beyond thresholds', () => {
            const result = calculateExpProgress(10000, 12);
            expect(result).toEqual({
                current: 0,
                required: 0,
                percentage: 100
            });
        });
    });

    describe('getAllUsers', () => {
        it('should return 403 if user is not a builder', async () => {
            req.user.isBuilder = false;
            
            await getAllUsers(req, res);
            
            expect(statusStub).toHaveBeenCalledWith(403);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'Access denied. Admin privileges required.' });
        });

        it('should return users when successful', async () => {
            const mockUsers = [
                { _id: 'user1', email: 'user1@example.com', avatarName: 'User1', stats: { level: 1 } },
                { _id: 'user2', email: 'user2@example.com', avatarName: 'User2', stats: { level: 2 } }
            ];
            
            const mockSelectFn = jest.fn().mockReturnThis();
            const mockSortFn = jest.fn().mockResolvedValue(mockUsers);
            
            User.find.mockReturnValue({
                select: mockSelectFn,
                sort: mockSortFn
            });
            
            await getAllUsers(req, res);
            
            expect(User.find).toHaveBeenCalledWith({});
            expect(mockSelectFn).toHaveBeenCalledWith('_id email avatarName stats.level');
            expect(mockSortFn).toHaveBeenCalledWith({ createdAt: -1 });
            expect(jsonStub).toHaveBeenCalledWith(mockUsers);
        });

        it('should handle errors properly', async () => {
            const error = new Error('Database error');
            User.find.mockImplementation(() => {
                throw error;
            });
            
            await getAllUsers(req, res);
            
            expect(logger.error).toHaveBeenCalledWith('Error fetching users:', error);
            expect(statusStub).toHaveBeenCalledWith(500);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'Error fetching users' });
        });
    });

    describe('getUserById', () => {
        it('should return 403 if user is not a builder', async () => {
            req.user.isBuilder = false;
            
            await getUserById(req, res);
            
            expect(statusStub).toHaveBeenCalledWith(403);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'Access denied. Admin privileges required.' });
        });

        it('should return 404 if user not found', async () => {
            req.params.userId = 'nonexistentid';
            
            const mockPopulateFn1 = jest.fn().mockReturnThis();
            const mockPopulateFn2 = jest.fn().mockResolvedValue(null);
            
            User.findById.mockReturnValue({
                populate: mockPopulateFn1
            });
            
            mockPopulateFn1.mockReturnValue({
                populate: mockPopulateFn2
            });
            
            await getUserById(req, res);
            
            expect(statusStub).toHaveBeenCalledWith(404);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'User not found' });
        });

        it('should return formatted user when successful', async () => {
            req.params.userId = 'userid123';
            
            const mockUser = {
                _id: 'userid123',
                email: 'user@example.com',
                avatarName: 'TestUser',
                description: 'Test description',
                image: 'image.jpg',
                currentNode: '122.124.10.10',
                isBuilder: false,
                stats: {
                    level: 3,
                    hitpoints: 30,
                    currentHitpoints: 25,
                    energy: 40,
                    currentEnergy: 35,
                    armor: 5,
                    body: 7,
                    reflexes: 6,
                    agility: 6,
                    charisma: 5,
                    tech: 8,
                    luck: 4,
                    experience: 400
                },
                class: { name: 'Netrunner' },
                moves: [{ name: 'Hack', description: 'Hack a system' }],
                quests: [],
                activeEffects: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            // Calculate expected expProgress
            const expProgress = calculateExpProgress(mockUser.stats.experience, mockUser.stats.level);
            
            const mockPopulateFn1 = jest.fn().mockReturnThis();
            const mockPopulateFn2 = jest.fn().mockResolvedValue(mockUser);
            
            User.findById.mockReturnValue({
                populate: mockPopulateFn1
            });
            
            mockPopulateFn1.mockReturnValue({
                populate: mockPopulateFn2
            });
            
            await getUserById(req, res);
            
            expect(User.findById).toHaveBeenCalledWith('userid123');
            
            // Verify the formatted response
            const expectedResponse = {
                _id: mockUser._id,
                email: mockUser.email,
                avatarName: mockUser.avatarName,
                description: mockUser.description,
                image: mockUser.image,
                currentNode: mockUser.currentNode,
                isBuilder: mockUser.isBuilder,
                stats: {
                    level: mockUser.stats.level,
                    hitpoints: mockUser.stats.hitpoints,
                    maxHealth: mockUser.stats.hitpoints,
                    health: mockUser.stats.currentHitpoints,
                    armor: mockUser.stats.armor,
                    body: mockUser.stats.body,
                    reflexes: mockUser.stats.reflexes,
                    agility: mockUser.stats.agility,
                    charisma: mockUser.stats.charisma,
                    tech: mockUser.stats.tech,
                    luck: mockUser.stats.luck,
                    experience: mockUser.stats.experience,
                    energy: mockUser.stats.currentEnergy,
                    maxEnergy: mockUser.stats.energy
                },
                class: mockUser.class,
                moves: mockUser.moves,
                expProgress,
                quests: mockUser.quests,
                activeEffects: mockUser.activeEffects,
                createdAt: mockUser.createdAt,
                updatedAt: mockUser.updatedAt
            };
            
            expect(jsonStub).toHaveBeenCalledTimes(1);
            const responseArg = jsonStub.mock.calls[0][0];
            expect(responseArg).toEqual(expectedResponse);
        });

        it('should handle errors properly', async () => {
            req.params.userId = 'userid123';
            
            const error = new Error('Database error');
            User.findById.mockImplementation(() => {
                throw error;
            });
            
            await getUserById(req, res);
            
            expect(logger.error).toHaveBeenCalledWith('Error fetching user by ID:', error);
            expect(statusStub).toHaveBeenCalledWith(500);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'Error fetching user details' });
        });
    });
}); 