const mongoose = require('mongoose');
const { ActorService } = require('../../src/services/actorService');
const Actor = require('../../src/models/Actor');
const User = require('../../src/models/User');
const logger = require('../../src/config/logger');

// Mock dependencies
jest.mock('../../src/models/Actor');
jest.mock('../../src/models/User');
jest.mock('../../src/config/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
}));

// Helper to create mock documents with Mongoose-like behaviors
const createMockDocument = (data) => {
    return {
        ...data,
        _id: data._id || new mongoose.Types.ObjectId().toString(),
        toObject: () => ({ ...data }),
        toString: () => data._id?.toString() || new mongoose.Types.ObjectId().toString()
    };
};

describe('ActorService Integration Tests', () => {
    let actorService;
    let testActors = [];
    let testUser;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Setup mock data
        testActors = [
            createMockDocument({
                _id: 'actor1',
                name: 'Test Actor 1',
                description: 'First test actor',
                location: 'location123',
                chatMessages: [
                    { message: 'Hello 1', order: 2 },
                    { message: 'Hello 3', order: 3 },
                    { message: 'Hello 2', order: 1 }
                ]
            }),
            createMockDocument({
                _id: 'actor2',
                name: 'Test Actor 2',
                description: 'Second test actor',
                location: 'location123',
                chatMessages: [
                    { message: 'Message 1', order: 1 },
                    { message: 'Message 2', order: 2 }
                ]
            }),
            createMockDocument({
                _id: 'actor3',
                name: 'Test Actor 3',
                description: 'Third test actor',
                location: 'location456',
                chatMessages: [
                    { message: 'Dialogue 1', order: 1 }
                ]
            })
        ];
        
        testUser = createMockDocument({
            _id: 'user123',
            email: 'test@example.com',
            avatarName: 'TestUser',
            currentNode: 'location123',
            quests: []
        });
        
        // Mock Actor.find to return our test actors
        Actor.find.mockImplementation((query) => {
            if (query && query.location) {
                return Promise.resolve(testActors.filter(actor => actor.location === query.location));
            } else if (query && query._id && query._id.$in) {
                return Promise.resolve(testActors.filter(actor => query._id.$in.includes(actor._id)));
            }
            return Promise.resolve(testActors);
        });
        
        // Mock Actor.findById to return a specific actor
        Actor.findById.mockImplementation((id) => {
            const actor = testActors.find(a => a._id === id);
            return Promise.resolve(actor || null);
        });
        
        // Mock User.findById to return our test user
        User.findById.mockImplementation((id) => {
            if (id === 'user123') {
                return Promise.resolve(testUser);
            }
            return Promise.resolve(null);
        });
        
        // Create service instance with default dependencies
        actorService = new ActorService();
        
        // Mock the questService methods
        actorService.questService.getQuestNodeActorOverrides = jest.fn().mockImplementation((userId, locationId) => {
            if (userId === 'user123' && locationId === 'location123') {
                return Promise.resolve([]);
            } else if (userId === 'user123' && locationId === 'location456') {
                return Promise.resolve(['actor1']);
            }
            return Promise.resolve([]);
        });
        
        actorService.questService.handleQuestProgression = jest.fn().mockResolvedValue({
            success: true,
            updates: ['quest1']
        });
    });

    describe('findActorInLocation', () => {
        it('should find an actor by name in a location', async () => {
            // Execute
            const result = await actorService.findActorInLocation('Test Actor 1', 'location123');
            
            // Verify
            expect(result).toBeDefined();
            expect(result.name).toBe('Test Actor 1');
            expect(result.description).toBe('First test actor');
        });

        it('should return undefined if no actor with the name is found', async () => {
            // Execute
            const result = await actorService.findActorInLocation('Non-existent Actor', 'location123');
            
            // Verify
            expect(result).toBeUndefined();
        });

        it('should be case insensitive when matching actor names', async () => {
            // Execute
            const result = await actorService.findActorInLocation('TEST aCTOR 1', 'location123');
            
            // Verify
            expect(result).toBeDefined();
            expect(result.name).toBe('Test Actor 1');
        });
    });

    describe('getActorsInLocation', () => {
        it('should return actors in a location', async () => {
            // Execute
            const result = await actorService.getActorsInLocation('location123');
            
            // Verify
            expect(result).toHaveLength(2);
            const actorNames = result.map(a => a.name);
            expect(actorNames).toContain('Test Actor 1');
            expect(actorNames).toContain('Test Actor 2');
        });

        it('should return an empty array for a location with no actors', async () => {
            // Execute
            const result = await actorService.getActorsInLocation('emptyLocation');
            
            // Verify
            expect(result).toHaveLength(0);
            expect(result).toEqual([]);
        });
        
        it('should check for quest actor overrides when userId is provided', async () => {
            // Execute
            await actorService.getActorsInLocation('location123', 'user123');
            
            // Verify
            expect(actorService.questService.getQuestNodeActorOverrides).toHaveBeenCalledWith('user123', 'location123');
        });
        
        it('should return quest actor overrides when available', async () => {
            // Execute
            const result = await actorService.getActorsInLocation('location456', 'user123');
            
            // Verify
            expect(actorService.questService.getQuestNodeActorOverrides).toHaveBeenCalledWith('user123', 'location456');
            // Should return actor1 even though it's in location123, due to quest override
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Test Actor 1');
        });
    });

    describe('getActorChatMessage', () => {
        it('should return sorted chat message for an actor', async () => {
            // Get a real actor from mocked data
            const actor = testActors[0];
            
            // Execute
            const result = await actorService.getActorChatMessage(actor, `chat_${actor._id}_${testUser._id}`, 0);
            
            // Verify - should get the first message in sorted order (order: 1)
            expect(result).toEqual({
                message: 'Hello 2',
                nextIndex: 1
            });
        });

        it('should handle circular message indexes', async () => {
            // Get a real actor from mocked data
            const actor = testActors[0];
            
            // Execute - passing index 2 (last in sorted order)
            const result = await actorService.getActorChatMessage(actor, `chat_${actor._id}_${testUser._id}`, 2);
            
            // Verify - nextIndex should wrap to 0
            expect(result).toEqual({
                message: 'Hello 3',
                nextIndex: 0
            });
        });
        
        it('should handle quest completion events in chat messages', async () => {
            // Create a special actor with quest completion events
            const actor = createMockDocument({
                _id: 'actor4',
                name: 'Quest Actor',
                chatMessages: [
                    { 
                        message: 'This completes a quest',
                        order: 1,
                        questCompletionEvents: ['event1', 'event2']
                    }
                ]
            });
            
            // Execute
            const result = await actorService.getActorChatMessage(actor, `chat_${actor._id}_user123`, 0);
            
            // Verify
            expect(result).toEqual({
                message: 'This completes a quest',
                nextIndex: 0 // Single message, so cycles back to 0
            });
            
            expect(User.findById).toHaveBeenCalledWith('user123');
            expect(actorService.questService.handleQuestProgression).toHaveBeenCalledWith(
                testUser,
                'actor4',
                ['event1', 'event2'],
                null
            );
        });
    });

    describe('findActorById', () => {
        it('should find an actor by ID', async () => {
            // Execute
            const result = await actorService.findActorById('actor1');
            
            // Verify
            expect(result).toBeDefined();
            expect(result.name).toBe('Test Actor 1');
            expect(result.description).toBe('First test actor');
        });

        it('should return null for non-existent actor ID', async () => {
            // Execute
            const result = await actorService.findActorById('nonexistent');
            
            // Verify
            expect(result).toBeNull();
        });
    });
}); 