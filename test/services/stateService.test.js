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

        test('should remove user from node and update usernames', async () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            const mockSocket1 = { emit: jest.fn() };
            const mockSocket2 = { emit: jest.fn() };
            
            // Setup mock for fetchUsernames
            testStateService.fetchUsernames = jest.fn()
                .mockResolvedValueOnce(['Avatar1', 'Avatar2'])  // First call when adding users
                .mockResolvedValueOnce(['Avatar1', 'Avatar2'])  // Second call when adding users
                .mockResolvedValueOnce(['Avatar2']);  // Third call after removing user1
            
            // Setup client sockets
            testStateService.clients.set(userId1, mockSocket1);
            testStateService.clients.set(userId2, mockSocket2);
            
            // Add both users to the node
            await testStateService.addUserToNodeAndUpdateUsernames(userId1, nodeAddress);
            await testStateService.addUserToNodeAndUpdateUsernames(userId2, nodeAddress);
            
            // Clear the mock calls from setup
            mockSocket1.emit.mockClear();
            mockSocket2.emit.mockClear();
            testStateService.fetchUsernames.mockClear();
            
            // Remove user1 and update usernames
            await testStateService.removeUserFromNodeAndUpdateUsernames(userId1, nodeAddress);
            
            // Wait for any pending promises to resolve
            await Promise.resolve();
            await Promise.resolve();
            
            // Verify node users set is returned
            const nodeUsers = testStateService.getUsersInNode(nodeAddress);
            expect(nodeUsers.size).toBe(1);
            expect(nodeUsers.has(userId1)).toBe(false);
            expect(nodeUsers.has(userId2)).toBe(true);
            
            // Verify updateNodeUsernames was called with remaining user
            expect(testStateService.fetchUsernames).toHaveBeenCalledWith([userId2]);
            expect(testStateService.nodeUsernames.get(nodeAddress)).toEqual(['Avatar2']);
            
            // Only user2's socket should receive the update since user1 was removed from the node
            expect(mockSocket1.emit).not.toHaveBeenCalled();
            expect(mockSocket2.emit).toHaveBeenCalledWith('users update', ['Avatar2']);
        });

        test('should handle removing last user from node and update usernames', async () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            const mockSocket = { emit: jest.fn() };
            
            // Setup mock for fetchUsernames
            testStateService.fetchUsernames = jest.fn().mockResolvedValue(['Avatar1']);
            
            // Setup client socket
            testStateService.clients.set(userId, mockSocket);
            
            // Add user to the node
            await testStateService.addUserToNodeAndUpdateUsernames(userId, nodeAddress);
            
            // Clear the mock calls from setup
            mockSocket.emit.mockClear();
            testStateService.fetchUsernames.mockClear();
            
            // Remove the last user
            const result = await testStateService.removeUserFromNodeAndUpdateUsernames(userId, nodeAddress);
            
            // Verify node is completely removed
            expect(result).toBeNull();
            expect(testStateService.nodeClients.has(nodeAddress)).toBe(false);
            expect(testStateService.nodeUsernames.has(nodeAddress)).toBe(false);
            
            // Verify fetchUsernames was not called since node was removed
            expect(testStateService.fetchUsernames).not.toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        test('should handle removing user from non-existent node when updating usernames', async () => {
            const userId = 'user123';
            const nodeAddress = 'nonExistentNode';
            const mockSocket = { emit: jest.fn() };
            
            // Setup mock for fetchUsernames
            testStateService.fetchUsernames = jest.fn();
            
            // Setup client socket
            testStateService.clients.set(userId, mockSocket);
            
            const result = await testStateService.removeUserFromNodeAndUpdateUsernames(userId, nodeAddress);
            
            // Verify null is returned for non-existent node
            expect(result).toBeNull();
            
            // Verify no username updates were attempted
            expect(testStateService.fetchUsernames).not.toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        it('should remove user from previous node when moving to new node', async () => {
            // Setup initial state
            const user1 = 'user1';
            const socket1 = { id: 'socket1' };
            const node1 = '122.124.10.10';
            const node2 = '122.124.10.11';
            
            stateService.addClient(user1, socket1);
            
            // Add user to first node
            stateService.addUserToNode(user1, node1);
            expect(stateService.getUsersInNode(node1).has(user1)).toBe(true);
            expect(stateService.getUsersInNode(node2).has(user1)).toBe(false);
            
            // Move user to second node
            stateService.addUserToNode(user1, node2);
            
            // Verify user is only in the second node
            expect(stateService.getUsersInNode(node1).has(user1)).toBe(false);
            expect(stateService.getUsersInNode(node2).has(user1)).toBe(true);
            
            // Verify first node is cleaned up if empty
            expect(stateService.nodeClients.has(node1)).toBe(false);
            expect(stateService.nodeUsernames.has(node1)).toBe(false);
        });

        it('should correctly update usernames when user moves between nodes', async () => {
            // Setup initial state
            const user1 = 'user1';
            const user2 = 'user2';
            const socket1 = { id: 'socket1', emit: jest.fn() };
            const socket2 = { id: 'socket2', emit: jest.fn() };
            const node1 = '122.124.10.10';
            const node2 = '122.124.10.11';
            
            // Mock fetchUsernames to return different values based on the users present
            stateService.fetchUsernames = jest.fn()
                .mockImplementation(async (userIds) => {
                    return userIds.map(id => id === 'user1' ? 'User One' : 'User Two');
                });
            
            // Add both users and their sockets
            stateService.addClient(user1, socket1);
            stateService.addClient(user2, socket2);
            
            // Initially put both users in node2
            await stateService.addUserToNodeAndUpdateUsernames(user2, node2);
            await stateService.addUserToNodeAndUpdateUsernames(user1, node2);
            
            // Verify both users see both usernames in node2 (sorted alphabetically)
            expect(socket1.emit).toHaveBeenLastCalledWith('users update', ['User One', 'User Two']);
            expect(socket2.emit).toHaveBeenLastCalledWith('users update', ['User One', 'User Two']);
            
            // Clear the mock call history
            socket1.emit.mockClear();
            socket2.emit.mockClear();
            
            // Move user1 to node1
            await stateService.removeUserFromNodeAndUpdateUsernames(user1, node2);
            await stateService.addUserToNodeAndUpdateUsernames(user1, node1);
            
            // Verify user1 sees only themselves in node1
            expect(socket1.emit).toHaveBeenLastCalledWith('users update', ['User One']);
            
            // Verify user2 sees only themselves in node2
            expect(socket2.emit).toHaveBeenLastCalledWith('users update', ['User Two']);
            
            // Verify the internal state
            expect(Array.from(stateService.getUsersInNode(node1))).toEqual([user1]);
            expect(Array.from(stateService.getUsersInNode(node2))).toEqual([user2]);
        });

        it('should maintain consistent username lists during user movement between nodes', async () => {
            // Setup initial state
            const user1 = 'user1';
            const user2 = 'user2';
            const socket1 = { id: 'socket1', emit: jest.fn() };
            const socket2 = { id: 'socket2', emit: jest.fn() };
            const node1 = '122.124.10.10';
            const node2 = '122.124.10.11';
            
            // Mock fetchUsernames to return different values based on the users present
            stateService.fetchUsernames = jest.fn()
                .mockImplementation(async (userIds) => {
                    return userIds.map(id => id === 'user1' ? 'User One' : 'User Two').sort();
                });
            
            // Add both users and their sockets
            stateService.addClient(user1, socket1);
            stateService.addClient(user2, socket2);
            
            // Initially put both users in node1
            await stateService.addUserToNodeAndUpdateUsernames(user1, node1);
            await stateService.addUserToNodeAndUpdateUsernames(user2, node1);
            
            // Clear the mock call history
            socket1.emit.mockClear();
            socket2.emit.mockClear();
            
            // Move user1 to node2
            await stateService.moveUserToNode(user1, node2);
            
            // Get all emitted updates for each socket
            const socket1Updates = socket1.emit.mock.calls
                .filter(call => call[0] === 'users update')
                .map(call => call[1]);
            const socket2Updates = socket2.emit.mock.calls
                .filter(call => call[0] === 'users update')
                .map(call => call[1]);
            
            // Verify that user1 never saw an inconsistent state during the move
            socket1Updates.forEach(update => {
                // User1 should either see both users in node1 or just themselves in node2
                expect(update).toEqual(
                    update.length === 2 
                        ? ['User One', 'User Two']  // Initial state in node1
                        : ['User One']              // Final state in node2
                );
            });
            
            // Verify that user2 never saw an inconsistent state
            socket2Updates.forEach(update => {
                // User2 should either see both users or just themselves
                expect(update).toEqual(
                    update.length === 2 
                        ? ['User One', 'User Two']  // Initial state
                        : ['User Two']              // Final state after user1 leaves
                );
            });
            
            // Verify final state
            expect(Array.from(stateService.getUsersInNode(node1))).toEqual([user2]);
            expect(Array.from(stateService.getUsersInNode(node2))).toEqual([user1]);
            expect(stateService.nodeUsernames.get(node1)).toEqual(['User Two']);
            expect(stateService.nodeUsernames.get(node2)).toEqual(['User One']);
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