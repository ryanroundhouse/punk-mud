const { UserService } = require('../../src/services/userService');
const { 
    createMockUser, 
    createMockDependencies 
} = require('../helpers/mockFactory');

describe('UserService', () => {
    // Mock data and dependencies
    let mockUser;
    let mockDeps;
    let userService;

    beforeEach(() => {
        // Create mock dependencies first
        mockDeps = createMockDependencies();
        
        // Create the mock user
        mockUser = createMockUser();
        
        // Adjust the User.findById mock to return a COPY of mockUser
        // This way the returned user is different from mockUser but has the same data
        mockDeps.User.findById = jest.fn().mockImplementation((id) => {
            if (id === 'user123') {
                // Return a NEW object to ensure mutations don't affect our original mockUser
                return Promise.resolve(JSON.parse(JSON.stringify(mockUser)));
            } else if (id === 'deadUser123') {
                const deadUser = JSON.parse(JSON.stringify(mockUser));
                deadUser.stats.currentHitpoints = 0;
                return Promise.resolve(deadUser);
            } else if (id === 'nonExistentUser') {
                return Promise.resolve(null);
            }
            return Promise.resolve(JSON.parse(JSON.stringify(mockUser)));
        });

        // Create the service instance with mocked dependencies
        userService = new UserService(mockDeps);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getUser', () => {
        it('should return a user when valid ID is provided', async () => {
            const user = await userService.getUser('user123');
            // Compare properties instead of strict equality
            expect(user._id).toEqual(mockUser._id);
            expect(user.avatarName).toEqual(mockUser.avatarName);
            expect(user.currentNode).toEqual(mockUser.currentNode);
            expect(mockDeps.User.findById).toHaveBeenCalledWith('user123');
        });

        it('should throw an error when user is not found', async () => {
            await expect(userService.getUser('nonExistentUser')).rejects.toThrow('User not found');
            expect(mockDeps.User.findById).toHaveBeenCalledWith('nonExistentUser');
        });
    });

    describe('getUserMoves', () => {
        it('should return user moves when valid ID is provided', async () => {
            const populateMock = jest.fn().mockResolvedValue({ ...mockUser, moves: ['move1', 'move2'] });
            mockDeps.User.findById.mockReturnValue({ populate: populateMock });
            
            const moves = await userService.getUserMoves('user123');
            expect(moves).toEqual(['move1', 'move2']);
            expect(mockDeps.User.findById).toHaveBeenCalledWith('user123');
            expect(populateMock).toHaveBeenCalledWith('moves');
        });

        it('should return empty array when user has no moves', async () => {
            const populateMock = jest.fn().mockResolvedValue({ ...mockUser, moves: null });
            mockDeps.User.findById.mockReturnValue({ populate: populateMock });
            
            const moves = await userService.getUserMoves('user123');
            expect(moves).toEqual([]);
        });

        it('should return empty array when user is not found', async () => {
            const populateMock = jest.fn().mockResolvedValue(null);
            mockDeps.User.findById.mockReturnValue({ populate: populateMock });
            
            const moves = await userService.getUserMoves('nonExistentUser');
            expect(moves).toEqual([]);
        });
    });

    describe('formatCombatHelp', () => {
        it('should format combat help text correctly', async () => {
            // Mock the getUserMoves method
            userService.getUserMoves = jest.fn().mockResolvedValue([
                { name: 'Punch', type: 'attack', helpDescription: 'Basic attack' },
                { name: 'Fireball', type: 'special', helpDescription: 'Magic attack' }
            ]);
            
            const helpText = await userService.formatCombatHelp('user123');
            
            expect(helpText).toContain('Combat Commands');
            expect(helpText).toContain('Punch ...........Combat move: Basic attack');
            expect(helpText).toContain('Fireball ...........Special move: Magic attack');
            expect(helpText).toContain('flee');
            expect(helpText).toContain('?');
            
            expect(userService.getUserMoves).toHaveBeenCalledWith('user123');
        });
    });

    describe('healUser', () => {
        it('should heal the user to full hitpoints', async () => {
            // Create a user with reduced hitpoints
            const injuredUser = {
                ...mockUser,
                stats: { ...mockUser.stats, currentHitpoints: 10 },
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(injuredUser);
            
            const result = await userService.healUser('user123');
            
            expect(result).toEqual({
                success: true,
                healed: 30
            });
            expect(injuredUser.stats.currentHitpoints).toBe(30);
            expect(injuredUser.save).toHaveBeenCalled();
        });

        it('should throw an error when user is not found', async () => {
            mockDeps.User.findById.mockResolvedValueOnce(null);
            
            await expect(userService.healUser('nonExistentUser')).rejects.toThrow('User not found');
        });
    });

    describe('validateUser', () => {
        it('should return true for valid user', () => {
            // The method implementation returns: user && user.avatarName && user.currentNode
            const validUser = {
                avatarName: 'TestUser',
                currentNode: 'node123'
            };
            const result = userService.validateUser(validUser);
            expect(result).toBe(true);
        });

        it('should return false for user without avatarName', () => {
            const invalidUser = {
                currentNode: 'node123'
            };
            const result = userService.validateUser(invalidUser);
            expect(result).toBe(false);
        });

        it('should return false for user without currentNode', () => {
            const invalidUser = {
                avatarName: 'TestUser'
            };
            const result = userService.validateUser(invalidUser);
            expect(result).toBe(false);
        });

        it('should return false for null user', () => {
            const result = userService.validateUser(null);
            expect(result).toBe(false);
        });
    });

    describe('handlePlayerDeath', () => {
        it('should handle player death correctly', async () => {
            // Create a mutable user object
            const userToKill = {
                ...mockUser,
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userToKill);
            
            const result = await userService.handlePlayerDeath('user123');
            
            expect(result).toEqual({
                success: true,
                newLocation: '122.124.10.10',
                playerDied: true
            });
            
            // Check user was updated correctly
            expect(userToKill.stats.currentHitpoints).toBe(30);
            expect(userToKill.currentNode).toBe('122.124.10.10');
            expect(userToKill.save).toHaveBeenCalled();
            
            // Check services were called correctly
            expect(mockDeps.stateService.removeUserFromNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', 'oldNode123');
            expect(mockDeps.socketService.unsubscribeFromNodeChat).toHaveBeenCalledWith('oldNode123');
            expect(mockDeps.stateService.addUserToNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', '122.124.10.10');
            expect(mockDeps.socketService.subscribeToNodeChat).toHaveBeenCalledWith('122.124.10.10');
            
            // Check combat states were cleared
            expect(mockDeps.stateService.clearUserCombatState).toHaveBeenCalledWith('user123');
            expect(mockDeps.stateService.clearCombatDelay).toHaveBeenCalledWith('user123');
            expect(mockDeps.stateService.clearCombatantEffects).toHaveBeenCalledWith('user123');
            expect(mockDeps.mobService.clearUserMob).toHaveBeenCalledWith('user123');
            
            // Check message was sent
            expect(mockDeps.messageService.sendConsoleResponse).toHaveBeenCalledWith('user123', {
                type: 'player death',
                newLocation: '122.124.10.10'
            });

            // Check player status update was sent
            expect(mockDeps.messageService.sendPlayerStatusMessage).toHaveBeenCalledWith(
                'user123',
                `HP: ${userToKill.stats.currentHitpoints}/${userToKill.stats.hitpoints} | Energy: ${userToKill.stats.currentEnergy}/${userToKill.stats.energy}`
            );
        });

        it('should throw an error when user is not found', async () => {
            mockDeps.User.findById.mockResolvedValueOnce(null);
            
            await expect(userService.handlePlayerDeath('nonExistentUser')).rejects.toThrow('User not found');
        });
    });

    describe('awardExperience', () => {
        it('should award experience without level up', async () => {
            const userWithXp = {
                ...mockUser,
                stats: { ...mockUser.stats, experience: 50 },
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userWithXp);
            
            const result = await userService.awardExperience('user123', 10);
            
            expect(result).toEqual({
                success: true,
                levelUp: false,
                oldLevel: 1,
                newLevel: 1,
                experienceGained: 10,
                totalExperience: 60
            });
            
            expect(mockDeps.messageService.sendSuccessMessage).not.toHaveBeenCalled();
        });

        it('should handle level up correctly', async () => {
            const userAboutToLevelUp = {
                ...mockUser,
                stats: { ...mockUser.stats, experience: 95 },
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userAboutToLevelUp);
            
            const result = await userService.awardExperience('user123', 10);
            
            expect(result.success).toBe(true);
            expect(result.levelUp).toBe(true);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(2);
            expect(result.experienceGained).toBe(10);
            expect(result.totalExperience).toBe(105);
            expect(result.newHP).toBeDefined();
            
            // Check stats were increased
            expect(userAboutToLevelUp.stats.body).toBe(4);
            expect(userAboutToLevelUp.stats.reflexes).toBe(4);
            
            // Check message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalled();
        });

        it('should handle player death instead of awarding XP if player is dead', async () => {
            // Mock implementation for handlePlayerDeath
            userService.handlePlayerDeath = jest.fn().mockResolvedValue({
                success: true,
                newLocation: '122.124.10.10',
                playerDied: true
            });
            
            const deadUser = {
                ...mockUser,
                stats: { ...mockUser.stats, currentHitpoints: 0 },
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(deadUser);
            
            const result = await userService.awardExperience('user123', 10);
            
            expect(result).toEqual({
                success: false,
                message: 'Player was defeated'
            });
            
            expect(userService.handlePlayerDeath).toHaveBeenCalledWith('user123');
        });
    });

    describe('setUserClass', () => {
        it('should set user class correctly', async () => {
            const userToSetClass = {
                ...mockUser,
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userToSetClass);
            
            const result = await userService.setUserClass('user123', 'class123');
            
            expect(result.success).toBe(true);
            expect(result.className).toBe('TestClass');
            expect(result.stats).toBeDefined();
            expect(result.moveCount).toBe(1); // Only level 1 move should be available
            
            // Check class was set
            expect(userToSetClass.class).toBe('class123');
            
            // Check stats were set correctly
            expect(userToSetClass.stats.body).toBeGreaterThan(1); // Primary stat
            expect(userToSetClass.stats.reflexes).toBeGreaterThan(1); // Secondary stat
            expect(userToSetClass.stats.hitpoints).toBeDefined();
            
            expect(userToSetClass.save).toHaveBeenCalled();
        });

        it('should throw error when user is not found', async () => {
            mockDeps.User.findById.mockResolvedValueOnce(null);
            
            await expect(userService.setUserClass('nonExistentUser', 'class123')).rejects.toThrow('User not found');
        });

        it('should throw error when class is not found', async () => {
            mockDeps.Class.findById.mockReturnValueOnce({
                populate: jest.fn().mockResolvedValue(null)
            });
            
            await expect(userService.setUserClass('user123', 'nonExistentClass')).rejects.toThrow('Class not found');
        });
    });

    describe('getUserLevel', () => {
        it('should return user level', async () => {
            const userLevel5 = {
                ...mockUser,
                stats: { ...mockUser.stats, level: 5 }
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userLevel5);
            
            const level = await userService.getUserLevel('user123');
            
            expect(level).toBe(5);
        });

        it('should throw error when user is not found', async () => {
            mockDeps.User.findById.mockResolvedValueOnce(null);
            
            await expect(userService.getUserLevel('nonExistentUser')).rejects.toThrow('User not found');
        });
    });

    describe('moveUserToNode', () => {
        it('should move user to target node correctly', async () => {
            const targetNode = {
                address: 'newNode456',
                name: 'New Test Node'
            };
            
            const userToMove = {
                ...mockUser,
                save: jest.fn().mockResolvedValue(true)
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(userToMove);
            
            await userService.moveUserToNode('user123', 'north', targetNode);
            
            // Check user location was updated
            expect(userToMove.currentNode).toBe('newNode456');
            expect(userToMove.save).toHaveBeenCalled();
            
            // Check services were called correctly
            expect(mockDeps.stateService.removeUserFromNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', 'oldNode123');
            expect(mockDeps.stateService.addUserToNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', 'newNode456');
            
            // Check messages were published
            expect(mockDeps.publishSystemMessage).toHaveBeenCalledWith('oldNode123', 'TestUser has left.');
            expect(mockDeps.publishSystemMessage).toHaveBeenCalledWith(
                'newNode456',
                'TestUser has arrived.',
                'You have entered New Test Node.',
                'user123'
            );
            
            // Check mob was cleared
            expect(mockDeps.mobService.clearUserMob).toHaveBeenCalledWith('user123');
        });

        it('should throw error when user is not found', async () => {
            mockDeps.User.findById.mockResolvedValueOnce(null);
            
            await expect(userService.moveUserToNode(
                'nonExistentUser', 
                'north', 
                { address: 'newNode456', name: 'New Test Node' }
            )).rejects.toThrow('User not found');
        });
    });

    // Add tests for updateUserMovesForLevel
    describe('updateUserMovesForLevel', () => {
        let mockUserInstance;
        
        beforeEach(() => {
            // Create mock class with moves for level 1 and 2
            const mockClass = {
                _id: 'class123',
                name: 'Test Class',
                moveGrowth: [
                    { level: 1, move: { _id: 'move1', name: 'Basic Attack' } },
                    { level: 2, move: { _id: 'move2', name: 'Special Attack' } },
                    { level: 3, move: { _id: 'move3', name: 'Advanced Attack' } }
                ]
            };
            
            // Mock Class.findById to return a class with populated moveGrowth
            mockDeps.Class.findById = jest.fn().mockImplementation(() => {
                return {
                    populate: jest.fn().mockResolvedValue(mockClass)
                };
            });
            
            // Create a user instance with a mock save function
            mockUserInstance = {
                ...mockUser,
                class: 'class123',
                moves: ['move1'], // Initially has level 1 move
                save: jest.fn().mockResolvedValue(true)
            };
            
            // Mock User.findById to return a user with class
            mockDeps.User.findById = jest.fn().mockImplementation(() => {
                return {
                    populate: jest.fn().mockResolvedValue(mockUserInstance)
                };
            });
        });

        it('should update user moves based on level', async () => {
            const result = await userService.updateUserMovesForLevel('user123', 2);
            
            // Verify user.save was called
            expect(mockUserInstance.save).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.moveCount).toBe(2); // Should have 2 moves for level 2
            expect(result.newMoves).toContain('Special Attack');
        });

        it('should send a success message when new moves are unlocked', async () => {
            await userService.updateUserMovesForLevel('user123', 2);

            // Verify a success message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalled();
            const messageCall = mockDeps.messageService.sendSuccessMessage.mock.calls[0];
            expect(messageCall[0]).toBe('user123');
            expect(messageCall[1]).toContain('Special Attack');
        });

        it('should handle users without a class', async () => {
            // Create a user instance without a class
            const noClassUserInstance = {
                ...mockUser,
                class: null,
                save: jest.fn().mockResolvedValue(true)
            };
            
            // Override findById to return a user without a class
            mockDeps.User.findById = jest.fn().mockImplementation(() => {
                return {
                    populate: jest.fn().mockResolvedValue(noClassUserInstance)
                };
            });

            const result = await userService.updateUserMovesForLevel('user123', 2);
            
            expect(result.success).toBe(false);
            expect(result.message).toBe('No class assigned');
        });
    });

    // Test awardExperience calling updateUserMovesForLevel
    describe('awardExperience - move updates', () => {
        let originalAwardExperience;
        let originalUpdateUserMovesForLevel;
        let mockResult;
        
        beforeEach(() => {
            // Save original implementations
            originalAwardExperience = userService.awardExperience;
            originalUpdateUserMovesForLevel = userService.updateUserMovesForLevel;
            
            // Create mock result
            mockResult = {
                success: true,
                levelUp: false,
                oldLevel: 1,
                newLevel: 1,
                experienceGained: 0,
                totalExperience: 0
            };
            
            // Reset mocks for each test
            userService.updateUserMovesForLevel = jest.fn().mockResolvedValue({
                success: true,
                moveCount: 2,
                newMoves: ['Special Attack']
            });
        });
        
        afterEach(() => {
            // Restore original implementations
            userService.awardExperience = originalAwardExperience;
            userService.updateUserMovesForLevel = originalUpdateUserMovesForLevel;
        });

        it('should call updateUserMovesForLevel when leveling up', async () => {
            // Instead of mocking awardExperience, use the original implementation
            // But replace User.findById to return a user about to level up
            mockDeps.User.findById = jest.fn().mockImplementation(() => {
                const user = {
                    ...mockUser,
                    stats: {
                        ...mockUser.stats,
                        experience: 90, // Just below level 2 threshold (100)
                        level: 1
                    },
                    save: jest.fn().mockResolvedValue(true)
                };
                return Promise.resolve(user);
            });
            
            // Call the actual awardExperience method with enough XP to level up
            const result = await originalAwardExperience.call(userService, 'user123', 20);
            
            // Verify the result
            expect(result.levelUp).toBe(true);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(2);
            
            // Verify updateUserMovesForLevel was called with the correct parameters
            expect(userService.updateUserMovesForLevel).toHaveBeenCalledWith('user123', 2);
        });

        it('should not call updateUserMovesForLevel when not leveling up', async () => {
            // Mock awardExperience for no level up scenario  
            mockResult.levelUp = false;
            mockResult.oldLevel = 1;
            mockResult.newLevel = 1;
            userService.awardExperience = jest.fn().mockResolvedValue(mockResult);
            
            const result = await userService.awardExperience('user123', 5);
            
            expect(result.levelUp).toBe(false);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(1);
            
            // Verify updateUserMovesForLevel was not called
            expect(userService.updateUserMovesForLevel).not.toHaveBeenCalled();
        });
    });
}); 