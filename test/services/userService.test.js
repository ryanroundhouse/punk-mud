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
            const mockUser = {
                _id: 'user123',
                stats: {
                    hitpoints: 100,
                    currentHitpoints: 70
                }
            };
            
            mockDeps.User.findById.mockResolvedValueOnce(mockUser);
            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce({
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    currentHitpoints: 100
                }
            });
            
            const result = await userService.healUser('user123');
            
            expect(result).toEqual({
                success: true,
                healed: 100
            });

            expect(mockDeps.User.findByIdAndUpdate).toHaveBeenCalledWith(
                'user123',
                { $set: { 'stats.currentHitpoints': 100 } },
                { new: true, runValidators: true }
            );
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
            // Create mock user with experience and location data
            const mockUser = {
                _id: 'user123',
                stats: {
                    hitpoints: 100,
                    currentHitpoints: 0,
                    energy: 50,
                    currentEnergy: 30
                },
                currentNode: 'oldNode'
            };

            // Mock findById to return our test user
            mockDeps.User.findById.mockResolvedValueOnce(mockUser);

            // Mock findByIdAndUpdate to return updated user
            const expectedUpdates = {
                $set: {
                    'stats.currentHitpoints': 100,
                    'currentNode': '122.124.10.10'
                }
            };

            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce({
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    currentHitpoints: 100
                },
                currentNode: '122.124.10.10'
            });

            const result = await userService.handlePlayerDeath('user123');

            // Verify the user was updated correctly
            expect(mockDeps.User.findByIdAndUpdate).toHaveBeenCalledWith(
                'user123',
                expectedUpdates,
                { new: true, runValidators: true }
            );

            // Verify the result
            expect(result).toEqual({
                success: true,
                newLocation: '122.124.10.10',
                playerDied: true
            });
            
            // Check other expected method calls
            expect(mockDeps.stateService.removeUserFromNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', 'oldNode');
            expect(mockDeps.socketService.unsubscribeFromNodeChat).toHaveBeenCalledWith('oldNode');
            expect(mockDeps.stateService.addUserToNodeAndUpdateUsernames).toHaveBeenCalledWith('user123', '122.124.10.10');
            expect(mockDeps.socketService.subscribeToNodeChat).toHaveBeenCalledWith('122.124.10.10');
            expect(mockDeps.stateService.clearUserCombatState).toHaveBeenCalledWith('user123');
            expect(mockDeps.stateService.clearCombatDelay).toHaveBeenCalledWith('user123');
            expect(mockDeps.stateService.clearCombatantEffects).toHaveBeenCalledWith('user123');
            expect(mockDeps.mobService.clearUserMob).toHaveBeenCalledWith('user123');
            expect(mockDeps.messageService.sendConsoleResponse).toHaveBeenCalledWith('user123', {
                type: 'player death',
                newLocation: '122.124.10.10'
            });
        });

        it('should use starting room if no respawn room is set', async () => {
            // This test is no longer applicable since the respawn room is hardcoded to '122.124.10.10'
            // Instead we'll test that it always uses this room
            const mockUser = {
                _id: 'user123',
                stats: {
                    hitpoints: 100,
                    currentHitpoints: 0,
                    energy: 50,
                    currentEnergy: 30
                },
                currentNode: 'oldNode'
            };

            mockDeps.User.findById.mockResolvedValueOnce(mockUser);
            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce({
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    currentHitpoints: 100
                },
                currentNode: '122.124.10.10'
            });

            const result = await userService.handlePlayerDeath('user123');

            expect(result.newLocation).toBe('122.124.10.10');
        });

        it('should handle errors gracefully', async () => {
            // Mock findById to throw an error
            mockDeps.User.findById.mockRejectedValueOnce(new Error('Database error'));

            await expect(userService.handlePlayerDeath('user123'))
                .rejects.toThrow('Database error');

            expect(mockDeps.logger.error).toHaveBeenCalledWith(
                'Error handling player death:',
                expect.any(Error)
            );
        });

        it('should handle user not found', async () => {
            // Mock findById to return null
            mockDeps.User.findById.mockResolvedValueOnce(null);

            await expect(userService.handlePlayerDeath('user123'))
                .rejects.toThrow('User not found');
        });

        it('should handle failed update', async () => {
            // Mock successful findById
            mockDeps.User.findById.mockResolvedValueOnce({
                _id: 'user123',
                stats: {
                    hitpoints: 100,
                    currentHitpoints: 0
                },
                currentNode: 'oldNode'
            });

            // Mock failed update
            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce(null);

            await expect(userService.handlePlayerDeath('user123'))
                .rejects.toThrow('Failed to update user after death');
        });
    });

    describe('awardExperience', () => {
        beforeEach(() => {
            // Create a mock updateUserMovesForLevel method since we're not testing it directly
            userService.updateUserMovesForLevel = jest.fn().mockResolvedValue(true);
        });

        it('should award experience without level up', async () => {
            // Mock a user at level 1 with 50 XP
            const mockUser = {
                _id: 'user123',
                stats: {
                    level: 1,
                    experience: 50,
                    currentHitpoints: 100, // Ensure user is alive
                    body: 8,
                    reflexes: 8,
                    agility: 8,
                    charisma: 8,
                    tech: 8,
                    luck: 8
                }
            };

            // More direct mocking of the User.findById().populate() chain
            const populateMock = jest.fn().mockResolvedValue(mockUser);
            mockDeps.User.findById = jest.fn().mockReturnValue({ populate: populateMock });

            // Mock findByIdAndUpdate to return the updated user
            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce({
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    experience: 60
                }
            });

            const result = await userService.awardExperience('user123', 10);
            
            expect(result.success).toBe(true);
            expect(result.levelUp).toBe(false);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(1);
            expect(result.experienceGained).toBe(10);
            expect(result.totalExperience).toBe(60);
            
            // Check that only experience was updated (no level up)
            expect(mockDeps.User.findByIdAndUpdate).toHaveBeenCalledWith(
                'user123',
                {
                    $set: {
                        'stats.experience': 60
                    }
                },
                { new: true, runValidators: true }
            );
        });

        it('should handle level up correctly', async () => {
            // Mock a user about to level up (at 95 XP, level 1, needs 100 for level 2)
            const mockUser = {
                _id: 'user123',
                stats: {
                    level: 1,
                    experience: 95,
                    currentHitpoints: 100, // Ensure user is alive
                    hitpoints: 25,
                    body: 8,
                    reflexes: 8,
                    agility: 8,
                    charisma: 8,
                    tech: 8,
                    luck: 8
                }
            };

            // More direct mocking of the User.findById().populate() chain
            const populateMock = jest.fn().mockResolvedValue(mockUser);
            mockDeps.User.findById = jest.fn().mockReturnValue({ populate: populateMock });

            // After level up, stats have increased
            const updatedUser = {
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    level: 2,
                    experience: 105,
                    hitpoints: 49, // Updated hitpoints calculation: 20 + (3*2) + ((8+1)*2.5) = 20 + 6 + 22.5 = 48.5 rounded up to 49
                    currentHitpoints: 49,
                    body: 9,
                    reflexes: 9,
                    agility: 9,
                    charisma: 9,
                    tech: 9,
                    luck: 9
                }
            };

            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce(updatedUser);

            const result = await userService.awardExperience('user123', 10);
            
            expect(result.success).toBe(true);
            expect(result.levelUp).toBe(true);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(2);
            expect(result.experienceGained).toBe(10);
            expect(result.totalExperience).toBe(105);
            
            // Verify user moves were updated for the new level
            expect(userService.updateUserMovesForLevel).toHaveBeenCalledWith('user123', 2);
            
            // Check level up message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('Congratulations! You have reached level 2')
            );
        });

        it('should handle player death instead of awarding XP if player is dead', async () => {
            // Mock a dead user (0 HP)
            const mockUser = {
                _id: 'user123',
                stats: {
                    level: 1,
                    experience: 50,
                    currentHitpoints: 0, // User is dead
                    hitpoints: 100
                }
            };

            mockDeps.User.findById.mockImplementation(() => ({
                populate: jest.fn().mockResolvedValue(mockUser)
            }));

            // Mock handlePlayerDeath
            userService.handlePlayerDeath = jest.fn().mockResolvedValue({
                success: true,
                playerDied: true
            });

            const result = await userService.awardExperience('user123', 10);
            
            expect(result.success).toBe(false);
            expect(result.message).toBe('Player was defeated');
            
            // Verify handlePlayerDeath was called
            expect(userService.handlePlayerDeath).toHaveBeenCalledWith('user123');
            
            // Verify no XP was awarded
            expect(mockDeps.User.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        // Add more awardExperience tests as needed
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
            
            // Check movement messages were published
            expect(mockDeps.systemMessageService.publishUserMoveSystemMessage).toHaveBeenCalledWith(
                'oldNode123',
                'newNode456',
                expect.objectContaining({
                    _id: 'user123',
                    avatarName: 'TestUser'
                })
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
        it('should call updateUserMovesForLevel when leveling up', async () => {
            // Mock a user about to level up
            const mockUser = {
                _id: 'user123',
                stats: {
                    level: 1,
                    experience: 95,
                    currentHitpoints: 100,
                    hitpoints: 25,
                    body: 8,
                    reflexes: 8,
                    agility: 8,
                    charisma: 8,
                    tech: 8,
                    luck: 8
                }
            };

            // More direct mocking of the User.findById().populate() chain
            const populateMock = jest.fn().mockResolvedValue(mockUser);
            mockDeps.User.findById = jest.fn().mockReturnValue({ populate: populateMock });

            // After level up
            const updatedUser = {
                ...mockUser,
                stats: {
                    ...mockUser.stats,
                    level: 2,
                    experience: 105,
                    hitpoints: 49, // Updated hitpoints calculation: 20 + (3*2) + ((8+1)*2.5) = 20 + 6 + 22.5 = 48.5 rounded up to 49
                    currentHitpoints: 49,
                    body: 9,
                    reflexes: 9,
                    agility: 9,
                    charisma: 9,
                    tech: 9,
                    luck: 9
                }
            };

            mockDeps.User.findByIdAndUpdate.mockResolvedValueOnce(updatedUser);
            
            // Create a spy on the updateUserMovesForLevel method
            const updateMovesSpy = jest.spyOn(userService, 'updateUserMovesForLevel')
                .mockResolvedValueOnce(true);
            
            const result = await userService.awardExperience('user123', 10);
            
            // Verify the result
            expect(result.levelUp).toBe(true);
            expect(result.oldLevel).toBe(1);
            expect(result.newLevel).toBe(2);
            
            // Check that User.findByIdAndUpdate was called with the right parameters
            expect(mockDeps.User.findByIdAndUpdate).toHaveBeenCalledWith(
                'user123',
                {
                    $set: {
                        'stats.experience': 105,
                        'stats.level': 2,
                        'stats.body': 9,
                        'stats.reflexes': 9,
                        'stats.agility': 9,
                        'stats.charisma': 9,
                        'stats.tech': 9,
                        'stats.luck': 9,
                        'stats.hitpoints': 49,
                        'stats.currentHitpoints': 49
                    }
                },
                { new: true, runValidators: true }
            );
            
            // Verify that updateUserMovesForLevel was called with the right parameters
            expect(updateMovesSpy).toHaveBeenCalledWith('user123', 2);
            
            // Verify success message was sent
            expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalledWith(
                'user123',
                expect.stringContaining('Congratulations! You have reached level 2')
            );
        });
    });
}); 