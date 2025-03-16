const { EventService } = require('../../src/services/eventService');
const logger = require('../../src/config/logger');

// Mock dependencies
jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../src/services/eventChoiceProcessor', () => ({
  processEventChoice: jest.fn()
}));

jest.mock('../../src/services/eventStateManager', () => ({
  getActiveEvent: jest.fn(),
  setActiveEvent: jest.fn(),
  clearActiveEvent: jest.fn(),
  isInEvent: jest.fn()
}));

// Import mocked modules
const eventChoiceProcessor = require('../../src/services/eventChoiceProcessor');
const eventStateManager = require('../../src/services/eventStateManager');

describe('EventService', () => {
  let service;
  let mockLogger;
  let mockEvent;
  let mockUser;
  let mockEventNodeService;
  let mockEventStateManager;
  let mockEventChoiceProcessor;
  let mockStateService;
  let mockQuestService;
  let mockSocket;
  
  beforeEach(() => {
    // Create mock dependencies
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    
    mockUser = function() {};
    mockUser.findById = jest.fn();
    
    mockEvent = function() {};
    mockEvent.find = jest.fn();
    
    mockSocket = {
      emit: jest.fn()
    };
    
    mockEventNodeService = {
      validateNodeStructure: jest.fn(node => node),
      ensureConsistentQuestEvents: jest.fn(),
      loadNodeFromDatabase: jest.fn()
    };
    
    mockEventStateManager = {
      getActiveEvent: jest.fn(),
      setActiveEvent: jest.fn(),
      clearActiveEvent: jest.fn(),
      isInEvent: jest.fn(),
      getClientSocket: jest.fn()
    };
    
    mockEventChoiceProcessor = {
      processEventChoice: jest.fn(),
      filterChoicesByRestrictions: jest.fn()
    };
    
    mockStateService = {};
    
    mockQuestService = {
      handleQuestProgression: jest.fn()
    };
    
    // Initialize service with mocked dependencies
    service = new EventService({
      logger: mockLogger,
      Event: mockEvent,
      User: mockUser,
      eventNodeService: mockEventNodeService,
      eventStateManager: mockEventStateManager,
      eventChoiceProcessor: mockEventChoiceProcessor,
      stateService: mockStateService,
      questService: mockQuestService
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('handleActorChat', () => {
    it('should process existing event if user is already in one', async () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 10 } };
      const actor = { _id: 'actor123', name: 'Actor Name' };
      const activeEvent = { eventId: 'event123', currentNode: {} };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      const handleExistingEventSpy = jest.spyOn(service, 'handleExistingEvent')
        .mockResolvedValue({ message: 'Existing event response' });
      
      // Act
      const result = await service.handleActorChat(user, actor);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith('user123');
      expect(handleExistingEventSpy).toHaveBeenCalledWith('user123', activeEvent);
      expect(result).toEqual({ message: 'Existing event response' });
    });
    
    it('should find and filter available events', async () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 10 } };
      const actor = { _id: 'actor123', name: 'Actor Name' };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(null);
      
      const events = [
        { _id: 'event1', title: 'Event 1', rootNode: { requiredQuestId: null } },
        { _id: 'event2', title: 'Event 2', rootNode: { requiredQuestId: 'quest1' } }
      ];
      
      const findAvailableEventsSpy = jest.spyOn(service, 'findAvailableEvents')
        .mockResolvedValue([events[0]]);
        
      const startEventSpy = jest.spyOn(service, 'startEvent')
        .mockResolvedValue({ message: 'Event started' });
      
      // Act
      const result = await service.handleActorChat(user, actor);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith('user123');
      expect(findAvailableEventsSpy).toHaveBeenCalledWith(user, actor);
      expect(startEventSpy).toHaveBeenCalledWith('user123', events[0]);
      expect(result).toEqual({ message: 'Event started' });
    });
    
    it('should check energy requirements for events', async () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 0 } };
      const actor = { _id: 'actor123', name: 'Actor Name' };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(null);
      
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        rootNode: { requiredQuestId: null },
        requiresEnergy: true
      };
      
      const findAvailableEventsSpy = jest.spyOn(service, 'findAvailableEvents')
        .mockResolvedValue([event]);
        
      const hasEnoughEnergySpy = jest.spyOn(service, 'hasEnoughEnergyForEvent')
        .mockReturnValue(false);
        
      const handleInsufficientEnergySpy = jest.spyOn(service, 'handleInsufficientEnergy')
        .mockReturnValue(false);
      
      // Act
      const result = await service.handleActorChat(user, actor);
      
      // Assert
      expect(findAvailableEventsSpy).toHaveBeenCalledWith(user, actor);
      expect(hasEnoughEnergySpy).toHaveBeenCalledWith(user, event);
      expect(handleInsufficientEnergySpy).toHaveBeenCalledWith(user);
      expect(result).toBe(false);
    });
    
    it('should return null if no available events are found', async () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 10 } };
      const actor = { _id: 'actor123', name: 'Actor Name' };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(null);
      
      const findAvailableEventsSpy = jest.spyOn(service, 'findAvailableEvents')
        .mockResolvedValue([]);
      
      // Act
      const result = await service.handleActorChat(user, actor);
      
      // Assert
      expect(findAvailableEventsSpy).toHaveBeenCalledWith(user, actor);
      expect(result).toBeNull();
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 10 } };
      const actor = { _id: 'actor123', name: 'Actor Name' };
      
      mockEventStateManager.getActiveEvent.mockImplementation(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = await service.handleActorChat(user, actor);
      
      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error handling actor chat:',
        expect.any(Error)
      );
      expect(result).toBeNull();
    });
  });
  
  describe('handleExistingEvent', () => {
    it('should process existing event and clear state if result is null', async () => {
      // Arrange
      const userId = 'user123';
      const activeEvent = { eventId: 'event123', currentNode: {} };
      
      mockEventChoiceProcessor.processEventChoice.mockResolvedValue(null);
      
      // Act
      const result = await service.handleExistingEvent(userId, activeEvent);
      
      // Assert
      expect(mockEventChoiceProcessor.processEventChoice).toHaveBeenCalledWith(
        userId, activeEvent, null
      );
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
    
    it('should return valid result and not clear state', async () => {
      // Arrange
      const userId = 'user123';
      const activeEvent = { eventId: 'event123', currentNode: {} };
      const expectedResult = { message: 'Event response' };
      
      mockEventChoiceProcessor.processEventChoice.mockResolvedValue(expectedResult);
      
      // Act
      const result = await service.handleExistingEvent(userId, activeEvent);
      
      // Assert
      expect(mockEventChoiceProcessor.processEventChoice).toHaveBeenCalledWith(
        userId, activeEvent, null
      );
      expect(mockEventStateManager.clearActiveEvent).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });
  });
  
  describe('hasEnoughEnergyForEvent', () => {
    it('should return false if user has insufficient energy for event that requires it', () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 0 } };
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        requiresEnergy: true
      };
      
      // Act
      const result = service.hasEnoughEnergyForEvent(user, event);
      
      // Assert
      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalled();
    });
    
    it('should return true if user has sufficient energy', () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 1 } };
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        requiresEnergy: true
      };
      
      // Act
      const result = service.hasEnoughEnergyForEvent(user, event);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return true if event does not require energy', () => {
      // Arrange
      const user = { _id: 'user123', stats: { currentEnergy: 0 } };
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        requiresEnergy: false
      };
      
      // Act
      const result = service.hasEnoughEnergyForEvent(user, event);
      
      // Assert
      expect(result).toBe(true);
    });
  });
  
  describe('handleInsufficientEnergy', () => {
    it('should send message to client socket and return false', () => {
      // Arrange
      const user = { _id: 'user123' };
      
      mockEventStateManager.getClientSocket.mockReturnValue(mockSocket);
      
      // Act
      const result = service.handleInsufficientEnergy(user);
      
      // Assert
      expect(mockEventStateManager.getClientSocket).toHaveBeenCalledWith('user123');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'console response',
        expect.objectContaining({
          type: 'info',
          message: expect.stringContaining("too tired")
        })
      );
      expect(result).toBe(false);
    });
    
    it('should return false even if no socket is available', () => {
      // Arrange
      const user = { _id: 'user123' };
      
      mockEventStateManager.getClientSocket.mockReturnValue(null);
      
      // Act
      const result = service.handleInsufficientEnergy(user);
      
      // Assert
      expect(mockEventStateManager.getClientSocket).toHaveBeenCalledWith('user123');
      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });
  
  describe('findAvailableEvents', () => {
    it('should query database and filter events', async () => {
      // Arrange
      const user = { 
        _id: 'user123',
        quests: [
          { questId: 'quest1', completed: false }
        ]
      };
      const actor = { _id: 'actor123' };
      
      const events = [
        { 
          _id: 'event1', 
          title: 'Event 1', 
          rootNode: { 
            requiredQuestId: null 
          }
        },
        { 
          _id: 'event2', 
          title: 'Event 2', 
          rootNode: { 
            requiredQuestId: { 
              _id: 'quest1' 
            } 
          }
        }
      ];
      
      mockEvent.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(events)
        })
      });
      
      const isEventAvailableSpy = jest.spyOn(service, 'isEventAvailable')
        .mockImplementation((event) => event.rootNode.requiredQuestId === null);
      
      // Act
      const result = await service.findAvailableEvents(user, actor);
      
      // Assert
      expect(mockEvent.find).toHaveBeenCalledWith({ actorId: 'actor123' });
      expect(isEventAvailableSpy).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('event1');
    });
  });
  
  describe('isEventAvailable', () => {
    it('should return true if event has no required quest', () => {
      // Arrange
      const user = { _id: 'user123' };
      const event = { 
        _id: 'event1', 
        rootNode: { 
          requiredQuestId: null 
        }
      };
      
      // Act
      const result = service.isEventAvailable(event, user);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false if required quest is not active', () => {
      // Arrange
      const user = { 
        _id: 'user123',
        quests: [
          { questId: 'quest2', completed: false }
        ]
      };
      const event = { 
        _id: 'event1', 
        rootNode: { 
          requiredQuestId: { 
            _id: 'quest1' 
          } 
        }
      };
      
      // Act
      const result = service.isEventAvailable(event, user);
      
      // Assert
      expect(result).toBe(false);
    });
    
    it('should check for required quest event ID if specified', () => {
      // Arrange
      const user = { 
        _id: 'user123',
        quests: [
          { questId: 'quest1', completed: false, currentEventId: 'event5' }
        ]
      };
      const event = { 
        _id: 'event1', 
        rootNode: { 
          requiredQuestId: { 
            _id: 'quest1' 
          },
          requiredQuestEventId: 'event5'
        }
      };
      
      const isUserOnRequiredQuestEventSpy = jest.spyOn(service, 'isUserOnRequiredQuestEvent')
        .mockReturnValue(true);
      
      // Act
      const result = service.isEventAvailable(event, user);
      
      // Assert
      expect(isUserOnRequiredQuestEventSpy).toHaveBeenCalledWith(user, event);
      expect(result).toBe(true);
    });
  });
  
  describe('isUserOnRequiredQuestEvent', () => {
    it('should return true if user is on the required quest event', () => {
      // Arrange
      const user = { 
        quests: [
          { questId: 'quest1', completed: false, currentEventId: 'event5' }
        ]
      };
      const event = { 
        _id: 'event1', 
        rootNode: { 
          requiredQuestId: { 
            _id: 'quest1' 
          },
          requiredQuestEventId: 'event5'
        }
      };
      
      // Act
      const result = service.isUserOnRequiredQuestEvent(user, event);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false if user is on a different quest event', () => {
      // Arrange
      const user = { 
        quests: [
          { questId: 'quest1', completed: false, currentEventId: 'event6' }
        ]
      };
      const event = { 
        _id: 'event1', 
        rootNode: { 
          requiredQuestId: { 
            _id: 'quest1' 
          },
          requiredQuestEventId: 'event5'
        }
      };
      
      // Act
      const result = service.isUserOnRequiredQuestEvent(user, event);
      
      // Assert
      expect(result).toBe(false);
    });
  });
  
  describe('startEvent', () => {
    it('should validate node structure and set active event', async () => {
      // Arrange
      const userId = 'user123';
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        actorId: 'actor123',
        rootNode: { 
          prompt: 'Test prompt',
          choices: []
        }
      };
      
      const user = { 
        _id: 'user123',
        class: { name: 'Hunter' }
      };
      
      mockUser.findById.mockResolvedValue(user);
      mockEventNodeService.validateNodeStructure.mockReturnValue(event.rootNode);
      
      const passesNodeRestrictionsSpy = jest.spyOn(service, 'passesNodeRestrictions')
        .mockReturnValue(true);
        
      const handleQuestActivationSpy = jest.spyOn(service, 'handleQuestActivation')
        .mockResolvedValue(null);
        
      const formatEventResponseSpy = jest.spyOn(service, 'formatEventResponse')
        .mockResolvedValue({ message: 'Event response' });
      
      // Act
      const result = await service.startEvent(userId, event);
      
      // Assert
      expect(mockEventNodeService.validateNodeStructure).toHaveBeenCalledWith(event.rootNode);
      expect(mockEventNodeService.ensureConsistentQuestEvents).toHaveBeenCalledWith(event.rootNode);
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(passesNodeRestrictionsSpy).toHaveBeenCalledWith(event.rootNode, user);
      expect(mockEventStateManager.setActiveEvent).toHaveBeenCalledWith(
        userId, event._id, event.rootNode, event.actorId
      );
      expect(handleQuestActivationSpy).toHaveBeenCalledWith(userId, event.rootNode, event.actorId);
      expect(formatEventResponseSpy).toHaveBeenCalledWith(event.rootNode, userId);
      expect(result).toEqual({ message: 'Event response' });
    });
    
    it('should return null if user is not found', async () => {
      // Arrange
      const userId = 'user123';
      const event = { 
        _id: 'event1', 
        title: 'Event 1', 
        rootNode: { 
          prompt: 'Test prompt',
          choices: []
        }
      };
      
      mockUser.findById.mockResolvedValue(null);
      mockEventNodeService.validateNodeStructure.mockReturnValue(event.rootNode);
      
      // Act
      const result = await service.startEvent(userId, event);
      
      // Assert
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'User not found when starting event:',
        expect.objectContaining({ userId })
      );
      expect(result).toBeNull();
    });
    
    it('should return null if node restrictions are not passed', async () => {
      // Arrange
      const userId = 'user123';
      const event = { 
        _id: 'event1', 
        title: 'Event 1',
        rootNode: { 
          prompt: 'Test prompt',
          choices: [],
          restrictions: ['enforcerOnly']
        }
      };
      
      const user = { 
        _id: 'user123',
        class: { name: 'Hunter' }
      };
      
      mockUser.findById.mockResolvedValue(user);
      mockEventNodeService.validateNodeStructure.mockReturnValue(event.rootNode);
      
      const passesNodeRestrictionsSpy = jest.spyOn(service, 'passesNodeRestrictions')
        .mockReturnValue(false);
      
      // Act
      const result = await service.startEvent(userId, event);
      
      // Assert
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(passesNodeRestrictionsSpy).toHaveBeenCalledWith(event.rootNode, user);
      expect(result).toBeNull();
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      const userId = 'user123';
      const event = { 
        _id: 'event1', 
        title: 'Event 1',
        rootNode: {}
      };
      
      mockEventNodeService.validateNodeStructure.mockImplementation(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = await service.startEvent(userId, event);
      
      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error starting event:',
        expect.any(Error)
      );
      expect(result).toBeNull();
    });
  });
  
  describe('passesNodeRestrictions', () => {
    it('should return true if no restrictions are present', () => {
      // Arrange
      const node = { prompt: 'Test prompt' };
      const user = { _id: 'user123' };
      
      // Act
      const result = service.passesNodeRestrictions(node, user);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false for noClass restriction if user has a class', () => {
      // Arrange
      const node = { 
        prompt: 'Test prompt',
        restrictions: ['noClass']
      };
      const user = { 
        _id: 'user123',
        class: { name: 'Hunter' }
      };
      
      // Act
      const result = service.passesNodeRestrictions(node, user);
      
      // Assert
      expect(result).toBe(false);
    });
    
    it('should return true for noClass restriction if user has no class', () => {
      // Arrange
      const node = { 
        prompt: 'Test prompt',
        restrictions: ['noClass']
      };
      const user = { 
        _id: 'user123',
        class: null
      };
      
      // Act
      const result = service.passesNodeRestrictions(node, user);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return true for enforcerOnly restriction if user is an enforcer', () => {
      // Arrange
      const node = { 
        prompt: 'Test prompt',
        restrictions: ['enforcerOnly']
      };
      const user = { 
        _id: 'user123',
        class: { name: 'Enforcer' }
      };
      
      // Act
      const result = service.passesNodeRestrictions(node, user);
      
      // Assert
      expect(result).toBe(true);
    });
    
    it('should return false for enforcerOnly restriction if user is not an enforcer', () => {
      // Arrange
      const node = { 
        prompt: 'Test prompt',
        restrictions: ['enforcerOnly']
      };
      const user = { 
        _id: 'user123',
        class: { name: 'Hunter' }
      };
      
      // Act
      const result = service.passesNodeRestrictions(node, user);
      
      // Assert
      expect(result).toBe(false);
    });
  });
  
  describe('handleQuestActivation', () => {
    it('should activate quest if specified in the node', async () => {
      // Arrange
      const userId = 'user123';
      const actorId = 'actor123';
      const node = { 
        activateQuestId: { 
          _id: 'quest1',
          title: 'Test Quest'
        }
      };
      
      const user = { 
        _id: 'user123',
        _id: { toString: () => 'user123' }
      };
      
      mockUser.findById.mockResolvedValue(user);
      
      // Act
      await service.handleQuestActivation(userId, node, actorId);
      
      // Assert
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(mockQuestService.handleQuestProgression).toHaveBeenCalledWith(
        user, actorId, [], node.activateQuestId._id
      );
    });
    
    it('should return null if user is not found', async () => {
      // Arrange
      const userId = 'user123';
      const actorId = 'actor123';
      const node = { 
        activateQuestId: { 
          _id: 'quest1',
          title: 'Test Quest'
        }
      };
      
      mockUser.findById.mockResolvedValue(null);
      
      // Act
      const result = await service.handleQuestActivation(userId, node, actorId);
      
      // Assert
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'User not found when activating quest:',
        expect.objectContaining({ userId })
      );
      expect(result).toBeNull();
    });
    
    it('should do nothing if no activateQuestId is specified', async () => {
      // Arrange
      const userId = 'user123';
      const actorId = 'actor123';
      const node = { 
        prompt: 'Test prompt'
      };
      
      // Act
      await service.handleQuestActivation(userId, node, actorId);
      
      // Assert
      expect(mockUser.findById).not.toHaveBeenCalled();
      expect(mockQuestService.handleQuestProgression).not.toHaveBeenCalled();
    });
  });
  
  describe('handleEventChoice', () => {
    it('should delegate to eventChoiceProcessor', async () => {
      // Arrange
      const userId = 'user123';
      const choice = '1';
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false,
        currentNode: { prompt: 'Test prompt' }
      };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      mockEventChoiceProcessor.processEventChoice.mockResolvedValue({
        message: 'Choice processed',
        hasChoices: false,
        isEnd: true
      });
      
      // Act
      const result = await service.handleEventChoice(userId, choice);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(mockEventChoiceProcessor.processEventChoice).toHaveBeenCalledWith(
        userId,
        activeEvent,
        choice
      );
      expect(result).toEqual({
        message: 'Choice processed',
        hasChoices: false,
        isEnd: true
      });
    });
    
    it('should return null if no active event is found', async () => {
      // Arrange
      const userId = 'user123';
      const choice = '1';
      
      mockEventStateManager.getActiveEvent.mockReturnValue(null);
      
      // Act
      const result = await service.handleEventChoice(userId, choice);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(mockEventChoiceProcessor.processEventChoice).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      const userId = 'user123';
      const choice = '1';
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false,
        currentNode: { prompt: 'Test prompt' }
      };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      mockEventChoiceProcessor.processEventChoice.mockRejectedValue(new Error('Processing error'));
      
      // Act
      const result = await service.handleEventChoice(userId, choice);
      
      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
  
  describe('formatEventResponse', () => {
    it('should format node with no choices', async () => {
      // Arrange
      const userId = 'user123';
      const node = {
        prompt: 'Test prompt with no choices'
      };
      
      // Act
      const result = await service.formatEventResponse(node, userId);
      
      // Assert
      expect(result).toEqual({
        message: 'Test prompt with no choices',
        hasChoices: false,
        isEnd: true
      });
    });
    
    it('should format node with valid choices', async () => {
      // Arrange
      const userId = 'user123';
      const node = {
        prompt: 'Test prompt with choices',
        choices: [
          { text: 'Choice 1' },
          { text: 'Choice 2' }
        ]
      };
      
      const user = { _id: 'user123' };
      const validChoices = [
        { choice: { text: 'Choice 1' } },
        { choice: { text: 'Choice 2' } }
      ];
      
      mockUser.findById.mockResolvedValue(user);
      mockEventChoiceProcessor.filterChoicesByRestrictions.mockReturnValue(validChoices);
      
      // Act
      const result = await service.formatEventResponse(node, userId);
      
      // Assert
      expect(mockUser.findById).toHaveBeenCalledWith(userId);
      expect(mockEventChoiceProcessor.filterChoicesByRestrictions).toHaveBeenCalledWith(
        node.choices, user
      );
      expect(result).toEqual({
        message: 'Test prompt with choices\n\nResponses:\n1. Choice 1\n2. Choice 2',
        hasChoices: true,
        isEnd: false
      });
    });
    
    it('should handle case with no valid choices', async () => {
      // Arrange
      const userId = 'user123';
      const node = {
        prompt: 'Test prompt with choices',
        choices: [
          { text: 'Choice 1' },
          { text: 'Choice 2' }
        ]
      };
      
      const user = { _id: 'user123' };
      
      mockUser.findById.mockResolvedValue(user);
      mockEventChoiceProcessor.filterChoicesByRestrictions.mockReturnValue([]);
      
      // Act
      const result = await service.formatEventResponse(node, userId);
      
      // Assert
      expect(result).toEqual({
        message: 'Test prompt with choices',
        hasChoices: false,
        isEnd: true
      });
    });
  });
  
  describe('isInEvent', () => {
    it('should delegate to eventStateManager', () => {
      // Arrange
      const userId = 'user123';
      mockEventStateManager.isInEvent.mockReturnValue(true);
      
      // Act
      const result = service.isInEvent(userId);
      
      // Assert
      expect(mockEventStateManager.isInEvent).toHaveBeenCalledWith(userId);
      expect(result).toBe(true);
    });
  });
  
  describe('processEventInput', () => {
    it('should process input for active event', async () => {
      // Arrange
      const userId = 'user123';
      const input = '1';
      const activeEvent = {
        eventId: 'event123',
        currentNode: { _id: 'node123' },
        isStoryEvent: false
      };
      
      const currentNodeFromDb = {
        _id: 'node123',
        prompt: 'Updated prompt',
        choices: [{ text: 'Updated choice' }]
      };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      mockEventNodeService.loadNodeFromDatabase.mockResolvedValue(currentNodeFromDb);
      
      const handleEventChoiceSpy = jest.spyOn(service, 'handleEventChoice')
        .mockResolvedValue({ message: 'Choice processed' });
      
      // Act
      const result = await service.processEventInput(userId, input);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(mockEventNodeService.loadNodeFromDatabase).toHaveBeenCalledWith(
        'event123', 'node123'
      );
      expect(handleEventChoiceSpy).toHaveBeenCalledWith(userId, input);
      expect(result).toEqual({ message: 'Choice processed' });
    });
    
    it('should fall back to stored node if database node not found', async () => {
      // Arrange
      const userId = 'user123';
      const input = '1';
      const activeEvent = {
        eventId: 'event123',
        currentNode: { _id: 'node123' },
        isStoryEvent: false
      };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      mockEventNodeService.loadNodeFromDatabase.mockResolvedValue(null);
      
      const handleEventChoiceSpy = jest.spyOn(service, 'handleEventChoice')
        .mockResolvedValue({ message: 'Choice processed' });
      
      // Act
      const result = await service.processEventInput(userId, input);
      
      // Assert
      expect(mockEventNodeService.loadNodeFromDatabase).toHaveBeenCalledWith(
        'event123', 'node123'
      );
      expect(mockLogger.error).toHaveBeenCalled();
      expect(handleEventChoiceSpy).toHaveBeenCalledWith(userId, input);
      expect(result).toEqual({ message: 'Choice processed' });
    });
    
    it('should return null if no active event is found', async () => {
      // Arrange
      const userId = 'user123';
      const input = '1';
      
      mockEventStateManager.getActiveEvent.mockReturnValue(null);
      
      // Act
      const result = await service.processEventInput(userId, input);
      
      // Assert
      expect(mockEventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      const userId = 'user123';
      const input = '1';
      const activeEvent = {
        eventId: 'event123',
        currentNode: { _id: 'node123' },
        isStoryEvent: false
      };
      
      mockEventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      mockEventNodeService.loadNodeFromDatabase.mockRejectedValue(new Error('Database error'));
      
      // Act
      const result = await service.processEventInput(userId, input);
      
      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
}); 