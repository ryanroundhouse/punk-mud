const { MobService } = require('../../src/services/mobService');

describe('MobService', () => {
    let mobService;
    let mockMob;
    let mockStateService;
    let mockLogger;
    let mockRandom;

    beforeEach(() => {
        // Mock the Mob model with populate chain
        mockMob = {
            findById: jest.fn().mockReturnThis(),
            populate: jest.fn().mockReturnThis()
        };

        // Mock the state service
        mockStateService = {
            playerMobs: new Map()
        };

        // Mock the logger
        mockLogger = {
            debug: jest.fn()
        };

        // Mock random number generator
        mockRandom = jest.fn();

        // Create a new instance with mocked dependencies
        mobService = new MobService({
            Mob: mockMob,
            stateService: mockStateService,
            logger: mockLogger,
            random: mockRandom
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('loadMobFromEvent', () => {
        it('should return null if mob is not found', async () => {
            mockMob.populate.mockResolvedValue(null);
            const result = await mobService.loadMobFromEvent({ mobId: 'nonexistent' });
            expect(result).toBeNull();
            expect(mockMob.findById).toHaveBeenCalledWith('nonexistent');
            expect(mockMob.populate).toHaveBeenCalledWith({
                path: 'moves.move',
                model: 'Move'
            });
        });

        it('should correctly transform mob data into mob instance', async () => {
            const mockMobData = {
                _id: 'mob123',
                name: 'Test Mob',
                description: 'A test mob',
                image: 'test.jpg',
                stats: {
                    level: 5,
                    hitpoints: 100,
                    armor: 10,
                    body: 8,
                    reflexes: 7,
                    agility: 6,
                    tech: 5,
                    luck: 4,
                    charisma: 3
                },
                chatMessages: ['Hello'],
                moves: [{
                    move: {
                        toObject: () => ({ id: 'move1', name: 'Test Move' }),
                    },
                    usageChance: 50
                }]
            };

            mockMob.populate.mockResolvedValue(mockMobData);
            
            const result = await mobService.loadMobFromEvent({ mobId: 'mob123' });
            
            expect(result).toHaveProperty('mobId', 'mob123');
            expect(result).toHaveProperty('name', 'Test Mob');
            expect(result.stats).toEqual(expect.objectContaining({
                hitpoints: 100,
                currentHitpoints: 100,
                armor: 10
            }));
            expect(result.moves).toHaveLength(1);
            expect(result.moves[0]).toEqual(expect.objectContaining({
                id: 'move1',
                name: 'Test Move',
                usageChance: 50
            }));
        });
    });

    describe('spawnMobForUser', () => {
        it('should return null if node has no events', async () => {
            const result = await mobService.spawnMobForUser('user123', { events: [] });
            expect(result).toBeNull();
        });

        it('should return null if user already has a mob', async () => {
            mockStateService.playerMobs.set('user123', {});
            const result = await mobService.spawnMobForUser('user123', { 
                events: [{ mobId: 'mob1', chance: 100 }] 
            });
            expect(result).toBeNull();
        });

        describe('100% probability spawns', () => {
            it('should spawn a mob when roll is within chance range', async () => {
                const mockMobData = {
                    _id: 'mob1',
                    name: 'Test Mob',
                    stats: {
                        level: 1,
                        hitpoints: 100,
                        armor: 10,
                        body: 8,
                        reflexes: 7,
                        agility: 6,
                        tech: 5,
                        luck: 4,
                        charisma: 3
                    },
                    moves: [],
                    chatMessages: []
                };
                
                mockRandom.mockReturnValue(0.5); // 50% roll
                mockMob.populate.mockResolvedValue(mockMobData);

                const node = {
                    address: 'test-node',
                    events: [
                        { mobId: 'mob1', chance: 60 },
                        { mobId: 'mob2', chance: 40 }
                    ]
                };

                const result = await mobService.spawnMobForUser('user123', node);
                expect(result).not.toBeNull();
                expect(mockStateService.playerMobs.has('user123')).toBe(true);
                expect(mockMob.findById).toHaveBeenCalledWith('mob1');
            });
        });

        describe('partial probability spawns', () => {
            it('should not spawn a mob when no events pass chance check', async () => {
                mockRandom.mockReturnValue(0.9); // 90% roll, above all chances
                
                const node = {
                    address: 'test-node',
                    events: [
                        { mobId: 'mob1', chance: 30 },
                        { mobId: 'mob2', chance: 20 }
                    ]
                };

                const result = await mobService.spawnMobForUser('user123', node);
                expect(result).toBeNull();
                expect(mockStateService.playerMobs.has('user123')).toBe(false);
            });

            it('should spawn a mob when an event passes chance check', async () => {
                // Set up random mock to allow first event to pass and select it
                mockRandom
                    .mockReturnValueOnce(0.2) // 20% roll for first event check (passes 30% threshold)
                    .mockReturnValueOnce(0.9) // 90% roll for second event check (fails 20% threshold)
                    .mockReturnValueOnce(0.1); // 10% roll for selecting from eligible events
                
                const mockMobData = {
                    _id: 'mob1',
                    name: 'Test Mob',
                    stats: {
                        level: 1,
                        hitpoints: 100,
                        armor: 10,
                        body: 8,
                        reflexes: 7,
                        agility: 6,
                        tech: 5,
                        luck: 4,
                        charisma: 3
                    },
                    moves: [],
                    chatMessages: []
                };

                mockMob.populate.mockResolvedValue(mockMobData);

                const node = {
                    address: 'test-node',
                    events: [
                        { mobId: 'mob1', chance: 30 },
                        { mobId: 'mob2', chance: 20 }
                    ]
                };

                const result = await mobService.spawnMobForUser('user123', node);
                expect(result).not.toBeNull();
                expect(mockStateService.playerMobs.has('user123')).toBe(true);
                expect(mockMob.findById).toHaveBeenCalledWith('mob1');
                
                // Verify the random calls were made correctly
                expect(mockRandom).toHaveBeenCalledTimes(3);
            });
        });
    });

    describe('clearUserMob', () => {
        it('should remove mob from state service', () => {
            mockStateService.playerMobs.set('user123', { name: 'Test Mob' });
            mobService.clearUserMob('user123');
            expect(mockStateService.playerMobs.has('user123')).toBe(false);
        });
    });
}); 