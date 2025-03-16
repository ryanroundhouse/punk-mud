const { QuestService } = require('../../src/services/questService');
const { 
    createMockUser, 
    createMockDependencies 
} = require('../helpers/mockFactory');

describe('QuestService', () => {
    // Mock data and dependencies
    let mockUser;
    let mockDeps;
    let questService;
    let mockQuests;

    beforeEach(() => {
        // Create mock dependencies
        mockDeps = createMockDependencies();
        
        // Create the mock user
        mockUser = createMockUser({
            quests: [
                {
                    questId: 'quest123',
                    currentEventId: 'event123',
                    completedEventIds: ['startEvent123'],
                    completed: false,
                    killProgress: []
                },
                {
                    questId: 'quest456',
                    currentEventId: 'event456',
                    completedEventIds: ['startEvent456'],
                    completed: true,
                    completedAt: new Date()
                }
            ]
        });

        // Mock quests data
        mockQuests = [
            {
                _id: 'quest123',
                title: 'Test Quest 1',
                events: [
                    {
                        _id: 'startEvent123',
                        isStart: true,
                        message: 'Start of quest 1',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'event123' }
                        ]
                    },
                    {
                        _id: 'event123',
                        message: 'Middle of quest 1',
                        eventType: 'chat',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'endEvent123' }
                        ],
                        hint: 'Talk to the quest giver'
                    },
                    {
                        _id: 'endEvent123',
                        message: 'End of quest 1',
                        eventType: 'chat',
                        isEnd: true,
                        choices: [],
                        rewards: [
                            { type: 'experiencePoints', value: '100' }
                        ]
                    }
                ]
            },
            {
                _id: 'quest456',
                title: 'Test Quest 2',
                events: [
                    {
                        _id: 'startEvent456',
                        isStart: true,
                        message: 'Start of quest 2',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'event456' }
                        ]
                    },
                    {
                        _id: 'event456',
                        message: 'Middle of quest 2',
                        eventType: 'chat',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'killEvent456' }
                        ]
                    },
                    {
                        _id: 'killEvent456',
                        message: 'Kill some mobs',
                        eventType: 'kill',
                        mobId: 'mob123',
                        quantity: 3,
                        hint: 'Kill [Quantity] more mobs',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'endEvent456' }
                        ]
                    },
                    {
                        _id: 'endEvent456',
                        message: 'End of quest 2',
                        eventType: 'chat',
                        isEnd: true,
                        choices: []
                    }
                ]
            },
            {
                _id: 'quest789',
                title: 'Test Quest 3',
                events: [
                    {
                        _id: 'startEvent789',
                        isStart: true,
                        actorId: 'actor123',
                        message: 'Start of quest 3',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'endEvent789' }
                        ]
                    },
                    {
                        _id: 'endEvent789',
                        message: 'End of quest 3',
                        eventType: 'chat',
                        isEnd: true,
                        choices: [],
                        rewards: [
                            { type: 'gainClass', value: 'class123' }
                        ]
                    }
                ]
            }
        ];

        // Add Quest and Class models to mockDeps
        mockDeps.Quest = {
            find: jest.fn().mockImplementation((query) => {
                if (query && query._id && query._id.$in) {
                    return Promise.resolve(
                        mockQuests.filter(q => query._id.$in.includes(q._id))
                    );
                }
                return Promise.resolve(mockQuests);
            })
        };

        mockDeps.Class = {
            findById: jest.fn().mockImplementation((id) => {
                if (id === 'class123') {
                    return Promise.resolve({
                        _id: 'class123',
                        name: 'TestClass',
                        primaryStat: 'body',
                        secondaryStat: 'reflexes',
                        baseHitpoints: 30
                    });
                }
                return Promise.resolve(null);
            })
        };

        // Mock user related functions 
        mockDeps.User.findById = jest.fn().mockImplementation((id) => {
            if (id === 'user123') {
                return Promise.resolve(JSON.parse(JSON.stringify(mockUser)));
            } else if (id === 'nonExistentUser') {
                return Promise.resolve(null);
            }
            return Promise.resolve(JSON.parse(JSON.stringify(mockUser)));
        });

        // Add userService mock
        mockDeps.userService = {
            awardExperience: jest.fn().mockResolvedValue({
                success: true,
                experienceGained: 100,
                leveledUp: false,
                newLevel: 1
            }),
            setUserClass: jest.fn().mockResolvedValue({
                success: true,
                className: 'TestClass',
                stats: { hitpoints: 50 },
                moveCount: 2
            })
        };

        // Add messageService mock
        mockDeps.messageService = {
            sendQuestsMessage: jest.fn(),
            sendSuccessMessage: jest.fn(),
            sendErrorMessage: jest.fn(),
            sendInfoMessage: jest.fn()
        };

        // Create the service instance with mocked dependencies
        questService = new QuestService(mockDeps);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getActiveQuests', () => {
        it('should return active quests for a user', async () => {
            const quests = await questService.getActiveQuests('user123');
            
            // Should find one active quest (quest123)
            expect(quests).toHaveLength(1);
            expect(quests[0].questId).toBe('quest123');
            expect(quests[0].title).toBe('Test Quest 1');
            expect(quests[0].hints).toEqual(['No hint available']);
            
            // Verify the right function was called
            expect(mockDeps.User.findById).toHaveBeenCalledWith('user123');
            expect(mockDeps.Quest.find).toHaveBeenCalled();
        });

        it('should return empty array if user not found', async () => {
            const quests = await questService.getActiveQuests('nonExistentUser');
            expect(quests).toEqual([]);
            expect(mockDeps.logger.debug).toHaveBeenCalled();
        });

        it('should throw an error if there is a problem', async () => {
            mockDeps.User.findById.mockRejectedValueOnce(new Error('Database error'));
            
            await expect(questService.getActiveQuests('user123')).rejects.toThrow('Database error');
            expect(mockDeps.logger.error).toHaveBeenCalled();
        });
    });

    describe('getUserQuestInfo', () => {
        it('should return quest information for a user', async () => {
            const questInfo = await questService.getUserQuestInfo('user123');
            
            expect(questInfo).toHaveProperty('activeQuestIds');
            expect(questInfo).toHaveProperty('completedQuestIds');
            expect(questInfo).toHaveProperty('completedQuestEventIds');
            
            expect(questInfo.activeQuestIds).toContain('quest123');
            expect(questInfo.completedQuestIds).toContain('quest456');
            expect(questInfo.completedQuestEventIds).toContain('startEvent123');
            expect(questInfo.completedQuestEventIds).toContain('startEvent456');
        });

        it('should return empty arrays if user not found', async () => {
            const questInfo = await questService.getUserQuestInfo('nonExistentUser');
            
            expect(questInfo.activeQuestIds).toEqual([]);
            expect(questInfo.completedQuestIds).toEqual([]);
            expect(questInfo.completedQuestEventIds).toEqual([]);
        });
    });

    describe('handleQuestProgression', () => {
        beforeEach(() => {
            // Mock user.save to return the user
            mockUser.save = jest.fn().mockResolvedValue(mockUser);
        });

        it('should progress a quest when completion event matches', async () => {
            // Make sure both endEvent123 and user are properly returned from mocks
            mockDeps.Quest.find = jest.fn().mockResolvedValue(mockQuests);
            mockDeps.User.findById.mockResolvedValue(mockUser);
            
            const result = await questService.handleQuestProgression(
                mockUser, 
                'actor123', 
                ['endEvent123']
            );
            
            expect(result).toEqual([{
                type: 'quest_complete',
                questTitle: 'Test Quest 1'
            }]);

            // Verify messaging service was called
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalled();
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user save was called
            expect(mockUser.save).toHaveBeenCalled();
        });

        it('should start a new quest when actor matches', async () => {
            // First, remove all quests to ensure we're testing quest start
            mockUser.quests = [];
            mockDeps.Quest.find = jest.fn().mockResolvedValue(mockQuests);
            
            const result = await questService.handleQuestProgression(
                mockUser, 
                'actor123', 
                []
            );
            
            expect(result).toEqual({
                type: 'quest_start',
                questTitle: 'Test Quest 3'
            });
            
            // Verify messaging service was called
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user save was called
            expect(mockUser.save).toHaveBeenCalled();
            
            // Verify new quest was added to user
            expect(mockUser.quests).toHaveLength(1);
            expect(mockUser.quests[0].questId).toBe('quest789');
        });

        it('should directly activate a quest when specified', async () => {
            // First, remove all quests to ensure we're testing quest activation
            mockUser.quests = [];
            
            const result = await questService.handleQuestProgression(
                mockUser, 
                'actor123', 
                [],
                'quest789'
            );
            
            expect(result).toBeTruthy();
            expect(result).toHaveProperty('type', 'quest_start');
            expect(result).toHaveProperty('questTitle', 'Test Quest 3');
            
            // Verify messaging service was called
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user save was called
            expect(mockUser.save).toHaveBeenCalled();
            
            // Verify new quest was added to user
            expect(mockUser.quests).toHaveLength(1);
            expect(mockUser.quests[0].questId).toBe('quest789');
        });

        it('should do nothing if no matching events or actors', async () => {
            const result = await questService.handleQuestProgression(
                mockUser, 
                'nonMatchingActor', 
                ['nonMatchingEvent']
            );
            
            expect(result).toBeNull();
            
            // Verify user save wasn't called
            expect(mockUser.save).not.toHaveBeenCalled();
        });

        it('should handle event rewards correctly', async () => {
            // Mock getActiveQuests to return a quest with a reward
            mockDeps.Quest.find = jest.fn().mockResolvedValue(mockQuests);
            mockDeps.User.findById.mockResolvedValue(mockUser);
            
            // Setup appropriate expectations for completion event
            mockDeps.messageService.sendSuccessMessage = jest.fn();
            mockDeps.messageService.sendQuestsMessage = jest.fn();
            mockDeps.userService.awardExperience = jest.fn().mockResolvedValue({
                success: true,
                experienceGained: 100,
                leveledUp: false,
                newLevel: 1
            });
            
            const result = await questService.handleQuestProgression(
                mockUser, 
                'actor123', 
                ['endEvent123']
            );
            
            expect(result).toBeTruthy();
            
            // Verify userService.awardExperience was called
            expect(mockDeps.userService.awardExperience).toHaveBeenCalledWith(
                'user123',
                100
            );
            
            // For this test, we only care that the success message was sent, not its exact content
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalled();
        });

        it('should award experience when completing a quest through actor interaction with rewards', async () => {
            // Setup mock data for this test
            const mockQuestWithReward = {
                _id: 'actor_quest_with_reward',
                title: 'Actor Quest With Reward',
                events: [
                    {
                        _id: 'actor_quest_start',
                        isStart: true,
                        message: 'Start of actor quest',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'actor_quest_middle' }
                        ]
                    },
                    {
                        _id: 'actor_quest_middle',
                        message: 'Middle of actor quest',
                        eventType: 'kill',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'actor_quest_end' }
                        ],
                        actorId: 'not_matching_actor'
                    },
                    {
                        _id: 'actor_quest_end',
                        message: 'End of actor quest',
                        eventType: 'chat',
                        isEnd: true,
                        actorId: 'reward_actor',
                        choices: [],
                        rewards: [
                            { type: 'experiencePoints', value: '200' }
                        ]
                    }
                ]
            };
            
            // Setup user with this quest in progress
            const userWithActorQuest = createMockUser({
                quests: [
                    {
                        questId: 'actor_quest_with_reward',
                        currentEventId: 'actor_quest_middle',
                        completedEventIds: ['actor_quest_start'],
                        completed: false
                    }
                ]
            });
            userWithActorQuest.save = jest.fn().mockResolvedValue(userWithActorQuest);
            
            // Setup mocks for this specific test
            mockDeps.Quest.find = jest.fn().mockResolvedValue([mockQuestWithReward]);
            mockDeps.userService.awardExperience = jest.fn().mockResolvedValue({
                success: true,
                experienceGained: 200,
                leveledUp: false,
                newLevel: 1
            });
            
            // Call the method - actor-based progression
            const result = await questService.handleQuestProgression(
                userWithActorQuest,
                'reward_actor',  // This should match the actorId in the quest end event
                []  // No completion events - purely actor-based
            );
            
            // Assertions
            expect(result).toBeTruthy();
            expect(result).toEqual({
                type: 'quest_progress', 
                questTitle: 'Actor Quest With Reward',
                isComplete: true,
                message: 'End of actor quest'
            });
            
            // Verify quest was marked as completed
            expect(userWithActorQuest.quests[0].completed).toBe(true);
            expect(userWithActorQuest.quests[0].completedAt).toBeDefined();
            
            // Most importantly - verify experience was awarded
            expect(mockDeps.userService.awardExperience).toHaveBeenCalledWith(
                'user123',
                200
            );
            
            // Verify appropriate messages were sent
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user was saved
            expect(userWithActorQuest.save).toHaveBeenCalled();
        });
        
        it('should not award experience when completing a quest through actor interaction without rewards', async () => {
            // Setup mock data for this test
            const mockQuestWithoutReward = {
                _id: 'actor_quest_no_reward',
                title: 'Actor Quest Without Reward',
                events: [
                    {
                        _id: 'actor_no_reward_start',
                        isStart: true,
                        message: 'Start of quest without reward',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'actor_no_reward_middle' }
                        ]
                    },
                    {
                        _id: 'actor_no_reward_middle',
                        message: 'Middle of quest without reward',
                        eventType: 'chat',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'actor_no_reward_end' }
                        ],
                        actorId: 'not_matching_actor'
                    },
                    {
                        _id: 'actor_no_reward_end',
                        message: 'End of quest without reward',
                        eventType: 'chat',
                        isEnd: true,
                        actorId: 'no_reward_actor',
                        choices: []
                        // Deliberately no rewards here
                    }
                ]
            };
            
            // Setup user with this quest in progress
            const userWithoutRewardQuest = createMockUser({
                quests: [
                    {
                        questId: 'actor_quest_no_reward',
                        currentEventId: 'actor_no_reward_middle',
                        completedEventIds: ['actor_no_reward_start'],
                        completed: false
                    }
                ]
            });
            userWithoutRewardQuest.save = jest.fn().mockResolvedValue(userWithoutRewardQuest);
            
            // Setup mocks for this specific test
            mockDeps.Quest.find = jest.fn().mockResolvedValue([mockQuestWithoutReward]);
            mockDeps.userService.awardExperience = jest.fn().mockResolvedValue({
                success: true
            });
            
            // Call the method - actor-based progression
            const result = await questService.handleQuestProgression(
                userWithoutRewardQuest,
                'no_reward_actor',  // This should match the actorId in the quest end event
                []  // No completion events - purely actor-based
            );
            
            // Assertions
            expect(result).toBeTruthy();
            expect(result).toEqual({
                type: 'quest_progress', 
                questTitle: 'Actor Quest Without Reward',
                isComplete: true,
                message: 'End of quest without reward'
            });
            
            // Verify quest was marked as completed
            expect(userWithoutRewardQuest.quests[0].completed).toBe(true);
            expect(userWithoutRewardQuest.quests[0].completedAt).toBeDefined();
            
            // Most importantly - verify experience was NOT awarded
            expect(mockDeps.userService.awardExperience).not.toHaveBeenCalled();
            
            // Verify appropriate messages were sent
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user was saved
            expect(userWithoutRewardQuest.save).toHaveBeenCalled();
        });

        it('should send messages in correct order for chat event quest completion', async () => {
            // Reset mocks to ensure clean state
            mockDeps.messageService.sendQuestsMessage.mockReset();
            mockDeps.messageService.sendSuccessMessage.mockReset();
            
            // Track message order
            const messageOrder = [];
            
            // Mock the sendQuestsMessage
            mockDeps.messageService.sendQuestsMessage = jest.fn().mockImplementation((userId, message) => {
                messageOrder.push({ type: 'quest', message });
                return Promise.resolve();
            });
            
            // Mock the sendSuccessMessage
            mockDeps.messageService.sendSuccessMessage = jest.fn().mockImplementation((userId, message) => {
                messageOrder.push({ type: 'success', message });
                return Promise.resolve();
            });
            
            // Setup mock data for this test
            const chatQuestEvent = {
                _id: 'chat_quest_end',
                message: 'Actor chat message with quest completion',
                eventType: 'chat',
                isEnd: true,
                actorId: 'chat_actor',
                choices: [],
                rewards: [
                    { type: 'experiencePoints', value: '100' }
                ]
            };
            
            const mockQuestWithChatEvent = {
                _id: 'chat_quest',
                title: 'Chat Quest Test',
                events: [
                    {
                        _id: 'chat_quest_start',
                        isStart: true,
                        message: 'Start of chat quest',
                        eventType: 'chat',
                        choices: [
                            { nextEventId: 'chat_quest_middle' }
                        ]
                    },
                    {
                        _id: 'chat_quest_middle',
                        message: 'Middle of chat quest',
                        eventType: 'chat',
                        isEnd: false,
                        choices: [
                            { nextEventId: 'chat_quest_end' }
                        ]
                    },
                    chatQuestEvent
                ]
            };
            
            // Setup user with this quest in progress
            const userWithChatQuest = createMockUser({
                quests: [
                    {
                        questId: 'chat_quest',
                        currentEventId: 'chat_quest_middle',
                        completedEventIds: ['chat_quest_start'],
                        completed: false
                    }
                ]
            });
            userWithChatQuest.save = jest.fn().mockResolvedValue(userWithChatQuest);
            
            // Setup mocks
            mockDeps.Quest.find = jest.fn().mockResolvedValue([mockQuestWithChatEvent]);
            
            // Call the method to test
            const result = await questService.handleQuestProgression(
                userWithChatQuest,
                'chat_actor',
                ['chat_quest_end']
            );
            
            // Verify we get a result
            expect(result).toBeTruthy();
            
            // Verify quest was completed
            expect(userWithChatQuest.quests[0].completed).toBe(true);
            expect(userWithChatQuest.quests[0].completedAt).toBeDefined();
            
            // Verify order of messages
            expect(messageOrder.length).toBeGreaterThanOrEqual(3);
            
            // First message should be actor's chat message
            expect(messageOrder[0].type).toBe('quest');
            expect(messageOrder[0].message).toBe('Actor chat message with quest completion');
            
            // Second message should be quest completion
            expect(messageOrder[1].type).toBe('quest');
            expect(messageOrder[1].message).toBe('Quest "Chat Quest Test" completed!');
            
            // Last message should be experience points
            expect(messageOrder[2].type).toBe('success');
            expect(messageOrder[2].message).toContain('gained 100 experience points');
            
            // Verify user was saved
            expect(userWithChatQuest.save).toHaveBeenCalled();
        });

        it('should return null when user is not provided', async () => {
            const result = await questService.handleQuestProgression(
                null, 
                'actor123', 
                ['endEvent123']
            );
            
            expect(result).toBeNull();
            expect(mockDeps.logger.error).toHaveBeenCalled();
        });
    });

    describe('handleMobKill', () => {
        beforeEach(() => {
            // Setup a quest with kill event
            mockUser.quests = [{
                questId: 'quest456',
                currentEventId: 'event456',
                completedEventIds: ['startEvent456'],
                completed: false,
                killProgress: []
            }];
            
            // Mock user.save and markModified
            mockUser.save = jest.fn().mockResolvedValue(mockUser);
            mockUser.markModified = jest.fn();
            
            // Ensure the Quest.find returns our mock quests
            mockDeps.Quest.find = jest.fn().mockResolvedValue(mockQuests);
        });

        it('should update kill progress for matching mob', async () => {
            const result = await questService.handleMobKill(mockUser, 'mob123');
            
            // We only care about the type and message, not questTitle
            expect(result[0].type).toBe('quest_progress');
            expect(result[0].message).toBe('2 more mobs remaining to kill.');
            
            // Verify kill progress was created
            expect(mockUser.quests[0].killProgress).toHaveLength(1);
            expect(mockUser.quests[0].killProgress[0].remaining).toBe(2);
            
            // Verify messaging service was called
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalled();
            
            // Verify user save was called
            expect(mockUser.save).toHaveBeenCalled();
        });

        it('should complete kill requirement when all mobs are killed', async () => {
            // Setup a quest with kill event already in progress
            mockUser.quests = [{
                questId: 'quest456',
                currentEventId: 'event456',
                completedEventIds: ['startEvent456'],
                completed: false,
                killProgress: [{
                    eventId: 'killEvent456',
                    remaining: 1 // Only one more kill needed
                }]
            }];
            
            const result = await questService.handleMobKill(mockUser, 'mob123');
            
            expect(result).toBeTruthy();
            expect(result).toHaveLength(1);
            expect(result[0]).toHaveProperty('type', 'quest_progress');
            
            // Verify current event was updated
            expect(mockUser.quests[0].currentEventId).toBe('killEvent456');
            expect(mockUser.quests[0].completedEventIds).toContain('event456');
            
            // Verify kill progress was cleared
            expect(mockUser.quests[0].killProgress).toHaveLength(0);
            
            // Verify messaging service was called
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('Kill requirement complete')
            );
            
            // Verify user save was called
            expect(mockUser.save).toHaveBeenCalled();
        });

        it('should handle non-matching mob kills', async () => {
            // Setup a quest with kill event
            mockUser.quests = [{
                questId: 'quest456',
                currentEventId: 'event456',
                completedEventIds: ['startEvent456'],
                completed: false,
                killProgress: []
            }];
            
            const result = await questService.handleMobKill(mockUser, 'differentMob');
            
            // No updates should be performed
            expect(result).toHaveLength(0);
            
            // Verify kill progress wasn't created
            expect(mockUser.quests[0].killProgress).toHaveLength(0);
            
            // Verify messaging service wasn't called
            expect(mockDeps.messageService.sendQuestsMessage).not.toHaveBeenCalled();
            
            // Verify user save wasn't called - no changes
            expect(mockUser.save).not.toHaveBeenCalled();
        });

        it('should send quest messages separate from combat messages', async () => {
            // Reset message service mocks to track call order
            mockDeps.messageService.sendQuestsMessage.mockReset();
            mockDeps.messageService.sendSuccessMessage.mockReset();
            
            // Setup a quest with kill event
            mockUser.quests = [{
                questId: 'quest456',
                currentEventId: 'event456',
                completedEventIds: ['startEvent456'],
                completed: false,
                killProgress: [{
                    eventId: 'killEvent456',
                    remaining: 2 // Two more kills needed
                }]
            }];
            
            const result = await questService.handleMobKill(mockUser, 'mob123');
            
            // Verify result contains quest update info but no combat info
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('quest_progress');
            expect(result[0].message).toBe('1 more mobs remaining to kill.');
            expect(result[0]).not.toHaveProperty('combat');
            expect(result[0]).not.toHaveProperty('damage');
            
            // Verify quest message was sent with correct text
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalledTimes(1);
            expect(mockDeps.messageService.sendQuestsMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('Quest "Test Quest 2": 1 more mobs remaining to kill.')
            );
            
            // Verify quest message doesn't contain combat information
            const questMessage = mockDeps.messageService.sendQuestsMessage.mock.calls[0][1];
            expect(questMessage).not.toContain('attack');
            expect(questMessage).not.toContain('hits for');
            expect(questMessage).not.toContain('has been defeated');
            expect(questMessage).not.toContain('Victory');
            
            // Verify user was saved
            expect(mockUser.save).toHaveBeenCalled();
        });
    });

    describe('getQuestNodeEventOverrides', () => {
        beforeEach(() => {
            // Create a more complex quest to test node overrides
            mockQuests[0].events[1].nodeEventOverrides = [
                {
                    nodeAddress: 'testNode123',
                    events: [
                        {
                            mobId: 'specialMob123',
                            chance: 80
                        },
                        {
                            eventId: 'specialEvent123',
                            chance: 20
                        }
                    ]
                }
            ];
        });

        it('should return event overrides for matching node', async () => {
            const overrides = await questService.getQuestNodeEventOverrides('user123', 'testNode123');
            
            expect(overrides).toBeTruthy();
            expect(overrides).toHaveLength(2);
            expect(overrides[0]).toHaveProperty('mobId', 'specialMob123');
            expect(overrides[0]).toHaveProperty('chance', 80);
            expect(overrides[1]).toHaveProperty('eventId', 'specialEvent123');
            expect(overrides[1]).toHaveProperty('chance', 20);
        });

        it('should return null for non-matching node', async () => {
            const overrides = await questService.getQuestNodeEventOverrides('user123', 'nonExistentNode');
            
            expect(overrides).toBeNull();
        });

        it('should return null when user has no active quests', async () => {
            // Mock empty quests array
            mockUser.quests = [];
            
            const overrides = await questService.getQuestNodeEventOverrides('user123', 'testNode123');
            
            expect(overrides).toBeNull();
        });
    });

    describe('getQuestNodeActorOverrides', () => {
        beforeEach(() => {
            // Modify active quest to test actor overrides
            mockUser.quests[0].events = [
                {
                    _id: 'event123',
                    nodeActorOverrides: [
                        {
                            nodeAddress: 'testNode123',
                            actorId: 'specialActor123'
                        }
                    ]
                }
            ];
            
            // Mock getActiveQuests to return quests with overrides
            const mockActiveQuests = [{
                questId: 'quest123',
                currentEventId: 'event123',
                title: 'Test Quest',
                events: [
                    {
                        _id: 'event123',
                        nodeActorOverrides: [
                            {
                                nodeAddress: 'testNode123',
                                actorId: 'specialActor123'
                            }
                        ]
                    }
                ]
            }];
            
            questService.getActiveQuests = jest.fn().mockResolvedValue(mockActiveQuests);
        });

        it('should return actor overrides for matching node', async () => {
            const overrides = await questService.getQuestNodeActorOverrides('user123', 'testNode123');
            
            expect(overrides).toEqual(['specialActor123']);
        });

        it('should return null for non-matching node', async () => {
            const overrides = await questService.getQuestNodeActorOverrides('user123', 'nonExistentNode');
            
            expect(overrides).toBeNull();
        });
    });

    describe('handleEventRewards', () => {
        it('should process class reward correctly', async () => {
            const event = {
                rewards: [
                    {
                        type: 'gainClass',
                        value: 'class123'
                    }
                ]
            };
            
            await questService.handleEventRewards(mockUser, event);
            
            // Verify userService.setUserClass was called
            expect(mockDeps.userService.setUserClass).toHaveBeenCalledWith(
                'user123',
                'class123'
            );
            
            // Verify success message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('gained the TestClass class')
            );
        });

        it('should process experience points reward correctly', async () => {
            const event = {
                rewards: [
                    {
                        type: 'experiencePoints',
                        value: '100'
                    }
                ]
            };
            
            await questService.handleEventRewards(mockUser, event);
            
            // Verify userService.awardExperience was called
            expect(mockDeps.userService.awardExperience).toHaveBeenCalledWith(
                'user123',
                100
            );
            
            // Verify success message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('gained 100 experience points')
            );
        });

        it('should do nothing if event has no rewards', async () => {
            const event = { message: 'No rewards here' };
            
            await questService.handleEventRewards(mockUser, event);
            
            // Verify no service methods were called
            expect(mockDeps.userService.setUserClass).not.toHaveBeenCalled();
            expect(mockDeps.userService.awardExperience).not.toHaveBeenCalled();
            expect(mockDeps.messageService.sendSuccessMessage).not.toHaveBeenCalled();
        });

        it('should handle errors gracefully', async () => {
            const event = {
                rewards: [
                    {
                        type: 'experiencePoints',
                        value: '100'
                    }
                ]
            };
            
            // Force an error
            mockDeps.userService.awardExperience.mockRejectedValueOnce(new Error('Service error'));
            
            await questService.handleEventRewards(mockUser, event);
            
            // Verify error was logged
            expect(mockDeps.logger.error).toHaveBeenCalled();
        });
    });
}); 