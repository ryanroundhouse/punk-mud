const mongoose = require('mongoose');
const { getCharacterQuests, calculateExpProgress } = require('../../src/controllers/characterController');

// Mock models and dependencies
jest.mock('../../src/models/User', () => ({
    findById: jest.fn()
}));

// Mock Quest model
jest.mock('mongoose', () => {
    const mockFind = jest.fn();
    const mockPopulate = jest.fn();
    
    const questModelMock = {
        find: mockFind,
        populate: mockPopulate
    };
    
    // Set up the chain for fluent API
    mockFind.mockReturnValue(questModelMock);
    mockPopulate.mockReturnValue(questModelMock);
    
    const originalModule = jest.requireActual('mongoose');
    return {
        ...originalModule,
        model: jest.fn().mockImplementation((modelName) => {
            if (modelName === 'Quest') {
                return questModelMock;
            }
            return null;
        }),
        Types: {
            ...originalModule.Types,
            ObjectId: jest.fn().mockImplementation((id) => {
                // Return the id for string comparison in tests
                return {
                    toString: () => id
                };
            })
        }
    };
});

const User = require('../../src/models/User');
const logger = require('../../src/config/logger');

// Mock logger
jest.mock('../../src/config/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
}));

describe('Character Controller', () => {
    let req, res, statusStub, jsonStub, questModel;

    beforeEach(() => {
        // Setup request and response objects
        req = {
            user: { userId: 'user123' },
            params: {}
        };
        
        jsonStub = jest.fn();
        statusStub = jest.fn().mockReturnValue({ json: jsonStub });
        res = {
            json: jsonStub,
            status: statusStub
        };
        
        // Setup Quest model mock
        questModel = mongoose.model('Quest');
        
        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('getCharacterQuests', () => {
        it('should return 404 if user is not found', async () => {
            User.findById.mockResolvedValue(null);
            
            await getCharacterQuests(req, res);
            
            expect(statusStub).toHaveBeenCalledWith(404);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'User not found' });
        });

        it('should return empty arrays if user has no quests', async () => {
            const mockUser = {
                _id: 'user123',
                quests: []
            };
            
            User.findById.mockResolvedValue(mockUser);
            
            await getCharacterQuests(req, res);
            
            expect(jsonStub).toHaveBeenCalledWith({
                active: [],
                completed: []
            });
            expect(questModel.find).not.toHaveBeenCalled();
        });

        it('should return formatted active quests with choice hints', async () => {
            // Use valid 24-character hex strings for ObjectIds
            const eventStartId = '507f1f77bcf86cd799439011';
            const nextEventId = '507f1f77bcf86cd799439022';
            
            // Mock the events for the quest with ID 'quest123'
            const mockQuestEvents = [
                {
                    _id: eventStartId,
                    eventType: 'stage',
                    hint: 'Start hint',
                    isStart: true,
                    choices: [
                        { nextEventId: nextEventId }
                    ]
                },
                {
                    _id: nextEventId,
                    eventType: 'kill',
                    hint: 'Kill 3 enemies',
                    mobId: { name: 'Cyber Thug' },
                    quantity: 3
                }
            ];
            
            // Mock user with an active quest
            const mockUser = {
                _id: 'user123',
                quests: [
                    {
                        questId: 'quest123',
                        currentEventId: eventStartId,
                        completed: false,
                        progress: 30
                    }
                ]
            };
            
            // Mock quest document from the database
            const mockQuest = {
                _id: 'quest123',
                title: 'Test Quest',
                journalDescription: 'This is a test quest',
                events: mockQuestEvents
            };
            
            User.findById.mockResolvedValue(mockUser);
            questModel.populate.mockResolvedValueOnce([mockQuest]);
            
            await getCharacterQuests(req, res);
            
            expect(questModel.find).toHaveBeenCalled();
            
            expect(jsonStub).toHaveBeenCalledWith({
                active: [
                    {
                        questId: 'quest123',
                        title: 'Test Quest',
                        journalDescription: 'This is a test quest',
                        currentEventId: eventStartId,
                        choiceHints: [
                            {
                                eventId: nextEventId,
                                hint: 'Kill 3 enemies'
                            }
                        ],
                        progress: 30
                    }
                ],
                completed: []
            });
        });

        it('should create fallback hints for events without hints', async () => {
            // Use valid 24-character hex strings for ObjectIds
            const eventStartId = '507f1f77bcf86cd799439033';
            const killEventId = '507f1f77bcf86cd799439044';
            
            // Mock the events for the quest with ID 'quest123'
            const mockQuestEvents = [
                {
                    _id: eventStartId,
                    eventType: 'stage',
                    isStart: true,
                    choices: [
                        { nextEventId: killEventId }
                    ]
                },
                {
                    _id: killEventId,
                    eventType: 'kill',
                    // No hint provided
                    mobId: { name: 'Cyber Thug' },
                    quantity: 3
                }
            ];
            
            // Mock user with an active quest
            const mockUser = {
                _id: 'user123',
                quests: [
                    {
                        questId: 'quest123',
                        currentEventId: eventStartId,
                        completed: false,
                        progress: 0
                    }
                ]
            };
            
            // Mock quest document from the database
            const mockQuest = {
                _id: 'quest123',
                title: 'Test Quest',
                journalDescription: 'This is a test quest',
                events: mockQuestEvents
            };
            
            User.findById.mockResolvedValue(mockUser);
            questModel.populate.mockResolvedValueOnce([mockQuest]);
            
            await getCharacterQuests(req, res);
            
            // Verify fallback hint was created for kill event
            const response = jsonStub.mock.calls[0][0];
            expect(response.active[0].choiceHints[0].hint).toBe('Defeat 3 Cyber Thug.');
        });

        it('should return completed quests with completed event hints', async () => {
            // Use valid 24-character hex strings for ObjectIds
            const event1Id = '507f1f77bcf86cd799439055';
            const event2Id = '507f1f77bcf86cd799439066';
            const finalEventId = '507f1f77bcf86cd799439077';
            
            // Mock the events for the quest
            const mockQuestEvents = [
                {
                    _id: event1Id,
                    eventType: 'stage',
                    hint: 'First completed event',
                    isStart: true
                },
                {
                    _id: event2Id,
                    eventType: 'kill',
                    hint: 'Kill quest completed',
                    isEnd: false
                },
                {
                    _id: finalEventId,
                    eventType: 'chat',
                    hint: 'Final reward conversation',
                    isEnd: true
                }
            ];
            
            // Mock user with a completed quest
            const mockUser = {
                _id: 'user123',
                quests: [
                    {
                        questId: 'completedquest',
                        currentEventId: finalEventId,
                        completed: true,
                        completedEventIds: [event1Id, event2Id],
                        completedAt: new Date('2023-01-15')
                    }
                ]
            };
            
            // Mock quest document from the database
            const mockQuest = {
                _id: 'completedquest',
                title: 'Completed Quest',
                journalDescription: 'This quest is complete',
                events: mockQuestEvents
            };
            
            User.findById.mockResolvedValue(mockUser);
            questModel.populate.mockResolvedValueOnce([mockQuest]);
            
            await getCharacterQuests(req, res);
            
            expect(jsonStub).toHaveBeenCalledWith({
                active: [],
                completed: [
                    {
                        questId: 'completedquest',
                        title: 'Completed Quest',
                        journalDescription: 'This quest is complete',
                        completedHints: [
                            {
                                eventId: event1Id,
                                hint: 'First completed event'
                            },
                            {
                                eventId: event2Id,
                                hint: 'Kill quest completed'
                            },
                            {
                                eventId: finalEventId,
                                hint: 'Final reward conversation'
                            }
                        ],
                        dateCompleted: mockUser.quests[0].completedAt
                    }
                ]
            });
        });

        it('should handle multiple quests of different states', async () => {
            // Use valid 24-character hex strings for ObjectIds
            const activeEventId = '507f1f77bcf86cd799439077';
            const nextEventId = '507f1f77bcf86cd799439088';
            const completedEventId = '507f1f77bcf86cd799439099';
            
            // Mock user with both active and completed quests
            const mockUser = {
                _id: 'user123',
                quests: [
                    {
                        questId: 'activequest',
                        currentEventId: activeEventId,
                        completed: false,
                        progress: 50
                    },
                    {
                        questId: 'completedquest',
                        completed: true,
                        completedEventIds: [completedEventId],
                        completedAt: new Date('2023-01-15')
                    }
                ]
            };
            
            // Mock quest documents
            const mockQuests = [
                {
                    _id: 'activequest',
                    title: 'Active Quest',
                    journalDescription: 'This quest is active',
                    events: [
                        {
                            _id: activeEventId,
                            eventType: 'chat',
                            choices: [
                                { nextEventId: nextEventId }
                            ]
                        },
                        {
                            _id: nextEventId,
                            eventType: 'stage',
                            hint: 'Next stage hint'
                        }
                    ]
                },
                {
                    _id: 'completedquest',
                    title: 'Completed Quest',
                    journalDescription: 'This quest is completed',
                    events: [
                        {
                            _id: completedEventId,
                            eventType: 'stage',
                            hint: 'Completed hint'
                        }
                    ]
                }
            ];
            
            User.findById.mockResolvedValue(mockUser);
            questModel.populate.mockResolvedValueOnce(mockQuests);
            
            await getCharacterQuests(req, res);
            
            // Get response from the jsonStub mock function
            expect(jsonStub).toHaveBeenCalled();
            const response = jsonStub.mock.calls[0][0];
            
            // Verify both active and completed quests
            expect(response).toHaveProperty('active');
            expect(response).toHaveProperty('completed');
            expect(response.active.length).toBe(1);
            expect(response.completed.length).toBe(1);
            expect(response.active[0].title).toBe('Active Quest');
            expect(response.completed[0].title).toBe('Completed Quest');
        });

        it('should handle database errors gracefully', async () => {
            const error = new Error('Database error');
            User.findById.mockRejectedValue(error);
            
            await getCharacterQuests(req, res);
            
            expect(logger.error).toHaveBeenCalledWith('Error fetching character quests:', error);
            expect(statusStub).toHaveBeenCalledWith(500);
            expect(jsonStub).toHaveBeenCalledWith({ error: 'Error fetching character quests' });
        });

        it('should replace [Quantity] token in kill quest hints with remaining count', async () => {
            // Use valid 24-character hex strings for ObjectIds
            const eventStartId = '507f1f77bcf86cd799439011';
            const killEventId = '507f1f77bcf86cd799439022';
            
            // Mock the events for the quest with ID 'quest123'
            const mockQuestEvents = [
                {
                    _id: eventStartId,
                    eventType: 'stage',
                    hint: 'Start hint',
                    isStart: true,
                    choices: [
                        { nextEventId: killEventId }
                    ]
                },
                {
                    _id: killEventId,
                    eventType: 'kill',
                    hint: 'Kill [Quantity] cyber drunks behind Neon Ramen Haven.',
                    mobId: { name: 'Cyber Thug' },
                    quantity: 3
                }
            ];
            
            // Mock user with an active quest and kill progress
            const mockUser = {
                _id: 'user123',
                quests: [
                    {
                        questId: 'quest123',
                        currentEventId: eventStartId,
                        completed: false,
                        progress: 30,
                        killProgress: [
                            {
                                eventId: killEventId,
                                remaining: 2
                            }
                        ]
                    }
                ]
            };
            
            // Mock quest document from the database
            const mockQuest = {
                _id: 'quest123',
                title: 'Test Quest',
                journalDescription: 'This is a test quest',
                events: mockQuestEvents
            };
            
            User.findById.mockResolvedValue(mockUser);
            questModel.populate.mockResolvedValueOnce([mockQuest]);
            
            await getCharacterQuests(req, res);
            
            // Verify [Quantity] was replaced with remaining kill count
            const response = jsonStub.mock.calls[0][0];
            expect(response.active[0].choiceHints[0].hint).toBe('Kill 2 cyber drunks behind Neon Ramen Haven.');
        });
    });
}); 