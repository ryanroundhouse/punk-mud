const { StateService } = require('../../src/services/stateService');

// Mock dependencies
const mockLogger = {
    debug: jest.fn(),
    error: jest.fn()
};

const mockUser = {
    findById: jest.fn()
};

describe('StateService', () => {
    let stateService;

    beforeEach(() => {
        // Create a new instance with mocked dependencies for each test
        stateService = new StateService({
            logger: mockLogger,
            User: mockUser
        });
        
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    describe('Client Management', () => {
        test('should add client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            stateService.addClient(userId, mockSocket);
            
            expect(stateService.clients.size).toBe(1);
            expect(stateService.clients.get(userId)).toBe(mockSocket);
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });

        test('should get client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            stateService.clients.set(userId, mockSocket);
            const result = stateService.getClient(userId);
            
            expect(result).toBe(mockSocket);
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        test('should remove client socket', () => {
            const userId = 'user123';
            const mockSocket = { id: 'socket1' };
            
            stateService.clients.set(userId, mockSocket);
            stateService.removeClient(userId);
            
            expect(stateService.clients.size).toBe(0);
            expect(stateService.clients.has(userId)).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });
    });

    describe('Node Management', () => {
        test('should add user to node', () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            
            const result = stateService.addUserToNode(userId, nodeAddress);
            
            expect(result.size).toBe(1);
            expect(result.has(userId)).toBe(true);
            expect(stateService.nodeClients.get(nodeAddress)).toBe(result);
            expect(stateService.nodeClients.get(nodeAddress).size).toBe(1);
        });

        test('should add user to existing node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            stateService.addUserToNode(userId1, nodeAddress);
            const result = stateService.addUserToNode(userId2, nodeAddress);
            
            expect(result.size).toBe(2);
            expect(result.has(userId1)).toBe(true);
            expect(result.has(userId2)).toBe(true);
        });

        test('should remove user from node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            stateService.addUserToNode(userId1, nodeAddress);
            stateService.addUserToNode(userId2, nodeAddress);
            
            const result = stateService.removeUserFromNode(userId1, nodeAddress);
            
            expect(result.size).toBe(1);
            expect(result.has(userId1)).toBe(false);
            expect(result.has(userId2)).toBe(true);
        });

        test('should remove node when last user is removed', () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            
            stateService.addUserToNode(userId, nodeAddress);
            const result = stateService.removeUserFromNode(userId, nodeAddress);
            
            expect(result).toBeNull();
            expect(stateService.nodeClients.has(nodeAddress)).toBe(false);
            expect(stateService.nodeUsernames.has(nodeAddress)).toBe(false);
        });

        test('should return null when removing user from non-existent node', () => {
            const userId = 'user123';
            const nodeAddress = 'nonExistentNode';
            
            const result = stateService.removeUserFromNode(userId, nodeAddress);
            
            expect(result).toBeNull();
        });

        test('should get users in node', () => {
            const userId1 = 'user123';
            const userId2 = 'user456';
            const nodeAddress = 'node1';
            
            stateService.addUserToNode(userId1, nodeAddress);
            stateService.addUserToNode(userId2, nodeAddress);
            
            const result = stateService.getUsersInNode(nodeAddress);
            
            expect(result.size).toBe(2);
            expect(result.has(userId1)).toBe(true);
            expect(result.has(userId2)).toBe(true);
        });

        test('should return empty set for non-existent node', () => {
            const nodeAddress = 'nonExistentNode';
            
            const result = stateService.getUsersInNode(nodeAddress);
            
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        test('should add user to node and update usernames', async () => {
            const userId = 'user123';
            const nodeAddress = 'node1';
            const mockSocket = { emit: jest.fn() };
            
            // Setup mock for fetchUsernames
            stateService.fetchUsernames = jest.fn().mockResolvedValue(['TestAvatar']);
            
            // Setup client socket
            stateService.clients.set(userId, mockSocket);
            
            const result = await stateService.addUserToNodeAndUpdateUsernames(userId, nodeAddress);
            
            // Verify node users set is returned
            expect(result.size).toBe(1);
            expect(result.has(userId)).toBe(true);
            
            // Verify updateNodeUsernames was called
            expect(stateService.fetchUsernames).toHaveBeenCalledWith([userId]);
            expect(stateService.nodeUsernames.get(nodeAddress)).toEqual(['TestAvatar']);
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
            
            const result = await stateService.fetchUsernames(userIds);
            
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
            
            const result = await stateService.fetchUsernames(userIds);
            
            expect(result).toEqual(['Avatar1']);
            expect(mockUser.findById).toHaveBeenCalledTimes(2);
            expect(mockLogger.error).toHaveBeenCalledTimes(1);
        });

        test('should update node usernames', async () => {
            const nodeAddress = 'node1';
            const userIds = ['user1', 'user2'];
            const mockSocket = { emit: jest.fn() };
            
            // Setup node with users
            userIds.forEach(userId => stateService.addUserToNode(userId, nodeAddress));
            
            // Setup user sockets
            stateService.clients.set('user1', mockSocket);
            stateService.clients.set('user2', mockSocket);
            
            // Mock fetchUsernames
            stateService.fetchUsernames = jest.fn().mockResolvedValue(['Avatar1', 'Avatar2']);
            
            const result = await stateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual(['Avatar1', 'Avatar2']);
            expect(stateService.nodeUsernames.get(nodeAddress)).toEqual(['Avatar1', 'Avatar2']);
            expect(stateService.fetchUsernames).toHaveBeenCalledWith(['user1', 'user2']);
            expect(mockSocket.emit).toHaveBeenCalledTimes(2);
            expect(mockSocket.emit).toHaveBeenCalledWith('users update', ['Avatar1', 'Avatar2']);
        });

        test('should handle errors in updateNodeUsernames', async () => {
            const nodeAddress = 'node1';
            
            // Setup a node with users to avoid returning early
            stateService.nodeClients.set(nodeAddress, new Set(['user1']));
            
            stateService.fetchUsernames = jest.fn().mockRejectedValue(new Error('Test error'));
            
            const result = await stateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledTimes(1);
        });

        test('should do nothing when node has no users', async () => {
            const nodeAddress = 'emptyNode';
            
            const result = await stateService.updateNodeUsernames(nodeAddress);
            
            expect(result).toEqual([]);
            expect(stateService.fetchUsernames).not.toHaveBeenCalled;
        });
    });

    describe('Combat State Management', () => {
        test('should set and get user combat state', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            const result = stateService.setUserCombatState(userId, combatState);
            
            expect(result).toBe(combatState);
            expect(stateService.getUserCombatState(userId)).toBe(combatState);
        });

        test('should check if user is in combat', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            expect(stateService.isUserInCombat(userId)).toBe(false);
            
            stateService.setUserCombatState(userId, combatState);
            
            expect(stateService.isUserInCombat(userId)).toBe(true);
        });

        test('should clear user combat state', () => {
            const userId = 'user123';
            const combatState = { enemy: 'goblin', health: 100 };
            
            stateService.setUserCombatState(userId, combatState);
            stateService.clearUserCombatState(userId);
            
            expect(stateService.isUserInCombat(userId)).toBe(false);
            expect(stateService.getUserCombatState(userId)).toBeUndefined();
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
            
            const results = stateService.addCombatantEffect(combatantId, effect);
            
            expect(results.length).toBe(1);
            expect(results[0]).toEqual(effect);
            expect(stateService.getCombatantEffects(combatantId)).toEqual([effect]);
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
            
            stateService.addCombatantEffect(combatantId, effect);
            const updatedEffects = stateService.updateCombatantEffects(combatantId);
            
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
            
            stateService.addCombatantEffect(combatantId, effect);
            const updatedEffects = stateService.updateCombatantEffects(combatantId);
            
            expect(updatedEffects.length).toBe(0);
            expect(stateService.getCombatantEffects(combatantId)).toEqual([]);
        });

        test('should clear combatant effects', () => {
            const combatantId = 'combatant1';
            const effect = {
                effect: 'poison',
                rounds: 3,
                stat: 'health',
                amount: -5
            };
            
            stateService.addCombatantEffect(combatantId, effect);
            stateService.clearCombatantEffects(combatantId);
            
            expect(stateService.getCombatantEffects(combatantId)).toEqual([]);
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
            
            const result = stateService.setCombatDelay(combatantId, moveInfo);
            
            expect(result).toEqual(moveInfo);
            expect(stateService.getCombatDelay(combatantId)).toEqual(moveInfo);
        });

        test('should process delays and return ready moves', () => {
            const userId = 'user1';
            const mobId = 'mob1';
            
            stateService.setCombatDelay(userId, {
                delay: 1,
                move: 'attack',
                target: 'mob1'
            });
            
            stateService.setCombatDelay(mobId, {
                delay: 2,
                move: 'defend',
                target: 'user1'
            });
            
            const readyMoves = stateService.processDelays(userId, mobId);
            
            expect(readyMoves.length).toBe(1);
            expect(readyMoves[0].type).toBe('player');
            expect(readyMoves[0].move).toBe('attack');
            expect(stateService.getCombatDelay(userId)).toBeUndefined();
            expect(stateService.getCombatDelay(mobId).delay).toBe(1);
        });

        test('should clear combat delay', () => {
            const combatantId = 'combatant1';
            const moveInfo = {
                delay: 2,
                move: 'attack',
                target: 'enemy1'
            };
            
            stateService.setCombatDelay(combatantId, moveInfo);
            stateService.clearCombatDelay(combatantId);
            
            expect(stateService.getCombatDelay(combatantId)).toBeUndefined();
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
            
            const result = stateService.setPlayerMob(userId, mobInstance);
            
            expect(result).toBe(mobInstance);
            expect(stateService.getPlayerMob(userId)).toBe(mobInstance);
            expect(mockLogger.debug).toHaveBeenCalledTimes(1);
        });

        test('should check if player has mob', () => {
            const userId = 'user1';
            const mobInstance = {
                mobId: 'goblin',
                instanceId: 'mob1',
                name: 'Goblin Warrior'
            };
            
            expect(stateService.hasPlayerMob(userId)).toBe(false);
            
            stateService.setPlayerMob(userId, mobInstance);
            
            expect(stateService.hasPlayerMob(userId)).toBe(true);
        });

        test('should clear player mob', () => {
            const userId = 'user1';
            const mobInstance = {
                mobId: 'goblin',
                instanceId: 'mob1',
                name: 'Goblin Warrior'
            };
            
            stateService.setPlayerMob(userId, mobInstance);
            stateService.clearPlayerMob(userId);
            
            expect(stateService.hasPlayerMob(userId)).toBe(false);
            expect(stateService.getPlayerMob(userId)).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledTimes(2);
        });
    });

    describe('Event Management', () => {
        test('should set and get active event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = {
                prompt: 'This is a test prompt',
                choices: [
                    { 
                        text: 'Option 1', 
                        nextNode: { prompt: 'Next prompt 1' } 
                    },
                    { 
                        text: 'Option 2', 
                        nextNode: { 
                            prompt: 'Next prompt 2',
                            questCompletionEvents: ['quest1']
                        } 
                    }
                ]
            };
            
            const result = stateService.setActiveEvent(userId, eventId, currentNode, actorId);
            
            expect(result.eventId).toBe(eventId);
            expect(result.actorId).toBe(actorId);
            expect(result.currentNode.prompt).toBe(currentNode.prompt);
            expect(result.currentNode._id).toBeDefined();
            
            // Check that the node was cloned and not modified directly
            expect(result.currentNode).not.toBe(currentNode);
            
            // Verify that all choices have questCompletionEvents
            expect(result.currentNode.choices[0].nextNode.questCompletionEvents).toEqual(['quest1']);
            expect(result.currentNode.choices[1].nextNode.questCompletionEvents).toEqual(['quest1']);
            
            const storedEvent = stateService.getActiveEvent(userId);
            expect(storedEvent).toBe(result);
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
            
            // Set initial event
            stateService.setActiveEvent(userId, eventId, firstNode, actorId);
            
            // Update to second node
            const result = stateService.setActiveEvent(userId, eventId, secondNode, actorId);
            
            // Check history
            expect(result.nodeHistory.length).toBe(1);
            expect(result.nodeHistory[0].nodeId).toBe('node1');
            expect(result.nodeHistory[0].prompt).toContain('First prompt');
        });

        test('should check if user is in event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            expect(stateService.isInEvent(userId)).toBe(false);
            
            stateService.setActiveEvent(userId, eventId, currentNode, actorId);
            
            expect(stateService.isInEvent(userId)).toBe(true);
        });

        test('should check if user is in story event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            stateService.setActiveEvent(userId, eventId, currentNode, actorId, false);
            expect(stateService.isInStoryEvent(userId)).toBe(false);
            
            stateService.setActiveEvent(userId, eventId, currentNode, actorId, true);
            expect(stateService.isInStoryEvent(userId)).toBe(true);
        });

        test('should clear active event', () => {
            const userId = 'user1';
            const eventId = 'event1';
            const actorId = 'actor1';
            const currentNode = { prompt: 'Test prompt' };
            
            stateService.setActiveEvent(userId, eventId, currentNode, actorId);
            stateService.clearActiveEvent(userId);
            
            expect(stateService.isInEvent(userId)).toBe(false);
            expect(stateService.getActiveEvent(userId)).toBeUndefined();
        });
    });

    describe('State Reset', () => {
        test('should reset all state collections', () => {
            // Setup some state
            stateService.addClient('user1', { id: 'socket1' });
            stateService.addUserToNode('user1', 'node1');
            stateService.setUserCombatState('user1', { enemy: 'goblin' });
            stateService.addCombatantEffect('user1', { effect: 'poison', rounds: 3 });
            stateService.setCombatDelay('user1', { delay: 2, move: 'attack' });
            stateService.setPlayerMob('user1', { mobId: 'goblin', instanceId: 'mob1' });
            stateService.setActiveEvent('user1', 'event1', { prompt: 'Test' }, 'actor1');
            
            // Reset state
            stateService.reset();
            
            // Verify all collections are empty
            expect(stateService.clients.size).toBe(0);
            expect(stateService.nodeClients.size).toBe(0);
            expect(stateService.nodeUsernames.size).toBe(0);
            expect(stateService.subscribedNodes.size).toBe(0);
            expect(stateService.actorChatStates.size).toBe(0);
            expect(stateService.playerMobs.size).toBe(0);
            expect(stateService.userCombatStates.size).toBe(0);
            expect(stateService.combatantEffects.size).toBe(0);
            expect(stateService.combatDelays.size).toBe(0);
            expect(stateService.activeEvents.size).toBe(0);
        });
    });
}); 