const stateService = require('../../src/services/stateService');
const { StateService } = require('../../src/services/stateService');
const mongoose = require('mongoose');

// Mock dependencies for integration tests
const mockUser = {
    findById: jest.fn()
};

describe('StateService Integration Tests', () => {
    beforeEach(() => {
        // Reset singleton state before each test
        stateService.reset();
        
        // Reset mocks
        jest.clearAllMocks();
        
        // Override User model with mock
        stateService.User = mockUser;
    });

    test('should update node usernames from database', async () => {
        // Setup mock User findById implementation
        mockUser.findById.mockImplementation(id => {
            if (id === 'user1') {
                return Promise.resolve({ avatarName: 'TestAvatar1' });
            } else if (id === 'user2') {
                return Promise.resolve({ avatarName: 'TestAvatar2' });
            }
            return Promise.resolve(null);
        });
        
        const nodeAddress = 'test-node';
        const mockSocket = { emit: jest.fn() };
        
        // Setup node with users
        stateService.addUserToNode('user1', nodeAddress);
        stateService.addUserToNode('user2', nodeAddress);
        
        // Setup client sockets
        stateService.addClient('user1', mockSocket);
        stateService.addClient('user2', mockSocket);
        
        // Update usernames
        const usernames = await stateService.updateNodeUsernames(nodeAddress);
        
        // Verify results
        expect(usernames).toEqual(['TestAvatar1', 'TestAvatar2']);
        expect(stateService.nodeUsernames.get(nodeAddress)).toEqual(['TestAvatar1', 'TestAvatar2']);
        expect(mockSocket.emit).toHaveBeenCalledWith('users update', ['TestAvatar1', 'TestAvatar2']);
        expect(mockUser.findById).toHaveBeenCalledTimes(2);
    });

    test('should add and remove users from nodes', async () => {
        const nodeAddress = 'test-node';
        
        // Add users to node
        stateService.addUserToNode('user1', nodeAddress);
        stateService.addUserToNode('user2', nodeAddress);
        stateService.addUserToNode('user3', nodeAddress);
        
        // Verify node has 3 users
        const usersInNode = stateService.getUsersInNode(nodeAddress);
        expect(usersInNode.size).toBe(3);
        expect(usersInNode.has('user1')).toBe(true);
        expect(usersInNode.has('user2')).toBe(true);
        expect(usersInNode.has('user3')).toBe(true);
        
        // Remove one user
        stateService.removeUserFromNode('user2', nodeAddress);
        
        // Verify node has 2 users
        const updatedUsersInNode = stateService.getUsersInNode(nodeAddress);
        expect(updatedUsersInNode.size).toBe(2);
        expect(updatedUsersInNode.has('user1')).toBe(true);
        expect(updatedUsersInNode.has('user2')).toBe(false);
        expect(updatedUsersInNode.has('user3')).toBe(true);
        
        // Remove all users
        stateService.removeUserFromNode('user1', nodeAddress);
        stateService.removeUserFromNode('user3', nodeAddress);
        
        // Verify node is gone
        const finalUsersInNode = stateService.getUsersInNode(nodeAddress);
        expect(finalUsersInNode.size).toBe(0);
        expect(stateService.nodeClients.has(nodeAddress)).toBe(false);
    });

    test('should manage combat effects correctly', () => {
        const combatantId = 'player1';
        
        // Add effect
        const effect = {
            effect: 'poison',
            rounds: 3,
            stat: 'health',
            amount: -5
        };
        
        stateService.addCombatantEffect(combatantId, effect);
        
        // Verify effect is stored
        let effects = stateService.getCombatantEffects(combatantId);
        expect(effects.length).toBe(1);
        expect(effects[0].rounds).toBe(3);
        
        // Update effect (reduce rounds)
        stateService.updateCombatantEffects(combatantId);
        
        // Verify rounds decreased
        effects = stateService.getCombatantEffects(combatantId);
        expect(effects.length).toBe(1);
        expect(effects[0].rounds).toBe(2);
        
        // Update again
        stateService.updateCombatantEffects(combatantId);
        
        // Verify rounds decreased
        effects = stateService.getCombatantEffects(combatantId);
        expect(effects.length).toBe(1);
        expect(effects[0].rounds).toBe(1);
        
        // Update one more time (should remove effect)
        stateService.updateCombatantEffects(combatantId);
        
        // Verify effect is gone
        effects = stateService.getCombatantEffects(combatantId);
        expect(effects.length).toBe(0);
    });

    test('should process delayed combat moves', () => {
        const userId = 'user1';
        const mobId = 'mob1';
        
        // Set player move with delay 2
        stateService.setCombatDelay(userId, {
            delay: 2,
            move: 'fireball',
            target: mobId
        });
        
        // Set mob move with delay 1
        stateService.setCombatDelay(mobId, {
            delay: 1,
            move: 'claw',
            target: userId
        });
        
        // Process delays - first round
        let readyMoves = stateService.processDelays(userId, mobId);
        
        // First round: the mob's delay=0 means it's ready to move
        expect(readyMoves.length).toBe(1);
        expect(readyMoves[0].type).toBe('mob');
        expect(readyMoves[0].move).toBe('claw');
        expect(stateService.getCombatDelay(userId).delay).toBe(1);
        expect(stateService.getCombatDelay(mobId)).toBeUndefined();
        
        // Process delays - second round
        readyMoves = stateService.processDelays(userId, mobId);
        
        // Second round: player's delay=0 means it's ready to move
        expect(readyMoves.length).toBe(1);
        expect(readyMoves[0].type).toBe('player');
        expect(readyMoves[0].move).toBe('fireball');
        expect(stateService.getCombatDelay(userId)).toBeUndefined();
    });

    test('should create and manage events', () => {
        const userId = 'user1';
        const eventId = 'quest1';
        const actorId = 'npc1';
        
        const eventNode = {
            prompt: 'Test event prompt',
            choices: [
                { text: 'Option 1', nextNode: { prompt: 'Result 1' } },
                { 
                    text: 'Option 2', 
                    nextNode: { 
                        prompt: 'Result 2',
                        questCompletionEvents: ['complete_quest']
                    } 
                }
            ]
        };
        
        // Set event
        stateService.setActiveEvent(userId, eventId, eventNode, actorId);
        
        // Verify event is set
        expect(stateService.isInEvent(userId)).toBe(true);
        expect(stateService.isInStoryEvent(userId)).toBe(false);
        
        const activeEvent = stateService.getActiveEvent(userId);
        expect(activeEvent.eventId).toBe(eventId);
        expect(activeEvent.actorId).toBe(actorId);
        
        // Verify quest completion events are propagated to all choices
        expect(activeEvent.currentNode.choices[0].nextNode.questCompletionEvents).toEqual(['complete_quest']);
        expect(activeEvent.currentNode.choices[1].nextNode.questCompletionEvents).toEqual(['complete_quest']);
        
        // Set story event
        stateService.setActiveEvent(userId, 'story1', { prompt: 'Story event' }, 'narrator', true);
        
        // Verify it's a story event
        expect(stateService.isInStoryEvent(userId)).toBe(true);
        
        // Clear event
        stateService.clearActiveEvent(userId);
        
        // Verify event is cleared
        expect(stateService.isInEvent(userId)).toBe(false);
    });

    test('should add user to node and update usernames in a single operation', async () => {
        // Setup mock User findById implementation
        mockUser.findById.mockImplementation(id => {
            if (id === 'user1') {
                return Promise.resolve({ avatarName: 'TestAvatar1' });
            }
            return Promise.resolve(null);
        });
        
        const nodeAddress = 'test-node';
        const mockSocket = { emit: jest.fn() };
        
        // Setup client socket
        stateService.addClient('user1', mockSocket);
        
        // Call the combined method
        const nodeUsers = await stateService.addUserToNodeAndUpdateUsernames('user1', nodeAddress);
        
        // Verify both operations occurred
        expect(nodeUsers.size).toBe(1);
        expect(nodeUsers.has('user1')).toBe(true);
        expect(stateService.nodeUsernames.get(nodeAddress)).toEqual(['TestAvatar1']);
        expect(mockSocket.emit).toHaveBeenCalledWith('users update', ['TestAvatar1']);
        expect(mockUser.findById).toHaveBeenCalledTimes(1);
    });

    test('should remove user from node and update usernames in a single operation', async () => {
        // Setup mock User findById implementation
        mockUser.findById.mockImplementation(id => {
            if (id === 'user1') {
                return Promise.resolve({ avatarName: 'TestAvatar1' });
            } else if (id === 'user2') {
                return Promise.resolve({ avatarName: 'TestAvatar2' });
            }
            return Promise.resolve(null);
        });
        
        const nodeAddress = 'test-node';
        const mockSocket1 = { emit: jest.fn() };
        const mockSocket2 = { emit: jest.fn() };
        
        // Setup client sockets
        stateService.addClient('user1', mockSocket1);
        stateService.addClient('user2', mockSocket2);
        
        // Add both users to the node first
        await stateService.addUserToNodeAndUpdateUsernames('user1', nodeAddress);
        await stateService.addUserToNodeAndUpdateUsernames('user2', nodeAddress);
        
        // Clear the mock calls from setup
        mockSocket1.emit.mockClear();
        mockSocket2.emit.mockClear();
        mockUser.findById.mockClear();
        
        // Remove one user and update usernames
        const nodeUsers = await stateService.removeUserFromNodeAndUpdateUsernames('user1', nodeAddress);
        
        // Verify operations occurred correctly
        expect(nodeUsers.size).toBe(1);
        expect(nodeUsers.has('user1')).toBe(false);
        expect(nodeUsers.has('user2')).toBe(true);
        expect(stateService.nodeUsernames.get(nodeAddress)).toEqual(['TestAvatar2']);
        expect(mockSocket2.emit).toHaveBeenCalledWith('users update', ['TestAvatar2']);
        expect(mockUser.findById).toHaveBeenCalledTimes(1);
        expect(mockUser.findById).toHaveBeenCalledWith('user2');
    });

    test('should handle removing last user from node', async () => {
        // Setup mock User findById implementation
        mockUser.findById.mockImplementation(id => {
            if (id === 'user1') {
                return Promise.resolve({ avatarName: 'TestAvatar1' });
            }
            return Promise.resolve(null);
        });
        
        const nodeAddress = 'test-node';
        const mockSocket = { emit: jest.fn() };
        
        // Setup client socket and add user
        stateService.addClient('user1', mockSocket);
        await stateService.addUserToNodeAndUpdateUsernames('user1', nodeAddress);
        
        // Clear the mock calls from setup
        mockSocket.emit.mockClear();
        mockUser.findById.mockClear();
        
        // Remove the last user
        const nodeUsers = await stateService.removeUserFromNodeAndUpdateUsernames('user1', nodeAddress);
        
        // Verify node is completely removed
        expect(nodeUsers).toBeNull();
        expect(stateService.nodeClients.has(nodeAddress)).toBe(false);
        expect(stateService.nodeUsernames.has(nodeAddress)).toBe(false);
        expect(mockUser.findById).not.toHaveBeenCalled();
    });
}); 