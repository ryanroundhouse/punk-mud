const stateService = require('../../src/services/stateService');
const eventStateManager = require('../../src/services/eventStateManager');
const logger = require('../../src/config/logger');

// Mock the logger and eventStateManager
jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../src/services/eventStateManager', () => ({
  getActiveEvent: jest.fn(),
  setActiveEvent: jest.fn(),
  clearActiveEvent: jest.fn(),
  isInEvent: jest.fn(),
  setClientSocket: jest.fn(),
  removeClientSocket: jest.fn(),
  addUserToRoom: jest.fn(),
  removeUserFromRoom: jest.fn()
}));

describe('StateService to EventStateManager Delegation', () => {
  // Mock data
  const userId = '123456789012345678901234';
  const eventId = '234567890123456789012345';
  const node = {
    prompt: 'Test prompt',
    choices: [{ text: 'Choice 1' }]
  };
  const actorId = '345678901234567890123456';
  const socketId = 'socket123';
  const nodeId = 'room123';
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });
  
  describe('Event State Management', () => {
    it('should delegate getActiveEvent to EventStateManager', () => {
      // Setup mock return value
      const mockEvent = { userId, eventId, currentNode: node };
      eventStateManager.getActiveEvent.mockReturnValueOnce(mockEvent);
      
      // Test
      const result = stateService.getActiveEvent(userId);
      
      // Verify
      expect(eventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(result).toBe(mockEvent);
    });
    
    it('should delegate setActiveEvent to EventStateManager', () => {
      // Setup mock return value
      const mockEventState = { userId, eventId, currentNode: node };
      eventStateManager.setActiveEvent.mockReturnValueOnce(mockEventState);
      
      // Test
      const result = stateService.setActiveEvent(userId, eventId, node, actorId, false);
      
      // Verify
      expect(eventStateManager.setActiveEvent).toHaveBeenCalledWith(userId, eventId, node, actorId, false);
      expect(result).toBe(mockEventState);
    });
    
    it('should delegate clearActiveEvent to EventStateManager', () => {
      // Test
      stateService.clearActiveEvent(userId);
      
      // Verify
      expect(eventStateManager.clearActiveEvent).toHaveBeenCalledWith(userId);
    });
    
    it('should delegate isInEvent to EventStateManager', () => {
      // Setup mock return value
      eventStateManager.isInEvent.mockReturnValueOnce(true);
      
      // Test
      const result = stateService.isInEvent(userId);
      
      // Verify
      expect(eventStateManager.isInEvent).toHaveBeenCalledWith(userId);
      expect(result).toBe(true);
    });
    
    it('should delegate isInStoryEvent to EventStateManager', () => {
      // Setup mock return value
      const mockEvent = { userId, eventId, currentNode: node, isStoryEvent: true };
      eventStateManager.getActiveEvent.mockReturnValueOnce(mockEvent);
      
      // Test
      const result = stateService.isInStoryEvent(userId);
      
      // Verify
      expect(eventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
      expect(result).toBe(true);
    });
  });
  
  describe('Client and Room Management', () => {
    it('should delegate client socket management to EventStateManager when adding a client', () => {
      // Setup
      const mockSocket = { id: socketId };
      
      // Test
      stateService.addClient(userId, mockSocket);
      
      // Verify
      expect(eventStateManager.setClientSocket).toHaveBeenCalledWith(userId, mockSocket);
    });
    
    it('should delegate client socket management to EventStateManager when removing a client', () => {
      // Test
      stateService.removeClient(userId);
      
      // Verify
      expect(eventStateManager.removeClientSocket).toHaveBeenCalledWith(userId);
    });
    
    it('should delegate room management to EventStateManager when adding a user to a node', () => {
      // Setup
      const mockSocket = { id: socketId };
      stateService.clients.set(userId, mockSocket);
      
      // Test
      stateService.addUserToNode(userId, nodeId);
      
      // Verify
      expect(eventStateManager.addUserToRoom).toHaveBeenCalledWith(userId, nodeId, socketId);
    });
    
    it('should delegate room management to EventStateManager when removing a user from a node', () => {
      // Test
      stateService.removeUserFromNode(userId, nodeId);
      
      // Verify
      expect(eventStateManager.removeUserFromRoom).toHaveBeenCalledWith(userId, nodeId);
    });
  });
}); 