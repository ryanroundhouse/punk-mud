const { NodeService } = require('../../src/services/nodeService');
const logger = require('../../src/config/logger');

// Mock dependencies
jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}));

describe('NodeService', () => {
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
  
  // Setup before each test
  beforeEach(() => {
    // Mock Node model
    mockNode = {
      findOne: jest.fn(),
      findById: jest.fn()
    };
    
    // Mock User model
    mockUser = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn()
    };
    
    // Mock Event model
    mockEvent = {
      findById: jest.fn()
    };
    
    // Mock questService
    mockQuestService = {
      getQuestNodeEventOverrides: jest.fn(),
      getQuestNodeActorOverrides: jest.fn()
    };
    
    // Mock stateService
    mockStateService = {
      isUserInCombat: jest.fn(),
      playerMobs: new Map(),
      getClient: jest.fn(),
      setActiveEvent: jest.fn()
    };
    
    // Mock mobService
    mockMobService = {
      loadMobFromEvent: jest.fn(),
      clearUserMob: jest.fn()
    };
    
    // Mock eventService
    mockEventService = {
      formatEventResponse: jest.fn()
    };
    
    // Mock messageService
    mockMessageService = {
      sendPlayerStatusMessage: jest.fn()
    };
    
    // Mock chatService
    mockChatService = {
      publishSystemMessage: jest.fn()
    };
    
    // Create a controlled random generator for testing
    const mockRandomGenerator = jest.fn();
    
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
      randomGenerator: mockRandomGenerator
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('getNodeByDirection', () => {
    const userId = 'user123';
    const direction = 'north';
    
    it('should throw an error if user is not found', async () => {
      // Arrange
      mockUser.findById.mockResolvedValue(null);
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection(userId, direction)).rejects.toThrow('User not found or missing location');
    });
    
    it('should throw an error if user has no currentNode', async () => {
      // Arrange
      mockUser.findById.mockResolvedValue({ _id: userId });
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection(userId, direction)).rejects.toThrow('User not found or missing location');
    });
    
    it('should throw an error if current node is not found', async () => {
      // Arrange
      mockUser.findById.mockResolvedValue({ _id: userId, currentNode: 'room1' });
      mockNode.findOne.mockResolvedValue(null);
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection(userId, direction)).rejects.toThrow('Current location not found');
    });
    
    it('should throw an error if no exit in the requested direction', async () => {
      // Arrange
      mockUser.findById.mockResolvedValue({ _id: userId, currentNode: 'room1' });
      mockNode.findOne.mockResolvedValue({
        address: 'room1',
        exits: [{ direction: 'south', target: 'room2' }]
      });
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection(userId, direction)).rejects.toThrow('No exit to the north');
    });
    
    it('should successfully return target node when exit exists', async () => {
      // Arrange
      const targetNode = { address: 'room2', name: 'Target Room' };
      mockUser.findById.mockResolvedValue({ _id: userId, currentNode: 'room1' });
      mockNode.findOne.mockImplementation(async (query) => {
        if (query.address === 'room1') {
          return {
            address: 'room1',
            exits: [{ direction: 'north', target: 'room2' }]
          };
        } else if (query.address === 'room2') {
          return targetNode;
        }
        return null;
      });
      
      // Mock getNodeWithOverrides
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue(targetNode);
      
      // Act
      const result = await nodeService.getNodeByDirection(userId, direction);
      
      // Assert
      expect(result).toEqual(targetNode);
      expect(nodeService.getNodeWithOverrides).toHaveBeenCalledWith('room2', userId);
    });
    
    it('should check quest requirements if exit has them', async () => {
      // Arrange
      const userQuestInfo = {
        activeQuestIds: ['quest1'],
        completedQuestIds: [],
        completedQuestEventIds: ['event1']
      };
      
      mockUser.findById.mockResolvedValue({ _id: userId, currentNode: 'room1' });
      mockNode.findOne.mockImplementation(async (query) => {
        if (query.address === 'room1') {
          return {
            address: 'room1',
            exits: [{ 
              direction: 'north', 
              target: 'room2',
              requiredQuestId: 'quest1',
              requiredQuestEventId: 'event1'
            }]
          };
        } else if (query.address === 'room2') {
          return { 
            address: 'room2', 
            name: 'Target Room',
            toObject: jest.fn().mockReturnValue({
              address: 'room2',
              name: 'Target Room'
            })
          };
        }
        return null;
      });
      
      // Mock isExitAccessible to return true
      jest.spyOn(nodeService, 'isExitAccessible').mockReturnValue(true);
      
      // Mock getNodeWithOverrides to return the target node
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue({ 
        address: 'room2', 
        name: 'Target Room' 
      });
      
      // Act
      const result = await nodeService.getNodeByDirection(userId, direction, userQuestInfo);
      
      // Assert
      expect(result).toEqual({ address: 'room2', name: 'Target Room' });
      expect(nodeService.isExitAccessible).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'north',
          target: 'room2',
          requiredQuestId: 'quest1',
          requiredQuestEventId: 'event1'
        }),
        userQuestInfo
      );
    });
    
    it('should throw error if required quest is missing', async () => {
      // Arrange
      const userQuestInfo = {
        activeQuestIds: ['quest2'],
        completedQuestIds: [],
        completedQuestEventIds: []
      };
      
      mockUser.findById.mockResolvedValue({ _id: userId, currentNode: 'room1' });
      mockNode.findOne.mockResolvedValue({
        address: 'room1',
        exits: [{ 
          direction: 'north', 
          target: 'room2',
          requiredQuestId: 'quest1'
        }]
      });
      
      // Act & Assert
      await expect(nodeService.getNodeByDirection(userId, direction, userQuestInfo))
        .rejects.toThrow('No exit to the north');
    });
  });
  
  describe('getNodeWithOverrides', () => {
    const userId = 'user123';
    const address = 'room1';
    
    it('should throw an error if node is not found', async () => {
      // Arrange
      mockNode.findOne.mockResolvedValue(null);
      
      // Act & Assert
      await expect(nodeService.getNodeWithOverrides(address, userId)).rejects.toThrow('Node not found');
    });
    
    it('should return node with quest event overrides if available', async () => {
      // Arrange
      const originalNode = {
        address,
        name: 'Test Room',
        events: [{ eventId: 'event1', chance: 100 }],
        toObject: jest.fn().mockReturnValue({
          address,
          name: 'Test Room',
          events: [{ eventId: 'event1', chance: 100 }]
        })
      };
      
      const questOverrideEvents = [
        { eventId: 'quest-event1', chance: 100 }
      ];
      
      mockNode.findOne.mockResolvedValue(originalNode);
      mockQuestService.getQuestNodeEventOverrides.mockResolvedValue(questOverrideEvents);
      mockQuestService.getQuestNodeActorOverrides.mockResolvedValue([]);
      
      // Act
      const result = await nodeService.getNodeWithOverrides(address, userId);
      
      // Assert
      expect(result.events).toEqual(questOverrideEvents);
      expect(mockQuestService.getQuestNodeEventOverrides).toHaveBeenCalledWith(userId, address);
    });
    
    it('should return node with quest actor overrides if available', async () => {
      // Arrange
      const originalNode = {
        address,
        name: 'Test Room',
        actors: [{ actorId: 'actor1', type: 'npc' }],
        toObject: jest.fn().mockReturnValue({
          address,
          name: 'Test Room',
          actors: [{ actorId: 'actor1', type: 'npc' }]
        })
      };
      
      const questOverrideActors = [
        { actorId: 'quest-actor1', type: 'quest-npc', overrideType: 'add' }
      ];
      
      mockNode.findOne.mockResolvedValue(originalNode);
      mockQuestService.getQuestNodeEventOverrides.mockResolvedValue([]);
      mockQuestService.getQuestNodeActorOverrides.mockResolvedValue(questOverrideActors);
      
      // Act
      const result = await nodeService.getNodeWithOverrides(address, userId);
      
      // Assert
      expect(result.actors).toEqual(questOverrideActors);
      expect(mockQuestService.getQuestNodeActorOverrides).toHaveBeenCalledWith(userId, address);
    });
  });
  
  describe('selectEventByChance', () => {
    it('should select the correct event based on roll value', () => {
      // Arrange
      const events = [
        { eventId: 'event1', chance: 20 },
        { eventId: 'event2', chance: 30 },
        { eventId: 'event3', chance: 50 }
      ];
      
      // Act & Assert - first event
      expect(nodeService.selectEventByChance(events, 10)).toEqual(events[0]);
      
      // Act & Assert - second event
      expect(nodeService.selectEventByChance(events, 30)).toEqual(events[1]);
      
      // Act & Assert - third event
      expect(nodeService.selectEventByChance(events, 60)).toEqual(events[2]);
      
      // Act & Assert - boundary case
      expect(nodeService.selectEventByChance(events, 20)).toEqual(events[1]);
      
      // Act & Assert - over 100
      expect(nodeService.selectEventByChance(events, 110)).toBeNull();
    });
    
    it('should return null if no events match', () => {
      // Arrange
      const events = [];
      
      // Act & Assert
      expect(nodeService.selectEventByChance(events, 50)).toBeNull();
    });
  });
  
  describe('isRestPoint', () => {
    it('should return true if node is a rest point', async () => {
      // Arrange
      mockNode.findOne.mockResolvedValue({ address: 'room1', isRestPoint: true });
      
      // Act
      const result = await nodeService.isRestPoint('room1');
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false if node is not a rest point', async () => {
      // Arrange
      mockNode.findOne.mockResolvedValue({ address: 'room1', isRestPoint: false });
      
      // Act
      const result = await nodeService.isRestPoint('room1');
      
      // Assert
      expect(result).toBe(false);
    });
    
    it('should throw an error if node is not found', async () => {
      // Arrange
      mockNode.findOne.mockResolvedValue(null);
      
      // Act & Assert
      await expect(nodeService.isRestPoint('room1')).rejects.toThrow('Node not found');
    });
  });
  
  describe('handleStoryEventEnergy', () => {
    const userId = 'user123';
    
    it('should return true if event does not require energy', async () => {
      // Arrange
      const storyEvent = { 
        _id: 'event1', 
        title: 'Test Event',
        requiresEnergy: false 
      };
      
      // Act
      const result = await nodeService.handleStoryEventEnergy(userId, storyEvent);
      
      // Assert
      expect(result).toBe(true);
      expect(mockUser.findById).not.toHaveBeenCalled();
    });
    
    it('should return false if user has insufficient energy', async () => {
      // Arrange
      const storyEvent = { 
        _id: 'event1', 
        title: 'Test Event',
        requiresEnergy: true 
      };
      
      const mockSocket = { emit: jest.fn() };
      
      mockUser.findById.mockResolvedValue({
        _id: userId,
        stats: { currentEnergy: 0, energy: 10, currentHitpoints: 100, hitpoints: 100 }
      });
      
      mockStateService.getClient.mockReturnValue(mockSocket);
      
      // Act
      const result = await nodeService.handleStoryEventEnergy(userId, storyEvent);
      
      // Assert
      expect(result).toBe(false);
      expect(mockSocket.emit).toHaveBeenCalled();
      expect(mockUser.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    
    it('should deduct energy and return true if user has enough energy', async () => {
      // Arrange
      const storyEvent = { 
        _id: 'event1', 
        title: 'Test Event',
        requiresEnergy: true 
      };
      
      const user = {
        _id: userId,
        stats: { 
          currentEnergy: 5, 
          energy: 10, 
          currentHitpoints: 100, 
          hitpoints: 100 
        }
      };
      
      mockUser.findById.mockResolvedValue(user);
      
      // Act
      const result = await nodeService.handleStoryEventEnergy(userId, storyEvent);
      
      // Assert
      expect(result).toBe(true);
      expect(mockUser.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        'stats.currentEnergy': 4
      });
      expect(mockMessageService.sendPlayerStatusMessage).toHaveBeenCalled();
    });
  });
  
  describe('getNodeEvent', () => {
    const userId = 'user123';
    const nodeAddress = 'room1';
    
    it('should return empty result if user is in combat', async () => {
      // Arrange
      const node = {
        address: nodeAddress,
        events: [{ eventId: 'event1', chance: 100 }]
      };
      
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue(node);
      mockStateService.isUserInCombat.mockReturnValue(true);
      
      // Act
      const result = await nodeService.getNodeEvent(userId, nodeAddress);
      
      // Assert
      expect(result).toEqual({ mobSpawn: null, storyEvent: null });
      expect(mockMobService.clearUserMob).not.toHaveBeenCalled();
    });
    
    it('should return empty result if node has no events', async () => {
      // Arrange
      const node = {
        address: nodeAddress,
        events: []
      };
      
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue(node);
      mockStateService.isUserInCombat.mockReturnValue(false);
      
      // Act
      const result = await nodeService.getNodeEvent(userId, nodeAddress);
      
      // Assert
      expect(result).toEqual({ mobSpawn: null, storyEvent: null });
      expect(mockMobService.clearUserMob).toHaveBeenCalledWith(userId);
    });
    
    it('should load mob if mob event is selected', async () => {
      // Arrange
      const node = {
        address: nodeAddress,
        events: [{ mobId: 'mob1', chance: 100 }]
      };
      
      const mobInstance = {
        instanceId: 'instance1',
        name: 'Test Mob'
      };
      
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue(node);
      jest.spyOn(nodeService, 'selectEventByChance').mockReturnValue(node.events[0]);
      mockStateService.isUserInCombat.mockReturnValue(false);
      mockMobService.loadMobFromEvent.mockResolvedValue(mobInstance);
      nodeService.randomGenerator = jest.fn().mockReturnValue(0.5);
      
      // Act
      const result = await nodeService.getNodeEvent(userId, nodeAddress);
      
      // Assert
      expect(result).toEqual({ mobSpawn: mobInstance, storyEvent: null });
      expect(mockMobService.clearUserMob).toHaveBeenCalledWith(userId);
      expect(mockMobService.loadMobFromEvent).toHaveBeenCalledWith(node.events[0]);
      expect(mockStateService.playerMobs.get(userId)).toEqual(mobInstance);
      expect(mockChatService.publishSystemMessage).toHaveBeenCalled();
    });
    
    it('should start story event if story event is selected', async () => {
      // Arrange
      const node = {
        address: nodeAddress,
        events: [{ eventId: 'event1', chance: 100 }]
      };
      
      const storyEvent = {
        _id: 'event1',
        title: 'Test Event',
        rootNode: 'root1',
        requiresEnergy: false
      };
      
      const formattedResponse = {
        message: 'Event content',
        isEnd: false
      };
      
      const mockSocket = { emit: jest.fn() };
      
      jest.spyOn(nodeService, 'getNodeWithOverrides').mockResolvedValue(node);
      jest.spyOn(nodeService, 'selectEventByChance').mockReturnValue(node.events[0]);
      jest.spyOn(nodeService, 'handleStoryEventEnergy').mockResolvedValue(true);
      mockStateService.isUserInCombat.mockReturnValue(false);
      mockEvent.findById.mockResolvedValue(storyEvent);
      mockStateService.getClient.mockReturnValue(mockSocket);
      mockEventService.formatEventResponse.mockResolvedValue(formattedResponse);
      nodeService.randomGenerator = jest.fn().mockReturnValue(0.5);
      
      // Act
      const result = await nodeService.getNodeEvent(userId, nodeAddress);
      
      // Assert
      expect(result).toEqual({ mobSpawn: null, storyEvent });
      expect(mockStateService.setActiveEvent).toHaveBeenCalledWith(
        userId,
        storyEvent._id,
        storyEvent.rootNode,
        null,
        true
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('console response', {
        type: 'event',
        message: formattedResponse.message,
        isEndOfEvent: formattedResponse.isEnd
      });
    });
  });
}); 