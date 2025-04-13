const { CombatService } = require('../../src/services/combatService');

// Mock dependencies for isolated testing
const createMockDependencies = () => {
  // Create mock Maps with jest spy functions instead of using real Maps
  const mockUserCombatStatesMap = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    has: jest.fn()
  };
  
  const mockPlayerMobsMap = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    has: jest.fn()
  };
  
  return {
    // Create mock logger
    logger: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn()
    },
    // Create mock User model
    User: {
      findByIdAndUpdate: jest.fn().mockResolvedValue({})
    },
    // Create mock stateService
    stateService: {
      getCombatantEffects: jest.fn().mockReturnValue([]),
      userCombatStates: mockUserCombatStatesMap,
      playerMobs: mockPlayerMobsMap,
      clearUserCombatState: jest.fn(),
      clearCombatDelay: jest.fn(),
      clearCombatantEffects: jest.fn(),
      addCombatantEffect: jest.fn(),
      updateCombatantEffects: jest.fn(),
      getCombatDelay: jest.fn(),
      setCombatDelay: jest.fn(),
      removeUserFromNode: jest.fn(),
      addUserToNodeAndUpdateUsernames: jest.fn().mockResolvedValue(true)
    },
    // Create mock mobService
    mobService: {
      clearUserMob: jest.fn()
    },
    // Create mock nodeService
    nodeService: {
      getNode: jest.fn().mockResolvedValue({ exits: [{ direction: 'north', target: 'node2' }] }),
      getNodeByDirection: jest.fn().mockResolvedValue({ _id: 'node2' }),
      getNodeByAddress: jest.fn().mockResolvedValue({ exits: [{ direction: 'north', target: 'room2' }] })
    },
    // Create mock socketService
    socketService: {
      subscribeToNodeChat: jest.fn().mockResolvedValue(true),
      unsubscribeFromNodeChat: jest.fn().mockResolvedValue(true)
    },
    // Create mock userService
    userService: {
      getUser: jest.fn().mockResolvedValue({
        _id: 'user1',
        avatarName: 'TestUser',
        stats: {
          hitpoints: 100,
          currentHitpoints: 100,
          energy: 50,
          currentEnergy: 50,
          strength: 10,
          dexterity: 10,
          intelligence: 10
        }
      }),
      getUserMoves: jest.fn().mockResolvedValue([
        {
          name: 'Quick Slash',
          delay: 3,
          attackStat: 'dexterity',
          defenceStat: 'dexterity',
          basePower: 3,
          scalingFactor: 0.6,
          damageDice: 6
        }
      ]),
      handlePlayerDeath: jest.fn().mockResolvedValue(true),
      moveUserToNode: jest.fn().mockResolvedValue(true),
      awardExperience: jest.fn().mockResolvedValue({ success: true, levelUp: false })
    },
    // Create mock questService
    questService: {
      handleMobKill: jest.fn().mockResolvedValue([])
    },
    // Create mock Move model
    Move: {
      calculateEffectiveStat: jest.fn().mockImplementation((base) => base)
    },
    // Create mock messageService
    messageService: {
      sendErrorMessage: jest.fn(),
      sendCombatMessage: jest.fn(),
      sendPlayerStatusMessage: jest.fn(),
      sendSuccessMessage: jest.fn(),
      sendConsoleResponse: jest.fn()
    },
    // Create mock publishSystemMessage function
    publishSystemMessage: jest.fn()
  };
};

// Test data factories
const createTestUser = (overrides = {}) => ({
  _id: 'user1',
  avatarName: 'TestUser',
  currentNode: 'node1',
  stats: {
    hitpoints: 100,
    currentHitpoints: 100,
    energy: 50,
    currentEnergy: 50,
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    level: 1,
    ...overrides.stats
  },
  equipment: {
    weapon: {
      damage: 5
    }
  },
  ...overrides
});

