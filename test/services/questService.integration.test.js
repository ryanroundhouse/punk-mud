const mongoose = require('mongoose');
const { QuestService } = require('../../src/services/questService');
const User = require('../../src/models/User');
const Quest = require('../../src/models/Quest');
const Class = require('../../src/models/Class');

// Mock dependent services to isolate database integration testing
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

// Create test database connection
const setupDatabase = async () => {
    // Connect to a test database
    const url = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/quest-service-test';
    await mongoose.connect(url);
};

// Clean up database after tests
const cleanupDatabase = async () => {
    if (mongoose.connection.readyState === 1) {
        // Clean up test data
        await User.deleteMany({});
        await Quest.deleteMany({});
        await Class.deleteMany({});
        
        // Close the connection
        await mongoose.connection.close();
    }
};

describe('QuestService Integration Tests', () => {
    let questService;
    let testUser;
    let testQuest;
    let testClass;

    beforeAll(async () => {
        await setupDatabase();
        
        // Create real instance of the service with real models
        questService = new QuestService();
    });

    afterAll(async () => {
        await cleanupDatabase();
    });

    beforeEach(async () => {
        // Clean existing data
        await User.deleteMany({});
        await Quest.deleteMany({});
        await Class.deleteMany({});

        // Create test class
        testClass = await Class.create({
            name: 'TestClass',
            primaryStat: 'body',
            secondaryStats: ['agility', 'reflexes'],
            baseHitpoints: 30,
            hpPerLevel: 5,
            hpPerBod: 2,
            moveGrowth: []
        });
        
        // Create test quest with events
        testQuest = await Quest.create({
            title: 'Test Quest',
            description: 'A test quest for integration testing',
            journalDescription: 'Journal entry for test quest',
            events: [
                {
                    message: 'Start of quest',
                    eventType: 'chat',
                    isStart: true,
                    isEnd: false,
                    actorId: new mongoose.Types.ObjectId(),
                    choices: [
                        { 
                            text: 'Continue', 
                            nextEventId: new mongoose.Types.ObjectId() 
                        }
                    ]
                }
            ]
        });

        // Add second event and update first event's choice
        const secondEvent = {
            message: 'End of quest',
            eventType: 'chat',
            isStart: false,
            isEnd: true,
            actorId: new mongoose.Types.ObjectId(),
            choices: [],
            rewards: [
                { type: 'experiencePoints', value: '100' },
                { type: 'gainClass', value: testClass._id }
            ]
        };
        
        testQuest.events.push(secondEvent);
        
        // Update first event's choice to point to the second event
        testQuest.events[0].choices[0].nextEventId = testQuest.events[1]._id;
        
        await testQuest.save();

        // Create test user with the quest
        testUser = await User.create({
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
                    questId: testQuest._id,
                    currentEventId: testQuest.events[0]._id,
                    completedEventIds: [],
                    completed: false
                }
            ]
        });
    });

    describe('getActiveQuests', () => {
        it('should retrieve active quests for a user', async () => {
            const quests = await questService.getActiveQuests(testUser._id);
            
            expect(quests).toHaveLength(1);
            expect(quests[0].questId).toBe(testQuest._id.toString());
            expect(quests[0].title).toBe('Test Quest');
        });

        it('should return empty array for user with no quests', async () => {
            const newUser = await User.create({
                avatarName: 'NoQuestUser',
                email: 'noquests@example.com',
                currentNode: 'node123',
                quests: []
            });

            const quests = await questService.getActiveQuests(newUser._id);
            expect(quests).toHaveLength(0);
        });
    });

    describe('getUserQuestInfo', () => {
        it('should retrieve quest info for a user', async () => {
            const info = await questService.getUserQuestInfo(testUser._id);
            
            expect(info.activeQuestIds).toHaveLength(1);
            expect(info.activeQuestIds[0]).toBe(testQuest._id.toString());
            expect(info.completedQuestIds).toHaveLength(0);
            expect(info.completedQuestEventIds).toHaveLength(0);
        });

        it('should reflect completed quests in the quest info', async () => {
            // Mark the quest as completed
            testUser.quests[0].completed = true;
            testUser.quests[0].completedEventIds.push(testQuest.events[0]._id);
            testUser.quests[0].completedAt = new Date();
            await testUser.save();
            
            const info = await questService.getUserQuestInfo(testUser._id);
            
            expect(info.activeQuestIds).toHaveLength(0);
            expect(info.completedQuestIds).toHaveLength(1);
            expect(info.completedQuestIds[0]).toBe(testQuest._id.toString());
            expect(info.completedQuestEventIds).toHaveLength(1);
            expect(info.completedQuestEventIds[0]).toBe(testQuest.events[0]._id.toString());
        });
    });

    describe('handleQuestProgression', () => {
        it('should progress a quest when given a valid completion event', async () => {
            // Get a fresh user
            const user = await User.findById(testUser._id);
            
            // Progress the quest
            const result = await questService.handleQuestProgression(
                user,
                'actor123',
                [testQuest.events[1]._id.toString()]
            );
            
            // Reload user to check updates
            const updatedUser = await User.findById(testUser._id);
            
            expect(result).toBeTruthy();
            expect(result[0].type).toBe('quest_complete');
            expect(updatedUser.quests[0].completed).toBe(true);
            expect(updatedUser.quests[0].currentEventId.toString()).toBe(testQuest.events[1]._id.toString());
        });

        it('should activate a quest when directly specified', async () => {
            // Remove existing quests from user
            await User.findByIdAndUpdate(testUser._id, { quests: [] });
            
            // Get fresh user
            const user = await User.findById(testUser._id);
            
            // Activate the quest
            const result = await questService.handleQuestProgression(
                user,
                'actor123',
                [],
                testQuest._id
            );
            
            // Reload user
            const updatedUser = await User.findById(testUser._id);
            
            expect(result).toBeTruthy();
            expect(result.type).toBe('quest_start');
            expect(updatedUser.quests).toHaveLength(1);
            expect(updatedUser.quests[0].questId.toString()).toBe(testQuest._id.toString());
            expect(updatedUser.quests[0].currentEventId.toString()).toBe(testQuest.events[0]._id.toString());
        });
    });

    describe('getQuestNodeEventOverrides', () => {
        beforeEach(async () => {
            // Add node event overrides to quest event
            testQuest.events[0].nodeEventOverrides = [
                {
                    nodeAddress: 'testNode123',
                    events: [
                        {
                            mobId: new mongoose.Types.ObjectId(),
                            chance: 100
                        }
                    ]
                }
            ];
            
            await testQuest.save();
        });

        it('should retrieve node event overrides for active quests', async () => {
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
}); 