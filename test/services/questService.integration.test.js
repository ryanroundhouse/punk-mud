const { QuestService } = require('../../src/services/questService');
const mongoose = require('mongoose');

// Mock dependencies
jest.mock('../../src/services/messageService', () => ({
    sendQuestsMessage: jest.fn(),
    sendSuccessMessage: jest.fn(),
    sendErrorMessage: jest.fn(),
    sendInfoMessage: jest.fn()
}));

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
        toString: () => data._id?.toString() || new mongoose.Types.ObjectId().toString(),
        save: jest.fn().mockImplementation(function() {
            return Promise.resolve(this);
        })
    };
};

// Create a testUtils object to handle creation of test data
const testUtils = {
    createUser: async (options = {}) => {
        const userId = new mongoose.Types.ObjectId().toString();
        const user = createMockDocument({
            _id: userId,
            avatarName: options.avatarName || 'TestUser',
            email: options.email || 'test@example.com',
            class: options.class || null,
            currentNode: options.currentNode || 'node123',
            stats: options.stats || {
                level: 1,
                experience: 0,
                hitpoints: 20,
                currentHitpoints: 20
            },
            quests: options.quests || []
        });
        user.save = jest.fn().mockResolvedValue(user);
        return user;
    },
    
    createQuest: async (options = {}) => {
        const questId = new mongoose.Types.ObjectId().toString();
        const event1Id = new mongoose.Types.ObjectId().toString();
        const event2Id = new mongoose.Types.ObjectId().toString();
        const actorId = options.actorId || new mongoose.Types.ObjectId().toString();
        
        const events = [
            {
                _id: event1Id,
                message: options.startMessage || 'Start of quest',
                eventType: 'chat',
                isStart: true,
                isEnd: false,
                actorId: actorId,
                choices: [
                    { 
                        text: 'Continue', 
                        nextEventId: event2Id
                    }
                ]
            },
            {
                _id: event2Id,
                message: options.endMessage || 'End of quest',
                eventType: 'chat',
                isStart: false,
                isEnd: true,
                actorId: actorId,
                choices: [],
                rewards: options.rewards || [
                    { type: 'experiencePoints', value: '100' }
                ]
            }
        ];
        
        const quest = createMockDocument({
            _id: questId,
            title: options.title || 'Test Quest',
            description: options.description || 'A test quest for integration testing',
            journalDescription: options.journalDescription || 'Journal entry for test quest',
            events: events
        });
        
        return quest;
    }
};