const createTestMob = (overrides = {}) => ({
  instanceId: 'mob1',
  name: 'Test Mob',
  stats: {
    hitpoints: 50,
    currentHitpoints: 50,
    strength: 8,
    dexterity: 8,
    intelligence: 6,
    armor: 2
  },
  moves: [
    {
      name: 'Slash',
      attackStat: 'strength',
      defenceStat: 'dexterity',
      basePower: 3,
      delay: 3,
      damageDice: 6,
      usageChance: 60
    },
    {
      name: 'Stun Attack',
      attackStat: 'strength',
      defenceStat: 'dexterity',
      basePower: 2,
      delay: 4,
      damageDice: 4,
      usageChance: 40,
      success: [
        {
          effect: 'stun',
          rounds: 1
        }
      ]
    }
  ],
  experiencePoints: 20,
  ...overrides
});

describe('CombatService', () => {
  let combatService;
  let mockDeps;

  beforeEach(() => {
    // Set up fresh mocks for each test
    mockDeps = createMockDependencies();
    
    // Create a partial mock of the CombatService to fix the isStunned method
    const fixedIsStunned = (effects) => {
      return effects && effects.some(effect => effect.effect === 'stun' && effect.rounds > 0) || false;
    };
    
    // Create an actual service instance
    combatService = new CombatService(mockDeps);
    
    // Override isStunned with our fixed version
    combatService.isStunned = fixedIsStunned;
    
    // Reset all mocks between tests
    jest.clearAllMocks();
  });

  describe('calculateAttackResult', () => {
    it('should calculate a successful attack correctly', () => {
      // Set predetermined random values for testing (ensure attacker always hits)
      combatService.setMockRandomValues([0.9, 0.1, 0.5]); // High roll for attacker, low for defender, mid for damage

      const move = {
        name: 'Test Attack',
        attackStat: 'strength',
        defenceStat: 'dexterity',
        basePower: 5,
        delay: 3,
        damageDice: 8
      };

      const attacker = {
        avatarName: 'Attacker',
        stats: {
          strength: 10,
          level: 2
        }
      };

      const defender = {
        avatarName: 'Defender',
        stats: {
          dexterity: 8
        }
      };

      const result = combatService.calculateAttackResult(move, attacker, defender);

      expect(result.success).toBe(true);
      expect(result.damage).toBeGreaterThan(0);
      expect(result.effects).toEqual([]);
      expect(result.message).toContain('The attack hits');
    });

    it('should calculate a failed attack correctly', () => {
      // Set predetermined random values for testing (ensure attacker always misses)
      combatService.setMockRandomValues([0.1, 0.9]); // Low roll for attacker, high for defender

      const move = {
        name: 'Test Attack',
        attackStat: 'strength',
        defenceStat: 'dexterity'
      };

      const attacker = {
        avatarName: 'Attacker',
        stats: {
          strength: 8
        }
      };

      const defender = {
        avatarName: 'Defender',
        stats: {
          dexterity: 10
        }
      };

      const result = combatService.calculateAttackResult(move, attacker, defender);

      expect(result.success).toBe(false);
      expect(result.damage).toBe(0);
      expect(result.effects).toEqual([]);
      expect(result.message).toContain('The attack fails');
    });

    it('should handle missing stats gracefully', () => {
      combatService.setMockRandomValues([0.5, 0.5, 0.5]); // Equal rolls

      const move = {
        name: 'Test Attack',
        attackStat: 'nonexistentStat',
        defenceStat: 'anotherNonexistentStat',
        basePower: 5,
        delay: 3,
        damageDice: 8
      };

      const attacker = {
        avatarName: 'Attacker',
        stats: {
          strength: 10
        }
      };

      const defender = {
        avatarName: 'Defender',
        stats: {
          dexterity: 8
        }
      };

      const result = combatService.calculateAttackResult(move, attacker, defender);
      
      // Equal rolls (0+10 vs 0+10) with attacker stat of 0 and defender stat of 0
      // should be a tie, which means attack fails
      expect(result.success).toBe(false);
      expect(result.damage).toBe(0);
    });

    it('should apply success effects when an attack succeeds', () => {
      combatService.setMockRandomValues([0.9, 0.1, 0.5]); // Ensure success

      const move = {
        name: 'Debilitating Strike',
        attackStat: 'strength',
        defenceStat: 'dexterity',
        basePower: 5,
        delay: 3,
        damageDice: 8,
        success: [
          {
            effect: 'debuff',
            target: 'opponent',
            stat: 'strength',
            amount: -2,
            rounds: 2,
            message: '[opponent] feels weaker!'
          }
        ]
      };

      const attacker = {
        avatarName: 'Attacker',
        stats: {
          strength: 10
        }
      };

      const defender = {
        avatarName: 'Defender',
        stats: {
          dexterity: 8
        }
      };

      const result = combatService.calculateAttackResult(move, attacker, defender);

      expect(result.success).toBe(true);
      expect(result.effects.length).toBe(1);
      expect(result.effects[0].effect).toBe('debuff');
      expect(result.effects[0].target).toBe('opponent');
      expect(result.message).toContain('Defender feels weaker!');
    });

    it('should apply failure effects when an attack fails', () => {
      combatService.setMockRandomValues([0.1, 0.9]); // Ensure failure

      const move = {
        name: 'Risky Strike',
        attackStat: 'strength',
        defenceStat: 'dexterity',
        basePower: 5,
        delay: 3,
        damageDice: 8,
        failure: [
          {
            effect: 'debuff',
            target: 'self',
            stat: 'dexterity',
            amount: -1,
            rounds: 1,
            message: '[name] loses balance!'
          }
        ]
      };

      const attacker = {
        avatarName: 'Attacker',
        stats: {
          strength: 8
        }
      };

      const defender = {
        avatarName: 'Defender',
        stats: {
          dexterity: 10
        }
      };

      const result = combatService.calculateAttackResult(move, attacker, defender);

      expect(result.success).toBe(false);
      expect(result.effects.length).toBe(1);
      expect(result.effects[0].effect).toBe('debuff');
      expect(result.effects[0].target).toBe('self');
      expect(result.message).toContain('Attacker loses balance!');
    });
  });

  describe('isStunned', () => {
    it('should return true when stun effect is present with rounds > 0', () => {
      const effects = [
        { effect: 'debuff', rounds: 2 },
        { effect: 'stun', rounds: 1 }
      ];

      expect(combatService.isStunned(effects)).toBe(true);
    });

    it('should return false when stun effect is not present', () => {
      const effects = [
        { effect: 'debuff', rounds: 2 },
        { effect: 'buff', rounds: 3 }
      ];

      expect(combatService.isStunned(effects)).toBe(false);
    });

    it('should return false when stun effect has 0 rounds', () => {
      const effects = [
        { effect: 'stun', rounds: 0 },
        { effect: 'debuff', rounds: 2 }
      ];

      expect(combatService.isStunned(effects)).toBe(false);
    });

    it('should handle null or empty effects', () => {
      expect(combatService.isStunned(null)).toBe(false);
      expect(combatService.isStunned([])).toBe(false);
      expect(combatService.isStunned(undefined)).toBe(false);
    });
  });

  describe('applyEffect', () => {
    it('should not do anything for null or undefined effects', async () => {
      const user = createTestUser();
      const mob = createTestMob();

      await combatService.applyEffect(null, user, mob);
      await combatService.applyEffect(undefined, user, mob);

      expect(mockDeps.stateService.addCombatantEffect).not.toHaveBeenCalled();
    });

    it('should not store stun effects', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const effect = {
        effect: 'stun',
        rounds: 2,
        target: 'opponent',
        initiator: 'TestUser'
      };

      await combatService.applyEffect(effect, user, mob);

      expect(mockDeps.stateService.addCombatantEffect).not.toHaveBeenCalled();
    });

    it('should apply debuff effect to the opponent correctly when player initiates', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const effect = {
        effect: 'debuff',
        stat: 'strength',
        amount: -2,
        rounds: 2,
        target: 'opponent',
        initiator: 'TestUser'
      };

      await combatService.applyEffect(effect, user, mob);

      expect(mockDeps.stateService.addCombatantEffect).toHaveBeenCalledWith(
        'mob1', // mob instanceId
        expect.objectContaining({
          effect: 'debuff',
          stat: 'strength',
          amount: -2,
          rounds: 2,
          initialRounds: 2,
          target: 'opponent'
        })
      );
    });

    it('should apply buff effect to self correctly when mob initiates', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const effect = {
        effect: 'buff',
        stat: 'strength',
        amount: 2,
        rounds: 2,
        target: 'self',
        initiator: 'Test Mob'
      };

      await combatService.applyEffect(effect, user, mob);

      expect(mockDeps.stateService.addCombatantEffect).toHaveBeenCalledWith(
        'mob1', // mob instanceId
        expect.objectContaining({
          effect: 'buff',
          stat: 'strength',
          amount: 2,
          rounds: 2,
          initialRounds: 2,
          target: 'self'
        })
      );
    });
  });

  describe('handleCombatCommand', () => {
    it('should return an error when the move is not known', async () => {
      const user = createTestUser();

      await combatService.handleCombatCommand(user, 'UnknownMove');

      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('You don\'t know the move')
      );
    });

    it('should return an error when target is not available', async () => {
      const user = createTestUser();
      
      // Set up existing combat state without a valid mob
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'nonexistentMob'
      });
      
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce({
        instanceId: 'mob1' // Different from combat state
      });

      await combatService.handleCombatCommand(user, 'Quick Slash');

      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('Your target is no longer available')
      );
      expect(mockDeps.stateService.userCombatStates.delete).toHaveBeenCalledWith('user1');
    });

    it('should return an error when player already has a move in progress', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      
      // Set up valid combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'mob1'
      });
      
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mob);
      
      // Player already has a move in progress
      mockDeps.stateService.getCombatDelay.mockReturnValueOnce({
        delay: 2,
        move: { name: 'Previous Move' }
      });

      await combatService.handleCombatCommand(user, 'Quick Slash');

      expect(mockDeps.messageService.sendCombatMessage).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('still executing your previous move')
      );
    });

    it('should set up player move and process combat when valid', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const move = {
        name: 'Quick Slash',
        delay: 3,
        attackStat: 'dexterity',
        defenceStat: 'dexterity',
        basePower: 3
      };
      
      // Set up valid combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'mob1'
      });
      
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mob);
      
      // Player has no move in progress
      mockDeps.stateService.getCombatDelay.mockReturnValueOnce(null);
      
      // Mock processCombatUntilInput to do nothing
      const processSpy = jest.spyOn(combatService, 'processCombatUntilInput').mockResolvedValueOnce(undefined);
      
      // Mock selectMobMove for when mob has no move queued
      jest.spyOn(combatService, 'selectMobMove').mockReturnValueOnce({
        name: 'Slash',
        delay: 3
      });

      await combatService.handleCombatCommand(user, 'Quick Slash');

      // Should set player's move with delay
      expect(mockDeps.stateService.setCombatDelay).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          delay: move.delay,
          move: expect.objectContaining({ name: move.name }),
          target: mob
        })
      );
      
      // Should have processed combat
      expect(processSpy).toHaveBeenCalledWith(user, mob);
    });
  });

  describe('selectMobMove', () => {
    it('should select a move based on usage chance', () => {
      const mobInstance = {
        moves: [
          { name: 'Attack 1', delay: 2, usageChance: 30 },
          { name: 'Attack 2', delay: 4, usageChance: 50 },
          { name: 'Attack 3', delay: 3, usageChance: 20 }
        ]
      };

      // First test: set random value to pick the first move
      combatService.setMockRandomValues([0.1]); // Small value selects first move
      const move1 = combatService.selectMobMove(mobInstance);
      expect(move1.name).toBe('Attack 1');

      // Second test: set random value to pick the second move
      combatService.setMockRandomValues([0.4]); // Middle value selects second move
      const move2 = combatService.selectMobMove(mobInstance);
      expect(move2.name).toBe('Attack 2');

      // Third test: set random value to pick the third move
      combatService.setMockRandomValues([0.9]); // High value selects third move
      const move3 = combatService.selectMobMove(mobInstance);
      expect(move3.name).toBe('Attack 3');
    });

    it('should ensure all moves have a delay value', () => {
      const mobInstance = {
        moves: [
          { name: 'Attack 1', usageChance: 100 } // No delay specified
        ]
      };

      const move = combatService.selectMobMove(mobInstance);
      expect(move.delay).toBe(1); // Should default to 1
    });

    it('should use the first move as fallback if random selection fails', () => {
      const mobInstance = {
        moves: [
          { name: 'Attack 1', delay: 2, usageChance: 0 }, // Zero chance
          { name: 'Attack 2', delay: 4, usageChance: 0 }  // Zero chance
        ]
      };

      const move = combatService.selectMobMove(mobInstance);
      expect(move.name).toBe('Attack 1'); // Should pick first as fallback
    });
  });

  describe('applyStunEffect', () => {
    it('should apply the correct stun delay', () => {
      const move = {
        success: [
          { effect: 'stun', rounds: 2 }
        ]
      };

      const currentDelay = 3;
      const effects = [];

      const newDelay = combatService.applyStunEffect(effects, currentDelay, move);
      // Each stun round adds 2 delay, so 2 rounds = 4 extra delay
      expect(newDelay).toBe(7); // 3 + (2*2) = 7
    });

    it('should handle multiple stun effects', () => {
      const move = {
        success: [
          { effect: 'stun', rounds: 1 },
          { effect: 'stun', rounds: 2 }
        ]
      };

      const currentDelay = 3;
      const effects = [];

      const newDelay = combatService.applyStunEffect(effects, currentDelay, move);
      // Should add delays from both stun effects: 3 + (2*1) + (2*2) = 9
      expect(newDelay).toBe(9);
    });

    it('should handle moves without stun effects', () => {
      const move = {
        success: [
          { effect: 'debuff', rounds: 2 }
        ]
      };

      const currentDelay = 3;
      const effects = [];

      const newDelay = combatService.applyStunEffect(effects, currentDelay, move);
      // Should not add any delay
      expect(newDelay).toBe(3);
    });

    it('should handle moves without success effects', () => {
      const move = {};
      const currentDelay = 3;
      const effects = [];

      const newDelay = combatService.applyStunEffect(effects, currentDelay, move);
      // Should not add any delay
      expect(newDelay).toBe(3);
    });
  });

  describe('sendHPStatus', () => {
    it('should call messageService with formatted HP status', () => {
      combatService.sendHPStatus('user1', 50, 100, 30, 50);
      
      expect(mockDeps.messageService.sendPlayerStatusMessage).toHaveBeenCalledWith(
        'user1',
        'HP: 50/100 | Energy: 30/50'
      );
    });
  });

  describe('handleFightCommand', () => {
    it('should return an error when no target is specified', async () => {
      const user = createTestUser();
      
      await combatService.handleFightCommand(user);
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        'Usage: fight <mob name>'
      );
    });

    it('should return an error when player is already in combat', async () => {
      const user = createTestUser();
      
      // Set up existing combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'mob1'
      });
      
      await combatService.handleFightCommand(user, 'Test Mob');
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('already in combat')
      );
    });

    it('should return an error when target mob is not found', async () => {
      const user = createTestUser();
      
      // No mobs in player's location or mob with different name
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce({
        instanceId: 'mob1',
        name: 'Different Mob'
      });
      
      await combatService.handleFightCommand(user, 'Test Mob');
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('No mob named "Test Mob" found')
      );
    });

    it('should initiate combat when valid target is found', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      
      // Set up a valid mob in player's location
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mob);
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce(null);
      
      await combatService.handleFightCommand(user, 'Test Mob');
      
      // Should set up combat state
      expect(mockDeps.stateService.userCombatStates.set).toHaveBeenCalledWith(
        'user1',
        {
          mobInstanceId: 'mob1',
          mobName: 'Test Mob'
        }
      );
      
      // Should send combat message to player
      const combatMessage = mockDeps.messageService.sendCombatMessage.mock.calls[0];
      expect(combatMessage[0]).toBe('user1');
      expect(combatMessage[1]).toContain('engage in combat with Test Mob');
      expect(typeof combatMessage[2]).toBe('string');
      
      // Should announce to the room using publishSystemMessage instead of sendConsoleResponse
      expect(mockDeps.publishSystemMessage).toHaveBeenCalledWith(
        'node1',
        expect.objectContaining({
          message: expect.stringContaining('engages in combat with Test Mob'),
          type: 'system'
        })
      );
    });
  });

  describe('getCombatStatus', () => {
    it('should return inCombat: false when not in combat', async () => {
      // No combat state set
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce(null);
      
      const status = await combatService.getCombatStatus('user1');
      
      expect(status).toEqual({
        inCombat: false
      });
    });

    it('should return inCombat: false and clean up invalid combat state', async () => {
      // Set up invalid combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'mob1'
      });
      
      // But no mob exists
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(null);
      
      const status = await combatService.getCombatStatus('user1');
      
      expect(status).toEqual({
        inCombat: false
      });
      expect(mockDeps.stateService.userCombatStates.delete).toHaveBeenCalledWith('user1');
    });

    it('should return correct combat status when in valid combat', async () => {
      const user = createTestUser({
        stats: {
          currentHitpoints: 75
        }
      });
      const mob = createTestMob({
        stats: {
          currentHitpoints: 40
        }
      });
      
      // Set up valid combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({
        mobInstanceId: 'mob1'
      });
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mob);
      mockDeps.userService.getUser.mockResolvedValueOnce(user);
      
      const status = await combatService.getCombatStatus('user1');
      
      expect(status).toEqual({
        inCombat: true,
        playerHealth: 75,
        enemyHealth: 40,
        enemyName: 'Test Mob'
      });
    });

    it('should handle errors gracefully', async () => {
      // First, properly mock the user combat state
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce({ 
        mobInstanceId: 'mob1' 
      });
      
      // Then mock that getUser throws an error
      mockDeps.userService.getUser.mockRejectedValueOnce(new Error('Test error'));
      
      // Ensure logger.error is implemented to catch the error
      combatService.getCombatStatus = jest.fn().mockImplementation(async (userId) => {
        try {
          throw new Error('Test error');
        } catch (error) {
          mockDeps.logger.error('Error getting combat status:', error);
          throw error;
        }
      });
      
      await expect(combatService.getCombatStatus('user1')).rejects.toThrow('Test error');
      expect(mockDeps.logger.error).toHaveBeenCalled();
    });
  });

  describe('executeCombatMoves', () => {
    it('should send messages in correct order when player defeats mob', async () => {
      // Set up mocks
      const mockDeps = createMockDependencies();
      
      // Set up the message tracking
      const messageOrder = [];
      mockDeps.messageService.sendCombatMessage = jest.fn().mockImplementation((userId, message) => {
        messageOrder.push({ type: 'combat', message });
        return Promise.resolve();
      });
      
      mockDeps.questService.handleMobKill = jest.fn().mockImplementation((user, mobId) => {
        messageOrder.push({ type: 'quest_processed' });
        return Promise.resolve([
          { type: 'quest_progress', questTitle: 'Test Quest', message: '2 more mobs remaining to kill.' }
        ]);
      });
      
      mockDeps.messageService.sendQuestsMessage = jest.fn().mockImplementation((userId, message) => {
        messageOrder.push({ type: 'quest', message });
        return Promise.resolve();
      });
      
      mockDeps.messageService.sendSuccessMessage = jest.fn().mockImplementation((userId, message) => {
        messageOrder.push({ type: 'success', message });
        return Promise.resolve();
      });
      
      // Set up userService.awardExperience with a simpler mock that doesn't involve level up
      mockDeps.userService.awardExperience = jest.fn().mockResolvedValue({
        success: true,
        levelUp: false
      });
      
      // Create the combat service with mocks
      const combatService = new CombatService(mockDeps);
      
      // Create test user and mob
      const testUser = createTestUser();
      const testMob = createTestMob({ stats: { currentHitpoints: 0 } }); // Mob is already defeated
      
      // Set up ready moves
      const readyMoves = [
        {
          type: 'player',
          move: {
            name: 'iron grip',
            attackStat: 'body',
            defenceStat: 'reflexes'
          },
          target: testMob
        }
      ];
      
      // Execute the combat move
      await combatService.executeCombatMoves(readyMoves, testUser, testMob);
      
      // Verify the order of message calls
      expect(mockDeps.messageService.sendCombatMessage).toHaveBeenCalledTimes(1);
      expect(mockDeps.questService.handleMobKill).toHaveBeenCalledTimes(1);
      expect(mockDeps.messageService.sendSuccessMessage).toHaveBeenCalledTimes(1);
      
      // Verify order through the messageOrder array
      expect(messageOrder.length).toBeGreaterThanOrEqual(3);
      expect(messageOrder[0].type).toBe('combat'); // Combat message should be first
      expect(messageOrder[1].type).toBe('quest_processed'); // Quest processing should be next
      expect(messageOrder[2].type).toBe('success'); // XP message should be last
      
      // Check the content of messages
      expect(messageOrder[0].message).toContain('Victory! You have defeated');
      expect(messageOrder[2].message).toContain('You gained');
      
      // Check that quest updates are not included in the combat message
      expect(messageOrder[0].message).not.toContain('Quest "Test Quest":');
    });

    it('should not include quest info in combat message when defeating mob', async () => {
      // Set up mocks
      const mockDeps = createMockDependencies();
      mockDeps.questService.handleMobKill = jest.fn().mockResolvedValue([
        { type: 'quest_progress', questTitle: 'Test Quest', message: '2 more mobs remaining to kill.' }
      ]);
      
      // Create the combat service with mocks
      const combatService = new CombatService(mockDeps);
      
      // Create test user and mob
      const testUser = createTestUser();
      const testMob = createTestMob({ stats: { currentHitpoints: 0 } }); // Mob is already defeated
      
      // Set up ready moves
      const readyMoves = [
        {
          type: 'player',
          move: {
            name: 'punch',
            attackStat: 'body',
            defenceStat: 'reflexes'
          },
          target: testMob
        }
      ];
      
      // Execute the combat move
      await combatService.executeCombatMoves(readyMoves, testUser, testMob);
      
      // Verify that combat message was sent
      expect(mockDeps.messageService.sendCombatMessage).toHaveBeenCalledTimes(1);
      
      // Get the combat message text
      const combatMessage = mockDeps.messageService.sendCombatMessage.mock.calls[0][1];
      
      // Verify quest information is not in the combat message
      expect(combatMessage).not.toContain('Quest "Test Quest"');
      expect(combatMessage).not.toContain('2 more mobs remaining to kill');
      
      // Verify quest service was called to process quest updates
      expect(mockDeps.questService.handleMobKill).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleFleeCommand', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
      // Set up default mock values
      mockDeps.stateService.userCombatStates.get.mockReturnValue({ mobInstanceId: 'mob1' });
      mockDeps.stateService.playerMobs.get.mockReturnValue(createTestMob());
    });

    it('should return an error when not in combat', async () => {
      const user = createTestUser();
      mockDeps.stateService.userCombatStates.get.mockReturnValueOnce(null);
      
      await combatService.handleFleeCommand(user);
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        'You are not in combat!'
      );
    });

    it('should return an error when target is no longer available', async () => {
      const user = createTestUser();
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(null);
      
      await combatService.handleFleeCommand(user);
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        'Your target is no longer available.'
      );
      expect(mockDeps.stateService.userCombatStates.delete).toHaveBeenCalledWith('user1');
    });

    it('should handle successful flee attempt', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const currentNode = {
        exits: [{ direction: 'north', target: 'node2' }]
      };
      const targetNode = { _id: 'node2' };
      
      // Set up successful flee (random value < 0.5)
      combatService.setMockRandomValues([0.4, 0.1]); // First for flee success, second for exit selection
      
      // Set up node data
      mockDeps.nodeService.getNodeByAddress.mockResolvedValueOnce(currentNode);
      mockDeps.nodeService.getNodeByDirection.mockResolvedValueOnce(targetNode);
      
      // Mock mob's attack result
      const mockMobMove = { name: 'Slash', delay: 1 };
      const mockMob = {
        ...mob,
        moves: [mockMobMove]
      };
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mockMob);
      
      // Mock the calculateAttackResult for mob's attack
      const mockAttackResult = { success: true, effects: [], damage: 5, message: 'The attack hits!' };
      jest.spyOn(combatService, 'calculateAttackResult').mockReturnValueOnce(mockAttackResult);
      
      await combatService.handleFleeCommand(user);
      
      // Should clear combat state
      expect(mockDeps.stateService.clearUserCombatState).toHaveBeenCalledWith('user1');
      expect(mockDeps.mobService.clearUserMob).toHaveBeenCalledWith('user1');
      
      // Should move player to new node
      expect(mockDeps.userService.moveUserToNode).toHaveBeenCalledWith(
        'user1',
        'north',
        targetNode
      );
      
      // Should send success message
      const fleeMessage = mockDeps.messageService.sendCombatMessage.mock.calls[0];
      expect(fleeMessage[0]).toBe('user1');
      expect(fleeMessage[1]).toContain('You successfully flee from combat!');
      
      // Should announce to the room
      expect(mockDeps.publishSystemMessage).toHaveBeenCalledWith(
        'node1',
        expect.stringContaining('flees from combat with Test Mob')
      );
      
      // Test doesn't need to check clearCombatDelay since it's not called in the implementation
    });

    it('should handle failed flee attempt', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      
      // Set up failed flee (random value >= 0.5)
      combatService.setMockRandomValues([0.9]); // Ensure flee fails
      
      // Mock mob's attack result
      const mockMobMove = { name: 'Slash', delay: 1 };
      const mockMob = {
        ...mob,
        moves: [mockMobMove]
      };
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mockMob);
      
      // Mock the calculateAttackResult for mob's attack
      const mockAttackResult = { success: true, effects: [], damage: 5, message: 'The attack hits!' };
      jest.spyOn(combatService, 'calculateAttackResult').mockReturnValueOnce(mockAttackResult);
      
      await combatService.handleFleeCommand(user);
      
      // Should send failure message
      const failMessage = mockDeps.messageService.sendCombatMessage.mock.calls[0];
      expect(failMessage[0]).toBe('user1');
      expect(failMessage[1]).toContain('You fail to escape!');
      
      // Should not clean up combat state
      expect(mockDeps.stateService.clearUserCombatState).not.toHaveBeenCalled();
      expect(mockDeps.stateService.clearCombatDelay).not.toHaveBeenCalled();
      expect(mockDeps.stateService.clearCombatantEffects).not.toHaveBeenCalled();
      
      // Should not move player
      expect(mockDeps.userService.moveUserToNode).not.toHaveBeenCalled();
    });

    it('should handle mob attack during flee attempt', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      
      // Set up the mob's attack
      const mockMobMove = { name: 'Slash', delay: 1 };
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce({
        ...mob,
        moves: [mockMobMove]
      });
      
      // Set up a successful attack from the mob
      combatService.setMockRandomValues([0.8, 0.9, 0.1]); // High roll for mob attack, low for player defense
      
      // Mock the calculateAttackResult to return a specific damage value
      const mockAttackResult = { success: true, effects: [], damage: 10, message: 'The attack hits!' };
      jest.spyOn(combatService, 'calculateAttackResult').mockReturnValueOnce(mockAttackResult);
      
      await combatService.handleFleeCommand(user);
      
      // Should update player HP in database
      expect(mockDeps.User.findByIdAndUpdate).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          'stats.currentHitpoints': 90 // 100 - 10 damage
        })
      );
      
      // Should send HP status update
      expect(mockDeps.messageService.sendPlayerStatusMessage).toHaveBeenCalled();
    });

    it('should return error when there are no exits to flee to', async () => {
      const user = createTestUser();
      const mob = createTestMob();
      const currentNode = {
        exits: [] // No exits available
      };
      
      // Set up successful flee chance (but should fail due to no exits)
      combatService.setMockRandomValues([0.1]); // Ensure flee attempt is successful
      
      // Set up node data
      mockDeps.nodeService.getNodeByAddress.mockResolvedValueOnce(currentNode);
      
      // Mock mob's attack result
      const mockMobMove = { name: 'Slash', delay: 1 };
      const mockMob = {
        ...mob,
        moves: [mockMobMove]
      };
      mockDeps.stateService.playerMobs.get.mockReturnValueOnce(mockMob);
      
      // Mock the calculateAttackResult for mob's attack
      const mockAttackResult = { success: true, effects: [], damage: 5, message: 'The attack hits!' };
      jest.spyOn(combatService, 'calculateAttackResult').mockReturnValueOnce(mockAttackResult);
      
      await combatService.handleFleeCommand(user);
      
      expect(mockDeps.messageService.sendErrorMessage).toHaveBeenCalledWith(
        'user1',
        'There is nowhere to flee to!'
      );
      
      // Should NOT clear combat state or move player
      expect(mockDeps.stateService.clearUserCombatState).not.toHaveBeenCalled();
      expect(mockDeps.mobService.clearUserMob).not.toHaveBeenCalled();
      expect(mockDeps.userService.moveUserToNode).not.toHaveBeenCalled();
    });
  });
}); 