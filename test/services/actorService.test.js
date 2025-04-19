const { ActorService } = require('../../src/services/actorService');
const { QuestService } = require('../../src/services/questService');
const { 
    createMockDependencies,
    createMockActor
} = require('../helpers/mockFactory');

// Mock the entire questService module
jest.mock('../../src/services/questService');

describe('ActorService', () => {
    // Mock data and dependencies
    let mockDeps;
    let actorService;

    // Sample mock data
    const mockActors = [
        {
            _id: 'actor1',
            name: 'Actor One',
            description: 'First test actor',
            location: 'location123',
            chatMessages: [
                { message: 'Hello 1', order: 2 },
                { message: 'Hello 3', order: 3 },
                { message: 'Hello 2', order: 1 }
            ]
        },
        {
            _id: 'actor2',
            name: 'Actor Two',
            description: 'Second test actor',
            location: 'location123',
            chatMessages: [
                { message: 'Message 1', order: 1 },
                { message: 'Message 2', order: 2 }
            ]
        },
        {
            _id: 'actor3',
            name: 'Actor Three',
            description: 'Third test actor',
            location: 'location456',
            chatMessages: [
                { message: 'Dialogue 1', order: 1 }
            ]
        }
    ];

    const mockUser = {
        _id: '507f191e810c19729de860ea',
        quests: []
    };

    beforeEach(() => {
        // Reset mocks provided by jest.mock
        QuestService.mockClear();

        // Create mock dependencies - Assume createMockDependencies sets up basic mocks
        // for models like Actor, User, etc., but NOT services.
        mockDeps = createMockDependencies();

        // Ensure model mocks are fresh jest functions
        mockDeps.Actor.find = jest.fn();
        mockDeps.Actor.findById = jest.fn();
        mockDeps.User.findById = jest.fn();

        // Assign a *new instance* of the *mocked* QuestService to mockDeps.
        // jest.mock replaces the QuestService export with a mock constructor.
        mockDeps.questService = new QuestService();

        // Create the service instance with mocked dependencies
        actorService = new ActorService(mockDeps);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('findActorInLocation', () => {
        it('should find an actor by name in a location', async () => {
            // Setup
            mockDeps.Actor.find.mockResolvedValueOnce(mockActors.filter(a => a.location === 'location123'));
            
            // Execute
            const result = await actorService.findActorInLocation('Actor One', 'location123');
            
            // Verify
            expect(result).toBeDefined();
            expect(result.name).toBe('Actor One');
            expect(mockDeps.Actor.find).toHaveBeenCalledWith({ location: 'location123' });
        });

        it('should return undefined if no actor with the name is found', async () => {
            // Setup
            mockDeps.Actor.find.mockResolvedValueOnce(mockActors.filter(a => a.location === 'location123'));
            
            // Execute
            const result = await actorService.findActorInLocation('Non-existent Actor', 'location123');
            
            // Verify
            expect(result).toBeUndefined();
        });

        it('should handle errors gracefully', async () => {
            // Setup - Mock getActorsInLocation to throw an error
            // We need to mock the getActorsInLocation method, not the Actor.find
            const spy = jest.spyOn(actorService, 'getActorsInLocation');
            spy.mockRejectedValueOnce(new Error('Database error'));
            
            // Execute & Verify
            await expect(actorService.findActorInLocation('Actor One', 'location123'))
                .rejects.toThrow('Database error');
            expect(mockDeps.logger.error).toHaveBeenCalled();
            
            // Cleanup
            spy.mockRestore();
        });
    });

    describe('getActorsInLocation', () => {
        it('should return actors in a location without user context', async () => {
            // Setup
            mockDeps.Actor.find.mockResolvedValueOnce(mockActors.filter(a => a.location === 'location123'));
            
            // Execute
            const result = await actorService.getActorsInLocation('location123');
            
            // Verify
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('Actor One');
            expect(result[1].name).toBe('Actor Two');
            expect(mockDeps.Actor.find).toHaveBeenCalledWith({ location: 'location123' });
            expect(mockDeps.questService.getQuestNodeActorOverrides).not.toHaveBeenCalled();
        });

        it('should check for quest actor overrides when userId is provided', async () => {
            // Setup
            mockDeps.questService.getQuestNodeActorOverrides.mockResolvedValueOnce([]);
            mockDeps.Actor.find.mockResolvedValueOnce(mockActors.filter(a => a.location === 'location123'));
            
            // Execute
            const result = await actorService.getActorsInLocation('location123', '507f191e810c19729de860ea');
            
            // Verify
            expect(result).toHaveLength(2);
            expect(mockDeps.questService.getQuestNodeActorOverrides).toHaveBeenCalledWith('507f191e810c19729de860ea', 'location123');
            expect(mockDeps.Actor.find).toHaveBeenCalledWith({ location: 'location123' });
        });

        it('should return quest actor overrides when available', async () => {
            // Setup
            mockDeps.questService.getQuestNodeActorOverrides.mockResolvedValueOnce(['actor3']);
            mockDeps.Actor.find.mockImplementation((query) => {
                if (query._id && query._id.$in && query._id.$in.includes('actor3')) {
                    return Promise.resolve([mockActors[2]]);
                }
                return Promise.resolve([]);
            });
            
            // Execute
            const result = await actorService.getActorsInLocation('location123', '507f191e810c19729de860ea');
            
            // Verify
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Actor Three');
            expect(mockDeps.Actor.find).toHaveBeenCalledWith({ _id: { $in: ['actor3'] } });
            expect(mockDeps.questService.getQuestNodeActorOverrides).toHaveBeenCalledWith('507f191e810c19729de860ea', 'location123');
        });

        it('should handle errors gracefully and return empty array', async () => {
            // Setup
            mockDeps.Actor.find.mockRejectedValueOnce(new Error('Database error'));
            
            // Execute
            const result = await actorService.getActorsInLocation('location123');
            
            // Verify
            expect(result).toEqual([]);
            expect(mockDeps.logger.error).toHaveBeenCalled();
            expect(mockDeps.questService.getQuestNodeActorOverrides).not.toHaveBeenCalled();
        });
    });

    describe('getActorChatMessage', () => {
        it('should return sorted chat message for an actor', async () => {
            // Setup
            const actor = createMockActor({
                _id: 'actor1',
                chatMessages: [
                    { message: 'Hello 1', order: 2 },
                    { message: 'Hello 3', order: 3 },
                    { message: 'Hello 2', order: 1 }
                ]
            });
            
            // Execute
            const result = await actorService.getActorChatMessage(actor, 'chat_actor1_507f191e810c19729de860ea', 0);
            
            // Verify
            expect(result.message).toBe('Hello 2');
            expect(result.nextIndex).toBe(1);
            expect(mockDeps.questService.handleQuestProgression).not.toHaveBeenCalled();
        });

        it('should handle quest completion events in chat messages', async () => {
            // Setup
            const actor = createMockActor({
                _id: 'actor1',
                chatMessages: [
                    { 
                        message: 'Quest message', 
                        order: 1,
                        questCompletionEvents: ['event1', 'event2'] 
                    }
                ]
            });
            
            mockDeps.User.findById.mockResolvedValueOnce(mockUser);
            mockDeps.questService.handleQuestProgression.mockResolvedValueOnce({ 
                success: true, 
                updates: ['quest1'] 
            });
            
            // Execute
            const result = await actorService.getActorChatMessage(actor, 'chat_actor1_507f191e810c19729de860ea', 0);
            
            // Verify
            expect(result.message).toBe('Quest message');
            expect(result.nextIndex).toBe(0);
            expect(mockDeps.User.findById).toHaveBeenCalledWith('507f191e810c19729de860ea');
            expect(mockDeps.questService.handleQuestProgression).toHaveBeenCalledWith(
                mockUser,
                'actor1',
                ['event1', 'event2'],
                null
            );
        });

        it('should handle circular message indexes', async () => {
            // Setup
            const actor = createMockActor({
                _id: 'actor1',
                chatMessages: [
                    { message: 'Hello 1', order: 2 },
                    { message: 'Hello 3', order: 3 },
                    { message: 'Hello 2', order: 1 }
                ]
            });
            
            // Execute - passing index 2 (last in sorted order)
            const result = await actorService.getActorChatMessage(actor, 'chat_actor1_507f191e810c19729de860ea', 2);
            
            // Verify - only check the fields we care about
            expect(result.message).toBe('Hello 3');
            expect(result.nextIndex).toBe(0);
            expect(mockDeps.questService.handleQuestProgression).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            // Setup
            const actor = createMockActor();
            
            // Mock User.findById to throw an error
            mockDeps.User.findById.mockRejectedValueOnce(new Error('Database error'));
            
            // Mock the actor to have a message with quest completion events
            // This ensures the code path that calls User.findById is executed
            actor.chatMessages = [{ 
                message: 'Quest message', 
                order: 1,
                questCompletionEvents: ['event1', 'event2'] 
            }];
            
            // Execute & Verify
            await expect(actorService.getActorChatMessage(actor, 'chat_actor1_507f191e810c19729de860ea', 0))
                .rejects.toThrow('Database error');
            expect(mockDeps.logger.error).toHaveBeenCalled();
            expect(mockDeps.questService.handleQuestProgression).not.toHaveBeenCalled();
        });
    });

    describe('findActorById', () => {
        it('should find an actor by ID', async () => {
            // Setup
            mockDeps.Actor.findById.mockResolvedValueOnce(mockActors[0]);
            
            // Execute
            const result = await actorService.findActorById('actor1');
            
            // Verify
            expect(result).toBeDefined();
            expect(result.name).toBe('Actor One');
            expect(mockDeps.Actor.findById).toHaveBeenCalledWith('actor1');
        });

        it('should handle errors gracefully', async () => {
            // Setup
            mockDeps.Actor.findById.mockRejectedValueOnce(new Error('Database error'));
            
            // Execute & Verify
            await expect(actorService.findActorById('actor1'))
                .rejects.toThrow('Database error');
            expect(mockDeps.logger.error).toHaveBeenCalled();
        });
    });
}); 