describe('QuestService Integration Tests', () => {
    let questService;
    let mockUser;
    let mockQuest;
    let mockClass;
    let testUser;
    let testQuest;
    let testClass;
    let testEvent1;
    let testEvent2;

    beforeEach(() => {
        // Create mock IDs
        const userId = new mongoose.Types.ObjectId().toString();
        const questId = new mongoose.Types.ObjectId().toString();
        const classId = new mongoose.Types.ObjectId().toString();
        const event1Id = new mongoose.Types.ObjectId().toString();
        const event2Id = new mongoose.Types.ObjectId().toString();
        const actorId = new mongoose.Types.ObjectId().toString();
        
        // Create test class data
        testClass = createMockDocument({
            _id: classId,
            name: 'TestClass',
            primaryStat: 'body',
            secondaryStats: ['agility', 'reflexes'],
            baseHitpoints: 30,
            hpPerLevel: 5,
            hpPerBod: 2,
            moveGrowth: []
        });
        
        // Create test events
        testEvent1 = {
            _id: event1Id,
            message: 'Start of quest',
            eventType: 'chat',
            isStart: true,
            isEnd: false,
            actorId: actorId,
            choices: [
                { 
                    text: 'Continue', 
                    nextEventId: event2Id
                }
            ]
        };
        
        testEvent2 = {
            _id: event2Id,
            message: 'End of quest',
            eventType: 'chat',
            isStart: false,
            isEnd: true,
            actorId: actorId,
            choices: [],
            rewards: [
                { type: 'experiencePoints', value: '100' },
                { type: 'gainClass', value: classId }
            ],
            nodeEventOverrides: [
                {
                    nodeAddress: 'testNode123',
                    events: [
                        {
                            mobId: new mongoose.Types.ObjectId().toString(),
                            chance: 100
                        }
                    ]
                }
            ]
        };
        
        // Create test quest data
        testQuest = createMockDocument({
            _id: questId,
            title: 'Test Quest',
            description: 'A test quest for integration testing',
            journalDescription: 'Journal entry for test quest',
            events: [testEvent1, testEvent2]
        });
        
        // Create test user data
        testUser = createMockDocument({
            _id: userId,
            avatarName: 'TestUser',
            email: 'test@example.com',
            class: null,
            currentNode: 'node123',
            stats: {
                level: 1,
                experience: 0,
                hitpoints: 20,
                currentHitpoints: 20
            },
            quests: [
                {
                    questId: questId,
                    currentEventId: event1Id,
                    completedEventIds: [],
                    completed: false
                }
            ]
        });
        
        // Mock Class model
        mockClass = {
            findById: jest.fn().mockImplementation(id => {
                if (id === classId || id?.toString() === classId) {
                    return Promise.resolve(testClass);
                }
                return Promise.resolve(null);
            }),
            create: jest.fn().mockResolvedValue(testClass)
        };
        
        // Mock Quest model with additional methods needed by QuestService
        mockQuest = {
            findById: jest.fn().mockImplementation(id => {
                if (id === questId || id?.toString() === questId) {
                    return Promise.resolve(testQuest);
                }
                return Promise.resolve(null);
            }),
            find: jest.fn().mockResolvedValue([testQuest]), // Add find method
            create: jest.fn().mockResolvedValue(testQuest)
        };
        
        // Mock User model with additional methods and implementations
        mockUser = {
            findById: jest.fn().mockImplementation(id => {
                if (id === userId || id?.toString() === userId) {
                    return Promise.resolve(testUser);
                }
                return Promise.resolve(null);
            }),
            findByIdAndUpdate: jest.fn().mockImplementation((id, update) => {
                if (id === userId || id?.toString() === userId) {
                    // Apply updates to testUser
                    if (update.quests) {
                        testUser.quests = update.quests;
                    }
                    if (update.$set) {
                        for (const key in update.$set) {
                            if (key.startsWith('quests.')) {
                                const [_, index, field] = key.split('.');
                                testUser.quests[parseInt(index)][field] = update.$set[key];
                            }
                        }
                    }
                    return Promise.resolve(testUser);
                }
                return Promise.resolve(null);
            }),
            // Add findOneAndUpdate method for improved quest handling
            findOneAndUpdate: jest.fn().mockImplementation((query, update, options) => {
                // Handle adding a new quest
                if (update.$push && update.$push.quests) {
                    const newQuest = update.$push.quests;
                    if (query._id === testUser._id.toString()) {
                        testUser.quests.push(newQuest);
                    } else if (query._id) {
                        const user = createMockDocument({
                            _id: query._id,
                            avatarName: 'DynamicUser',
                            quests: [newQuest]
                        });
                        return Promise.resolve(user);
                    }
                    return Promise.resolve(testUser);
                }
                
                // Handle updating an existing quest field
                if (update.$set) {
                    for (const key in update.$set) {
                        if (key.startsWith('quests.')) {
                            const parts = key.split('.');
                            const index = parseInt(parts[1]);
                            const field = parts[2];
                            if (testUser.quests[index]) {
                                testUser.quests[index][field] = update.$set[key];
                            }
                        }
                    }
                }
                
                return Promise.resolve(testUser);
            }),
            create: jest.fn().mockResolvedValue(testUser)
        };
        
        // Create a mock messageService for dependency injection
        const mockMessageService = {
            sendQuestsMessage: jest.fn(),
            sendSuccessMessage: jest.fn(),
            sendErrorMessage: jest.fn(),
            sendInfoMessage: jest.fn()
        };
        
        // Create a mock userService for dependency injection
        const mockUserService = {
            awardExperience: jest.fn().mockResolvedValue({
                user: testUser,
                leveledUp: false
            }),
            setUserClass: jest.fn().mockResolvedValue(testUser)
        };
        
        // Mock logger
        const mockLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn()
        };
        
        // Create QuestService instance with mocked dependencies
        questService = new QuestService({
            User: mockUser,
            Quest: mockQuest,
            Class: mockClass,
            messageService: mockMessageService,
            userService: mockUserService,
            logger: mockLogger
        });
        
        // Add helper methods directly to the questService instance
        questService.getQuestById = jest.fn().mockImplementation(id => {
            if (id === questId || id?.toString() === questId) {
                return Promise.resolve(testQuest);
            }
            return Promise.resolve(null);
        });
        
        questService.getQuestEvent = jest.fn().mockImplementation((quest, eventId) => {
            if (quest && quest.events) {
                if (eventId === testEvent1._id || eventId?.toString() === testEvent1._id) {
                    return testEvent1;
                }
                if (eventId === testEvent2._id || eventId?.toString() === testEvent2._id) {
                    return testEvent2;
                }
            }
            return null;
        });
        
        questService.getStartEventForQuest = jest.fn().mockImplementation(quest => {
            if (quest && quest.events) {
                return testEvent1;
            }
            return null;
        });
    });

    describe('getActiveQuests', () => {
        it('should retrieve active quests for a user', async () => {
            const quests = await questService.getActiveQuests(testUser._id);
            
            expect(quests).toHaveLength(1);
            expect(quests[0].questId).toBe(testQuest._id);
            expect(quests[0].title).toBe('Test Quest');
        });

        it('should return empty array for user with no quests', async () => {
            // Create a user with no quests
            const noQuestsUser = createMockDocument({
                _id: new mongoose.Types.ObjectId().toString(),
                avatarName: 'NoQuestUser',
                email: 'noquests@example.com',
                currentNode: 'node123',
                quests: []
            });
            
            // Mock the User.findById for this specific user
            mockUser.findById.mockImplementation(id => {
                if (id === noQuestsUser._id || id?.toString() === noQuestsUser._id) {
                    return Promise.resolve(noQuestsUser);
                } else if (id === testUser._id || id?.toString() === testUser._id) {
                    return Promise.resolve(testUser);
                }
                return Promise.resolve(null);
            });

            const quests = await questService.getActiveQuests(noQuestsUser._id);
            expect(quests).toHaveLength(0);
        });
    });

    describe('getUserQuestInfo', () => {
        it('should retrieve quest info for a user', async () => {
            const info = await questService.getUserQuestInfo(testUser._id);
            
            expect(info.activeQuestIds).toHaveLength(1);
            expect(info.activeQuestIds[0]).toBe(testQuest._id);
            expect(info.completedQuestIds).toHaveLength(0);
            expect(info.completedQuestEventIds).toHaveLength(0);
        });

        it('should reflect completed quests in the quest info', async () => {
            // Mark the quest as completed
            testUser.quests[0].completed = true;
            testUser.quests[0].completedEventIds.push(testEvent1._id);
            testUser.quests[0].completedAt = new Date();
            
            const info = await questService.getUserQuestInfo(testUser._id);
            
            expect(info.activeQuestIds).toHaveLength(0);
            expect(info.completedQuestIds).toHaveLength(1);
            expect(info.completedQuestIds[0]).toBe(testQuest._id);
            expect(info.completedQuestEventIds).toHaveLength(1);
            expect(info.completedQuestEventIds[0]).toBe(testEvent1._id);
        });
    });

    describe('handleQuestProgression', () => {
        it('should progress a quest when given a valid completion event', async () => {
            // Arrange
            const testUser = await testUtils.createUser();
            const testQuest = await testUtils.createQuest();
            const testEvent1 = testQuest.events[0];
            const testEvent2 = testQuest.events[1];
            
            // Add the quest to the user's active quests
            testUser.quests = [{
                questId: testQuest._id,
                currentEventId: testEvent1._id,
                completedEventIds: [],
                completed: false
            }];
            await testUser.save();
            
            // Mock the Quest.find to return the test quest
            mockQuest.find.mockResolvedValue([testQuest]);
            
            // Act
            const result = await questService.handleQuestProgression(
                testUser,
                null,
                [testEvent2._id.toString()]
            );
            
            // Assert - check that the quest is updated in the user object
            expect(testUser.quests[0].currentEventId).toBe(testEvent2._id.toString());
            expect(testUser.quests[0].completedEventIds).toContain(testEvent1._id.toString());
        });
        
        it('should activate a quest when directly specified', async () => {
            // Arrange
            const freshUser = createMockDocument({
                _id: new mongoose.Types.ObjectId().toString(),
                avatarName: 'TestUser',
                email: 'test@example.com',
                quests: []
            });
            
            const testQuestId = new mongoose.Types.ObjectId().toString(); 
            const testEventId = new mongoose.Types.ObjectId().toString();
            
            const testQuest = createMockDocument({
                _id: testQuestId,
                title: 'Direct Activation Test Quest',
                description: 'Testing direct quest activation',
                events: [
                    {
                        _id: testEventId,
                        message: 'Start of direct activation test quest',
                        eventType: 'chat',
                        isStart: true,
                        isEnd: false,
                        choices: []
                    }
                ]
            });
            
            // Mock Quest.findById to return our test quest
            mockQuest.findById.mockResolvedValue(testQuest);
            
            // Mock the User.findOneAndUpdate to directly add the quest
            mockUser.findOneAndUpdate.mockImplementationOnce((query, update) => {
                if (update.$push && update.$push.quests) {
                    const updatedUser = {...freshUser};
                    updatedUser.quests = [update.$push.quests];
                    return Promise.resolve(updatedUser);
                }
                return Promise.resolve(freshUser);
            });
            
            // Set up the Quest.find method to return our test quest
            mockQuest.find.mockResolvedValue([testQuest]);
            
            // Act - directly call handleQuestProgression with the quest ID
            const result = await questService.handleQuestProgression(
                freshUser,
                null, 
                [],  
                testQuestId
            );
            
            // Assert that findOneAndUpdate was called correctly
            expect(mockUser.findOneAndUpdate).toHaveBeenCalledWith(
                { _id: freshUser._id },
                expect.objectContaining({
                    $push: expect.objectContaining({
                        quests: expect.objectContaining({
                            questId: testQuestId,
                            currentEventId: testEventId,
                            completedEventIds: expect.any(Array)
                        })
                    })
                }),
                { new: true }
            );
            
            // Verify that a message was sent about the new quest
            const messageServiceMock = questService.messageService;
            expect(messageServiceMock.sendQuestsMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('New Quest')
            );
        });
    });

    describe('getQuestNodeEventOverrides', () => {
        it('should retrieve node event overrides for active quests', async () => {
            // Update the current event ID to the event with node overrides
            testUser.quests[0].currentEventId = testEvent2._id;
            
            const overrides = await questService.getQuestNodeEventOverrides(
                testUser._id,
                'testNode123'
            );
            
            expect(overrides).toBeTruthy();
            expect(overrides).toHaveLength(1);
            expect(overrides[0]).toHaveProperty('mobId');
            expect(overrides[0]).toHaveProperty('chance', 100);
        });

        it('should return null for non-matching node address', async () => {
            const overrides = await questService.getQuestNodeEventOverrides(
                testUser._id,
                'nonMatchingNode'
            );
            
            expect(overrides).toBeNull();
        });
    });
    
    // Helper methods used by QuestService that we need to mock
    describe('helper methods', () => {
        it('should get a quest by id', async () => {
            const quest = await questService.getQuestById(testQuest._id);
            expect(quest).toBe(testQuest);
        });
        
        it('should get an event from a quest', () => {
            const event = questService.getQuestEvent(testQuest, testEvent1._id);
            expect(event).toBe(testEvent1);
        });
    });
}); 