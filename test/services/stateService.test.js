// Mock the EventStateManager module before requiring stateService
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

// Import stateService and the StateService class
const stateService = require('../../src/services/stateService');
const { StateService } = require('../../src/services/stateService');
const eventStateManager = require('../../src/services/eventStateManager');
const User = require('../../src/models/User');

// Mock dependencies
const mockLogger = {
    debug: jest.fn(),
    error: jest.fn()
};

const mockUser = {
    findById: jest.fn()
};

describe('StateService', () => {
    let testStateService;

    beforeEach(() => {
        // Create a new instance with mocked dependencies for each test
        testStateService = new StateService({
            logger: mockLogger,
            User: mockUser
        });
        
        // Reset all the mock implementations
        jest.clearAllMocks();
    });

    describe('Client Management', () => {
        test('should add client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            testStateService.addClient(userId, mockSocket);
            
            expect(testStateService.clients.size).toBe(1);
            expect(testStateService.clients.get(userId)).toBe(mockSocket);
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });

        test('should get client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            testStateService.clients.set(userId, mockSocket);
            const result = testStateService.getClient(userId);
            
            expect(result).toBe(mockSocket);
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        test('should remove client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            testStateService.clients.set(userId, mockSocket);
            testStateService.removeClient(userId);
            
            expect(testStateService.clients.size).toBe(0);
            expect(testStateService.clients.has(userId)).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });
    });

    describe('Node Management', () => {
        test('should add user to node', () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            
            const result = testStateService.addUserToNode(userId, nodeAddress);
            
            expect(result.size).toBe(1);
            expect(result.has(userId)).toBe(true);
            expect(testStateService.nodeClients.get(nodeAddress)).toBe(result);
            expect(testStateService.nodeClients.get(nodeAddress).size).toBe(1);
        });

        test('should add user to existing node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            testStateService.addUserToNode(userId1, nodeAddress);
            const result = testStateService.addUserToNode(userId2, nodeAddress);
            
            expect(result.size).toBe(2);
            expect(result.has(userId1)).toBe(true);
            expect(result.has(userId2)).toBe(true);
        });

        test('should remove user from node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            testStateService.addUserToNode(userId1, nodeAddress);
            testStateService.addUserToNode(userId2, nodeAddress);
            
            const result = testStateService.removeUserFromNode(userId1, nodeAddress);
            
            expect(result.size).toBe(1);
            expect(result.has(userId1)).toBe(false);
            expect(result.has(userId2)).toBe(true);
        });

        test('should remove node when last user is removed', () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            
            testStateService.addUserToNode(userId, nodeAddress);
            const result = testStateService.removeUserFromNode(userId, nodeAddress);
            
            expect(result).toBeNull();
            expect(testStateService.nodeClients.has(nodeAddress)).toBe(false);
            expect(testStateService.nodeUsernames.has(nodeAddress)).toBe(false);
        });

        test('should return null when removing user from non-existent node', () => {
            const userId = 'user123';
            const nodeAddress = 'nonExistentNode';
            
            const result = testStateService.removeUserFromNode(userId, nodeAddress);
            
            expect(result).toBeNull();
        });

        test('should get users in node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            testStateService.addUserToNode(userId1, nodeAddress);
            testStateService.addUserToNode(userId2, nodeAddress);
            
            const result = testStateService.getUsersInNode(nodeAddress);
            
            expect(result.size).toBe(2);
            expect(result.has(userId1)).toBe(true);
            expect(result.has(userId2)).toBe(true);
        });

        test('should return empty set for non-existent node', () => {
            const nodeAddress = 'nonExistentNode';
            
            const result = testStateService.getUsersInNode(nodeAddress);
            
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        test('should add user to node and update usernames', async () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            const mockSocket = { emit: jest.fn() };
            
            // Setup mock for fetchUsernames
            testStateService.fetchUsernames = jest.fn().mockResolvedValue(['TestAvatar']);
            
            // Setup client socket
            testStateService.clients.set(userId, mockSocket);
            
            const result = await testStateService.addUserToNodeAndUpdateUsernames(userId, nodeAddress);
            
            // Verify node users set is returned
            expect(result.size).toBe(1);
            expect(result.has(userId)).toBe(true);
            
            // Verify updateNodeUsernames was called
            expect(testStateService.fetchUsernames).toHaveBeenCalledWith([userId]);
            expect(testStateService.nodeUsernames.get(nodeAddress)).toEqual(['TestAvatar']);
            expect(mockSocket.emit).toHaveBeenCalledWith('users update', ['TestAvatar']);
        });
    });

    describe('Username Management', () => {
        test('should fetch usernames for given user IDs', async () => {
            const userIds = ['user1', 'user2', 'user3'];
            
            mockUser.findById.mockImplementation(id => {
                const mockData = {
                    user1: { avatarName: 'Avatar1' },
                    user2: { avatarName: 'Avatar2' },
                    user3: null  // Simulate user not found
                };
                return Promise.resolve(mockData[id]);
            });
            
            const result = await testStateService.fetchUsernames(userIds);
            
            expect(result).toEqual(['Avatar1', 'Avatar2']);
            expect(mockUser.findById).toHaveBeenCalledTimes(3);
        });

        test('should handle errors when fetching usernames', async () => {
            const userIds = ['user1', 'user2'];
            
            mockUser.findById.mockImplementation(id => {
                if (id === 'user1') {
                    return Promise.resolve({ avatarName: 'Avatar1' });
                } else {
                    return Promise.reject(new Error('Database error'));
                }
            });
            
            const result = await testStateService.fetchUsernames(userIds);
            
            expect(result).toEqual(['Avatar1']);
            expect(mockUser.findById).toHaveBeenCalledTimes(2);
            expect(mockLogger.error).toHaveBeenCalledTimes(1);
        });

        test('should update node usernames', async () => {
            const nodeAddress = 'node1';
            const userIds = ['user1', 'user2'];
            const mockSocket = { emit: jest.fn() };
            
            // Setup node with users
            userIds.forEach(userId => testStateService.addUserToNode(userId, nodeAddress));
            
            // Setup user sockets
            testStateService.clients.set('user1', mockSocket);
            testStateService.clients.set('user2', mockSocket);
            
            // Mock fetchUsernames
            testStateService.fetchUsernames = jest.fn().mockResolvedValue(['Avatar1', 'Avatar2']);
            
            const result = await testStateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual(['Avatar1', 'Avatar2']);
            expect(testStateService.nodeUsernames.get(nodeAddress)).toEqual(['Avatar1', 'Avatar2']);
            expect(testStateService.fetchUsernames).toHaveBeenCalledWith(['user1', 'user2']);
            expect(mockSocket.emit).toHaveBeenCalledTimes(2);
            expect(mockSocket.emit).toHaveBeenCalledWith('users update', ['Avatar1', 'Avatar2']);
        });

        test('should handle errors in updateNodeUsernames', async () => {
            const nodeAddress = 'node1';
            
            // Setup a node with users to avoid returning early
            testStateService.nodeClients.set(nodeAddress, new Set(['user1']));
            
            testStateService.fetchUsernames = jest.fn().mockRejectedValue(new Error('Test error'));
            
            const result = await testStateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledTimes(1);
        });

        test('should do nothing when node has no users', async () => {
            const nodeAddress = 'emptyNode';
            
            const result = await testStateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual([]);
            expect(testStateService.fetchUsernames).not.toHaveBeenCalled;
        });
    });

    describe('Combat State Management', () => {
        test('should set and get user combat state', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            const result = testStateService.setUserCombatState(userId, combatState);
            
            expect(result).toBe(combatState);
            expect(testStateService.getUserCombatState(userId)).toBe(combatState);
        });

        test('should check if user is in combat', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            expect(testStateService.isUserInCombat(userId)).toBe(false);
            
            testStateService.setUserCombatState(userId, combatState);
            
            expect(testStateService.isUserInCombat(userId)).toBe(true);
        });

        test('should clear user combat state', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            testStateService.setUserCombatState(userId, combatState);
            testStateService.clearUserCombatState(userId);
            
            expect(testStateService.isUserInCombat(userId)).toBe(false);
            expect(testStateService.getUserCombatState(userId)).toBeUndefined();
        });
    });

    describe('Combat Effects Management', () => {
        test('should add and get combatant effects', () => {
            const combatantId = 'combatant1';
            const effect = {
                effect: 'poison',
                rounds: 3,
                stat: 'health',
                amount: -5,
                target: 'enemy',
                message: 'Poison damage',
                initiator: 'player'
            };
            
            const results = testStateService.addCombatantEffect(combatantId, effect);
            
            expect(results.length).toBe(1);
            expect(results[0]).toEqual(effect);
            expect(testStateService.getCombatantEffects(combatantId)).toEqual([effect]);
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        test('should update combatant effects', () => {
            const combatantId = 'combatant1';
            const effect = {
                effect: 'poison',
                rounds: 3,
                stat: 'health',
                amount: -5
            };
            
            testStateService.addCombatantEffect(combatantId, effect);
            const updatedEffects = testStateService.updateCombatantEffects(combatantId);
            
            expect(updatedEffects.length).toBe(1);
            expect(updatedEffects[0].rounds).toBe(2);
            expect(mockLogger.debug).toHaveBeenCalledTimes(3);
        });

        test('should remove effects when rounds reach zero', () => {
            const combatantId = 'combatant1';
            const effect = {
                effect: 'poison',
                rounds: 1,
                stat: 'health',
                amount: -5
            };
            
            testStateService.addCombatantEffect(combatantId, effect);
            const updatedEffects = testStateService.updateCombatantEffects(combatantId);
            
            expect(updatedEffects.length).toBe(0);
            expect(testStateService.getCombatantEffects(combatantId)).toEqual([]);
        });

        test('should clear combatant effects', () => {
            const combatantId = 'combatant1';
            const effect = {
                effect: 'poison',
                rounds: 3,
                stat: 'health',
                amount: -5
            };
            
            testStateService.addCombatantEffect(combatantId, effect);
            testStateService.clearCombatantEffects(combatantId);
            
            expect(testStateService.getCombatantEffects(combatantId)).toEqual([]);
        });
    });

    describe('Combat Delay Management', () => {
        test('should set and get combat delay', () => {
            const combatantId = 'combatant1';
            const moveInfo = {
                delay: 2,
                move: 'attack',
                target: 'enemy1'
            };
            
            const result = testStateService.setCombatDelay(combatantId, moveInfo);
            
            expect(result).toEqual(moveInfo);
            expect(testStateService.getCombatDelay(combatantId)).toEqual(moveInfo);
        });

        test('should process delays and return ready moves', () => {
            const userId = 'user1';
            const mobId = 'mob1';
            
            testStateService.setCombatDelay(userId, {
                delay: 1,
                move: 'attack',
                target: 'mob1'
            });
            
            testStateService.setCombatDelay(mobId, {
                delay: 2,
                move: 'defend',
                target: 'user1'
            });
            
            const readyMoves = testStateService.processDelays(userId, mobId);
            
            expect(readyMoves.length).toBe(1);
            expect(readyMoves[0].type).toBe('player');
            expect(readyMoves[0].move).toBe('attack');
            expect(testStateService.getCombatDelay(userId)).toBeUndefined();
            expect(testStateService.getCombatDelay(mobId).delay).toBe(1);
        });

        test('should clear combat delay', () => {
            const combatantId = 'combatant1';
            const moveInfo = {
                delay: 2,
                move: 'attack',
                target: 'enemy1'
            };
            
            testStateService.setCombatDelay(combatantId, moveInfo);
            testStateService.clearCombatDelay(combatantId);
            
            expect(testStateService.getCombatDelay(combatantId)).toBeUndefined();
        });
    });

    describe('Player Mob Management', () => {
        test('should set and get player mob', () => {
            const userId = 'user1';
            const mobInstance = {
                mobId: 'goblin',
                instanceId: 'mob1',
                name: 'Goblin Warrior'
            };
            
            const result = testStateService.setPlayerMob(userId, mobInstance);
            
            expect(result).toBe(mobInstance);
            expect(testStateService.getPlayerMob(userId)).toBe(mobInstance);
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        test('should check if player has mob', () => {
            const userId = 'user1';
            const mobInstance = {
                mobId: 'goblin',
                instanceId: 'mob1',
                name: 'Goblin Warrior'
            };
            
            expect(testStateService.hasPlayerMob(userId)).toBe(false);
            
            testStateService.setPlayerMob(userId, mobInstance);
            
            expect(testStateService.hasPlayerMob(userId)).toBe(true);
        });

        test('should clear player mob', () => {
            const userId = 'user1';
            const mobInstance = {
                mobId: 'goblin',
                instanceId: 'mob1',
                name: 'Goblin Warrior'
            };
            
            testStateService.setPlayerMob(userId, mobInstance);
            testStateService.clearPlayerMob(userId);
            
            expect(testStateService.hasPlayerMob(userId)).toBe(false);
            expect(testStateService.getPlayerMob(userId)).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });
    });

    describe('Event Management', () => {
        beforeEach(() => {
            // Reset all mocks before each test
            jest.clearAllMocks();
        });

        test('should set and get active event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            const mockResult = {
                userId,
                eventId,
                currentNode,
                actorId,
                isStoryEvent: false
            };
            
            eventStateManager.setActiveEvent.mockReturnValue(mockResult);
            eventStateManager.getActiveEvent.mockReturnValue(mockResult);
            
            const result = testStateService.setActiveEvent(userId, eventId, currentNode, actorId);
            
            expect(eventStateManager.setActiveEvent).toHaveBeenCalledWith(
                userId, 
                eventId, 
                currentNode, 
                actorId, 
                false
            );
            expect(result).toBe(mockResult);
            
            const storedEvent = testStateService.getActiveEvent(userId);
            expect(eventStateManager.getActiveEvent).toHaveBeenCalledWith(userId);
            expect(storedEvent).toBe(mockResult);
        });

        test('should track event history', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const firstNode = {
                _id: 'node1',
                prompt: 'First prompt'
            };
            const secondNode = {
                prompt: 'Second prompt'
            };
            
            // Mock implementation for event history
            const mockResultWithHistory = {
                userId,
                eventId,
                currentNode: secondNode,
                actorId,
                isStoryEvent: false,
                nodeHistory: [{
                    nodeId: 'node1',
                    prompt: 'First prompt'
                }]
            };
            
            // First call with no history
            eventStateManager.setActiveEvent.mockReturnValueOnce({});
            // Second call with history
            eventStateManager.setActiveEvent.mockReturnValueOnce(mockResultWithHistory);
            
            // Set initial event
            testStateService.setActiveEvent(userId, eventId, firstNode, actorId);
            
            // Update to second node
            const result = testStateService.setActiveEvent(userId, eventId, secondNode, actorId);
            
            // Check that the history is correctly maintained by eventStateManager
            expect(result.nodeHistory.length).toBe(1);
            expect(result.nodeHistory[0].nodeId).toBe('node1');
            expect(result.nodeHistory[0].prompt).toContain('First prompt');
        });

        test('should check if user is in event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            // First call to isInEvent returns false
            eventStateManager.isInEvent.mockReturnValueOnce(false);
            // Second call to isInEvent returns true
            eventStateManager.isInEvent.mockReturnValueOnce(true);
            
            expect(testStateService.isInEvent(userId)).toBe(false);
            
            testStateService.setActiveEvent(userId, eventId, currentNode, actorId);
            
            expect(testStateService.isInEvent(userId)).toBe(true);
        });

        test('should check if user is in story event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            // First call to getActiveEvent returns event with isStoryEvent: false
            eventStateManager.getActiveEvent.mockReturnValueOnce({ isStoryEvent: false });
            // Second call to getActiveEvent returns event with isStoryEvent: true
            eventStateManager.getActiveEvent.mockReturnValueOnce({ isStoryEvent: true });
            
            expect(testStateService.isInStoryEvent(userId)).toBe(false);
            
            testStateService.setActiveEvent(userId, eventId, currentNode, actorId, true);
            
            expect(testStateService.isInStoryEvent(userId)).toBe(true);
        });

        test('should clear active event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            // After clearing, isInEvent returns false
            eventStateManager.isInEvent.mockReturnValue(false);
            // After clearing, getActiveEvent returns null
            eventStateManager.getActiveEvent.mockReturnValue(null);
            
            testStateService.setActiveEvent(userId, eventId, currentNode, actorId);
            testStateService.clearActiveEvent(userId);
            
            expect(eventStateManager.clearActiveEvent).toHaveBeenCalledWith(userId);
            expect(testStateService.isInEvent(userId)).toBe(false);
            expect(testStateService.getActiveEvent(userId)).toBeNull();
        });
    });

    describe('State Reset', () => {
        test('should reset all state collections', () => {
            // Setup some state
            testStateService.addClient('user1', { id: 'socket1' });
            testStateService.addUserToNode('user1', 'node1');
            testStateService.setUserCombatState('user1', { enemy: 'goblin' });
            testStateService.addCombatantEffect('user1', { effect: 'poison', rounds: 3 });
            testStateService.setCombatDelay('user1', { delay: 2, move: 'attack' });
            testStateService.setPlayerMob('user1', { mobId: 'goblin', instanceId: 'mob1' });
            testStateService.setActiveEvent('user1', 'event1', { prompt: 'Test' }, 'actor1');
            
            // Reset state
            testStateService.reset();
            
            // Verify all collections are empty
            expect(testStateService.clients.size).toBe(0);
            expect(testStateService.nodeClients.size).toBe(0);
            expect(testStateService.nodeUsernames.size).toBe(0);
            expect(testStateService.subscribedNodes.size).toBe(0);
            expect(testStateService.actorChatStates.size).toBe(0);
            expect(testStateService.playerMobs.size).toBe(0);
            expect(testStateService.userCombatStates.size).toBe(0);
            expect(testStateService.combatantEffects.size).toBe(0);
            expect(testStateService.combatDelays.size).toBe(0);
            // activeEvents is now managed by EventStateManager, so don't check it here
        });
    });
}); 