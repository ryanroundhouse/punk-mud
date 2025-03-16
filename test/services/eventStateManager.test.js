const eventStateManager = require('../../src/services/eventStateManager');
const { EventStateManager } = require('../../src/services/eventStateManager');
const logger = require('../../src/config/logger');

// Mock the logger
jest.mock('../../src/config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}));

describe('EventStateManager', () => {
  let eventStateManager;
  
  // Mock data
  const userId = '123456789012345678901234';
  const eventId = '234567890123456789012345';
  const node = {
    prompt: 'Test prompt',
    choices: [{ text: 'Choice 1' }]
  };
  const actorId = '345678901234567890123456';
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create a new instance for each test
    eventStateManager = new EventStateManager();
  });
  
  describe('getActiveEvent', () => {
    it('should return null when no active event exists', () => {
      const result = eventStateManager.getActiveEvent(userId);
      
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Getting active event'),
        expect.objectContaining({ userId })
      );
    });
    
    it('should return the active event when it exists', () => {
      // Setup
      eventStateManager.setActiveEvent(userId, eventId, node, actorId);
      
      // Test
      const result = eventStateManager.getActiveEvent(userId);
      
      // Verify
      expect(result).toEqual(expect.objectContaining({
        userId,
        eventId,
        actorId,
        isStoryEvent: false,
        nodeHistory: expect.any(Array)
      }));
      
      // Check that currentNode has expected properties
      expect(result.currentNode).toEqual(expect.objectContaining({
        _id: expect.any(String),
        prompt: node.prompt,
        choices: node.choices
      }));
      
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Getting active event'),
        expect.objectContaining({ userId, exists: true })
      );
    });
  });
  
  describe('setActiveEvent', () => {
    it('should set the active event', () => {
      // Test
      eventStateManager.setActiveEvent(userId, eventId, node, actorId);
      
      // Verify
      const result = eventStateManager.getActiveEvent(userId);
      expect(result).toEqual(expect.objectContaining({
        userId,
        eventId,
        actorId,
        isStoryEvent: false,
        nodeHistory: expect.any(Array)
      }));
      
      // Check that currentNode has expected properties
      expect(result.currentNode).toEqual(expect.objectContaining({
        _id: expect.any(String),
        prompt: node.prompt,
        choices: node.choices
      }));
      
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Setting active event'),
        expect.objectContaining({ userId, eventId })
      );
    });
    
    it('should set the active event with isStoryEvent flag', () => {
      // Test
      eventStateManager.setActiveEvent(userId, eventId, node, actorId, true);
      
      // Verify
      const result = eventStateManager.getActiveEvent(userId);
      expect(result).toEqual(expect.objectContaining({
        userId,
        eventId,
        actorId,
        isStoryEvent: true,
        nodeHistory: expect.any(Array)
      }));
      
      // Check that currentNode has expected properties
      expect(result.currentNode).toEqual(expect.objectContaining({
        _id: expect.any(String),
        prompt: node.prompt,
        choices: node.choices
      }));
    });
    
    it('should update an existing active event', () => {
      // Setup - initial event
      eventStateManager.setActiveEvent(userId, eventId, node, actorId);
      
      // Test - update with new node
      const newNode = { prompt: 'New prompt' };
      eventStateManager.setActiveEvent(userId, eventId, newNode, actorId);
      
      // Verify
      const result = eventStateManager.getActiveEvent(userId);
      expect(result.currentNode).toEqual(expect.objectContaining({
        _id: expect.any(String),
        prompt: 'New prompt'
      }));
    });
  });
  
  describe('clearActiveEvent', () => {
    it('should clear the active event', () => {
      // Setup
      eventStateManager.setActiveEvent(userId, eventId, node, actorId);
      
      // Test
      eventStateManager.clearActiveEvent(userId);
      
      // Verify
      const result = eventStateManager.getActiveEvent(userId);
      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Clearing active event'),
        expect.objectContaining({ userId })
      );
    });
    
    it('should not throw an error when clearing a non-existent event', () => {
      // Test
      expect(() => {
        eventStateManager.clearActiveEvent('nonexistentUserId');
      }).not.toThrow();
    });
  });
  
  describe('isInEvent', () => {
    it('should return false when user is not in an event', () => {
      // Test
      const result = eventStateManager.isInEvent(userId);
      
      // Verify
      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Checking if user is in event'),
        expect.objectContaining({ userId, inEvent: false })
      );
    });
    
    it('should return true when user is in an event', () => {
      // Setup
      eventStateManager.setActiveEvent(userId, eventId, node, actorId);
      
      // Test
      const result = eventStateManager.isInEvent(userId);
      
      // Verify
      expect(result).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Checking if user is in event'),
        expect.objectContaining({ userId, inEvent: true })
      );
    });
  });
  
  describe('getClientSocket', () => {
    it('should return null when no socket exists', () => {
      // Test
      const result = eventStateManager.getClientSocket(userId);
      
      // Verify
      expect(result).toBeNull();
    });
    
    it('should return the socket when it exists', () => {
      // Setup
      const mockSocket = { emit: jest.fn() };
      eventStateManager.setClientSocket(userId, mockSocket);
      
      // Test
      const result = eventStateManager.getClientSocket(userId);
      
      // Verify
      expect(result).toBe(mockSocket);
    });
  });
  
  describe('getUsersInRoom', () => {
    it('should return an empty array when no users are in the room', () => {
      // Test
      const result = eventStateManager.getUsersInRoom('roomId');
      
      // Verify
      expect(result).toEqual([]);
    });
    
    it('should return an array of users in the room', () => {
      // Setup
      const roomId = 'testRoom';
      const user1 = { userId: 'user1', socketId: 'socket1' };
      const user2 = { userId: 'user2', socketId: 'socket2' };
      
      // Add users to the room
      eventStateManager.addUserToRoom(user1.userId, roomId, user1.socketId);
      eventStateManager.addUserToRoom(user2.userId, roomId, user2.socketId);
      
      // Test
      const result = eventStateManager.getUsersInRoom(roomId);
      
      // Verify
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining(user1),
        expect.objectContaining(user2)
      ]));
    });
    
    it('should not return users from different rooms', () => {
      // Setup
      const room1 = 'room1';
      const room2 = 'room2';
      const user1 = { userId: 'user1', socketId: 'socket1' };
      const user2 = { userId: 'user2', socketId: 'socket2' };
      
      // Add users to different rooms
      eventStateManager.addUserToRoom(user1.userId, room1, user1.socketId);
      eventStateManager.addUserToRoom(user2.userId, room2, user2.socketId);
      
      // Test
      const result = eventStateManager.getUsersInRoom(room1);
      
      // Verify
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining(user1));
    });
  });
  
  describe('addUserToRoom', () => {
    it('should add a user to a room', () => {
      // Setup
      const roomId = 'testRoom';
      const userId = 'testUser';
      const socketId = 'testSocket';
      
      // Test
      eventStateManager.addUserToRoom(userId, roomId, socketId);
      
      // Verify
      const usersInRoom = eventStateManager.getUsersInRoom(roomId);
      expect(usersInRoom).toHaveLength(1);
      expect(usersInRoom[0]).toEqual(expect.objectContaining({
        userId,
        socketId
      }));
    });
  });
  
  describe('removeUserFromRoom', () => {
    it('should remove a user from a room', () => {
      // Setup
      const roomId = 'testRoom';
      const userId = 'testUser';
      const socketId = 'testSocket';
      eventStateManager.addUserToRoom(userId, roomId, socketId);
      
      // Test
      eventStateManager.removeUserFromRoom(userId, roomId);
      
      // Verify
      const usersInRoom = eventStateManager.getUsersInRoom(roomId);
      expect(usersInRoom).toHaveLength(0);
    });
  });
}); 