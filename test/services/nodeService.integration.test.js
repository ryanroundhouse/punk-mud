const { NodeService } = require('../../src/services/nodeService');
const mongoose = require('mongoose');

// Mock dependencies that aren't part of the integration test
jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}));

// Create mock documents with Mongoose-like behavior
const createMockDocument = (data) => {
  return {
    ...data,
    toObject: () => ({ ...data })
  };
};

describe('NodeService Integration Tests', () => {
  let nodeService;
  let mockNode;
  let mockUser;
  let mockEvent;
  let mockQuestService;
  let mockStateService;
  let mockMobService;
  let mockEventService;
  let mockMessageService;
  let mockChatService;
  let mockSystemMessageService;
  let testUser;
  let startNode;
  let targetNode;
  let testEvent;
  
  beforeEach(() => {
    // Set up mock data
    testEvent = {
      _id: 'event1',
      title: 'Test Event',
      rootNode: 'event-start',
      requiresEnergy: true
    };
    
    startNode = createMockDocument({
      _id: 'start-room-id',
      name: 'Start Room',
      address: 'start-room',
      description: 'A starting room',
      isRestPoint: false,
      exits: [
        { 
          direction: 'north', 
          target: 'target-room' 
        },
        { 
          direction: 'east', 
          target: 'locked-room',
          requiredQuestId: '507f1f77bcf86cd799439011' // Random ObjectId
        }
      ],
      events: [
        { eventId: 'event1', chance: 100 }
      ]
    });
    
    targetNode = createMockDocument({
      _id: 'target-room-id',
      name: 'Target Room',
      address: 'target-room',
      description: 'A target room',
      isRestPoint: true,
      exits: [
        { 
          direction: 'south', 
          target: 'start-room' 
        }
      ]
    });
    
    const restNode = createMockDocument({
      _id: 'rest-room-id',
      name: 'Rest Room',
      address: 'rest-room',
      description: 'A resting place',
      isRestPoint: true,
      exits: []
    });
    
    const lockedRoom = createMockDocument({
      _id: 'locked-room-id',
      name: 'Locked Room',
      address: 'locked-room',
      description: 'A locked room',
      exits: [
        { direction: 'west', target: 'start-room' }
      ]
    });
    
    testUser = {
      _id: 'user1',
      username: 'testuser',
      email: 'test@example.com',
      currentNode: 'start-room',
      stats: {
        hitpoints: 100,
        currentHitpoints: 100,
        energy: 10,
        currentEnergy: 5
      }
    };
    
    // Mock Node model
    mockNode = {
      findOne: jest.fn().mockImplementation(query => {
        if (query.address === 'start-room') return Promise.resolve(startNode);
        if (query.address === 'target-room') return Promise.resolve(targetNode);
        if (query.address === 'rest-room') return Promise.resolve(restNode);
        if (query.address === 'locked-room') return Promise.resolve(lockedRoom);
        return Promise.resolve(null);
      }),
      findOneAndUpdate: jest.fn().mockResolvedValue(startNode)
    };
    
    // Mock User model
    mockUser = {
      findById: jest.fn().mockImplementation(id => {
        if (id === 'user1') return Promise.resolve(testUser);
        return Promise.resolve(null);
      }),
      findByIdAndUpdate: jest.fn().mockImplementation((id, update) => {
        if (id === 'user1') {
          testUser.stats.currentEnergy = update['stats.currentEnergy'];
          return Promise.resolve(testUser);
        }
        return Promise.resolve(null);
      })
    };
    
    // Mock Event model
    mockEvent = {
      findById: jest.fn().mockImplementation(id => {
        if (id === 'event1') return Promise.resolve(testEvent);
        return Promise.resolve(null);
      })
    };
    
    // Mock questService
    mockQuestService = {
      getQuestNodeEventOverrides: jest.fn().mockResolvedValue([]),
      getQuestNodeActorOverrides: jest.fn().mockResolvedValue([])
    };
    
    // Mock stateService
    mockStateService = {
      isUserInCombat: jest.fn().mockReturnValue(false),
      playerMobs: new Map(),
      getClient: jest.fn().mockReturnValue({ emit: jest.fn() }),
      setActiveEvent: jest.fn()
    };
    
    // Mock mobService
    mockMobService = {
      loadMobFromEvent: jest.fn().mockResolvedValue({
        instanceId: 'mob1',
        name: 'Test Mob'
      }),
      clearUserMob: jest.fn()
    };
    
    // Mock eventService
    mockEventService = {
      formatEventResponse: jest.fn().mockResolvedValue({
        message: 'Event response',
        isEnd: false
      })
    };
    
    // Mock messageService
    mockMessageService = {
      sendPlayerStatusMessage: jest.fn()
    };
    
    // Mock chatService
    mockChatService = {
      publishSystemMessage: jest.fn()
    };
    
    // Mock systemMessageService
    mockSystemMessageService = {
      publishSystemMessage: jest.fn()
    };
    
    // Create a controlled random generator for testing
    const mockRandomGenerator = jest.fn().mockReturnValue(0.5);
    
    // Instantiate the service with mocked dependencies
    nodeService = new NodeService({
      Node: mockNode,
      User: mockUser,
      Event: mockEvent,
      questService: mockQuestService,
      stateService: mockStateService,
      mobService: mockMobService,
      eventService: mockEventService,
      messageService: mockMessageService,
      chatService: mockChatService,
      systemMessageService: mockSystemMessageService,
      randomGenerator: mockRandomGenerator
    });
  });
  
  describe('getNodeByDirection', () => {
    it('should navigate from start to target room', async () => {
      // Act
      const result = await nodeService.getNodeByDirection('user1', 'north');
      
      // Assert
      expect(result).toBeDefined();
      expect(result.address).toBe('target-room');
      expect(result.name).toBe('Target Room');
    });
    
    it('should throw error when trying to navigate to a room with quest requirements', async () => {
      // Arrange - provide empty quest info
      const emptyQuestInfo = {
        activeQuestIds: [],
        completedQuestIds: [],
        completedQuestEventIds: []
      };
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection('user1', 'east', emptyQuestInfo)).rejects.toThrow('No exit to the east');
    });
    
    it('should allow navigation when user has the required quest', async () => {
      // Arrange
      const userQuestInfo = {
        activeQuestIds: ['507f1f77bcf86cd799439011'],
        completedQuestIds: [],
        completedQuestEventIds: []
      };
      
      // Act
      const result = await nodeService.getNodeByDirection('user1', 'east', userQuestInfo);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.address).toBe('locked-room');
      expect(result.name).toBe('Locked Room');
    });
    
    it('should throw error when exit does not exist', async () => {
      // Act & Assert
      await expect(nodeService.getNodeByDirection('user1', 'west')).rejects.toThrow('No exit to the west');
    });
  });
  
  describe('isRestPoint', () => {
    it('should return true for a rest node', async () => {
      // Act
      const result = await nodeService.isRestPoint('rest-room');
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false for a non-rest node', async () => {
      // Act
      const result = await nodeService.isRestPoint('start-room');
      
      // Assert
      expect(result).toBe(false);
    });
    
    it('should throw error for non-existent node', async () => {
      // Act & Assert
      await expect(nodeService.isRestPoint('non-existent')).rejects.toThrow('Node not found');
    });
  });
  
  describe('getNodeByAddress', () => {
    it('should return the node by address', async () => {
      // Act
      const result = await nodeService.getNodeByAddress('target-room');
      
      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe('Target Room');
    });
    
    it('should return null for non-existent node', async () => {
      // Act
      const result = await nodeService.getNodeByAddress('non-existent');
      
      // Assert
      expect(result).toBeNull();
    });
  });
  
  describe('selectEventByChance', () => {
    it('should select the correct event based on cumulative chance', () => {
      // Arrange
      const events = [
        { eventId: 'event1', chance: 20 },
        { eventId: 'event2', chance: 30 },
        { eventId: 'event3', chance: 50 }
      ];
      
      // Act - simulate different rolls
      const roll10Result = nodeService.selectEventByChance(events, 10);
      const roll30Result = nodeService.selectEventByChance(events, 30);
      const roll60Result = nodeService.selectEventByChance(events, 60);
      
      // Assert
      expect(roll10Result).toEqual(events[0]);
      expect(roll30Result).toEqual(events[1]);
      expect(roll60Result).toEqual(events[2]);
    });
  });
  
  describe('handleStoryEventEnergy', () => {
    it('should deduct energy when event requires it', async () => {
      // Arrange
      const storyEvent = {
        _id: 'event1',
        title: 'Test Event',
        requiresEnergy: true
      };
      
      const initialEnergy = testUser.stats.currentEnergy;
      
      // Act
      const result = await nodeService.handleStoryEventEnergy('user1', storyEvent);
      
      // Assert
      expect(result).toBe(true);
      expect(mockUser.findByIdAndUpdate).toHaveBeenCalledWith('user1', {
        'stats.currentEnergy': initialEnergy - 1
      });
      expect(testUser.stats.currentEnergy).toBe(initialEnergy - 1);
    });
  });
  
  describe('getNodeWithOverrides', () => {
    it('should retrieve node data with original events when no overrides', async () => {
      // Act
      const result = await nodeService.getNodeWithOverrides('start-room', 'user1');
      
      // Assert
      expect(result).toBeDefined();
      expect(result.address).toBe('start-room');
      expect(result.events).toBeDefined();
      expect(result.events.length).toBe(1);
      expect(result.events[0].eventId).toBe('event1');
    });
  });
  
  describe('getNodeEvent', () => {
    it('should return story event when event is triggered', async () => {
      // Act
      const result = await nodeService.getNodeEvent('user1', 'start-room');
      
      // Assert
      expect(result).toBeDefined();
      expect(result.storyEvent).toBeDefined();
      expect(result.storyEvent._id).toBe('event1');
      expect(mockStateService.setActiveEvent).toHaveBeenCalledWith(
        'user1',
        'event1',
        'event-start',
        null,
        true
      );
    });
  });
}); 