const eventService = require('../../src/services/eventService');
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
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });
  
  describe('handleEventChoice', () => {
    it('should delegate to eventChoiceProcessor', async () => {
      const userId = 'user123';
      const choice = '1';
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false,
        currentNode: { prompt: 'Test prompt' }
      };
      
      eventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      eventChoiceProcessor.processEventChoice.mockResolvedValue({
        message: 'Choice processed',
        hasChoices: false,
        isEnd: true
      });
      
      const result = await eventService.handleEventChoice(userId, choice);
      
      expect(eventChoiceProcessor.processEventChoice).toHaveBeenCalledWith(
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
    
    it('should handle errors from eventChoiceProcessor', async () => {
      const userId = 'user123';
      const choice = '1';
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false,
        currentNode: { prompt: 'Test prompt' }
      };
      
      eventStateManager.getActiveEvent.mockReturnValue(activeEvent);
      eventChoiceProcessor.processEventChoice.mockRejectedValue(new Error('Processing error'));
      
      await eventService.handleEventChoice(userId, choice);
      
      expect(logger.error).toHaveBeenCalled();
    });
  });
}); 