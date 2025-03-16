const { EventChoiceProcessor } = require('../../src/services/eventChoiceProcessor');

describe('EventChoiceProcessor', () => {
  let processor;
  let mockLogger;
  let mockUser;
  let mockEventNodeService;
  let mockEventStateManager;
  let mockMessageService;
  let mockQuestService;
  let mockMobService;
  let mockCombatService;
  let mockStateService;
  let mockUserData;
  
  beforeEach(() => {
    // Create mock dependencies
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    
    // Mock user data
    mockUserData = {
      _id: 'user123',
      avatarName: 'TestUser',
      currentNode: 'test-node',
      stats: {
        strength: 10,
        dexterity: 12,
        intelligence: 14,
        wisdom: 8
      },
      quests: [
        { questId: 'existing-quest', completed: false },
        { questId: 'completed-quest', completed: true }
      ],
      class: { name: 'Enforcer' }
    };
    
    // Fix User mock - proper findById method
    mockUser = function() {};
    mockUser.findById = jest.fn().mockResolvedValue(mockUserData);
    
    mockEventNodeService = {
      cloneNode: jest.fn(node => JSON.parse(JSON.stringify(node))),
      validateNodeStructure: jest.fn(node => node),
      ensureNodeHasId: jest.fn(node => {
        if (!node._id) {
          node._id = 'generated_id';
        }
        return node;
      }),
      ensureConsistentQuestEvents: jest.fn(node => node)
    };
    
    mockEventStateManager = {
      clearActiveEvent: jest.fn(),
      setActiveEvent: jest.fn(),
      getActiveEvent: jest.fn(),
      isInEvent: jest.fn()
    };
    
    mockMessageService = {
      sendSuccessMessage: jest.fn(),
      sendErrorMessage: jest.fn(),
      sendCombatMessage: jest.fn(),
      sendConsoleResponse: jest.fn()
    };
    
    mockQuestService = {
      handleQuestProgression: jest.fn().mockResolvedValue({ success: true })
    };
    
    mockMobService = {
      loadMobFromEvent: jest.fn()
    };
    
    mockCombatService = {
      processCombatUntilInput: jest.fn()
    };
    
    mockStateService = {
      setPlayerMob: jest.fn(),
      setUserCombatState: jest.fn(),
      clearPlayerMob: jest.fn(),
      clearUserCombatState: jest.fn()
    };
    
    // Create processor with mocked dependencies
    processor = new EventChoiceProcessor({
      logger: mockLogger,
      User: mockUser,
      eventNodeService: mockEventNodeService,
      messageService: mockMessageService
    });
    
    // Set up lazy-loaded services
    processor._questService = mockQuestService;
    processor._mobService = mockMobService;
    processor._combatService = mockCombatService;
    processor._stateService = mockStateService;
    processor._eventStateManager = mockEventStateManager;
  });
  
  describe('filterChoicesByRestrictions', () => {
    it('should filter out choices that activate quests the user already has', () => {
      const choices = [
        { text: 'Choice 1', nextNode: {} },
        { text: 'Choice 2', nextNode: { activateQuestId: 'existing-quest' } },
        { text: 'Choice 3', nextNode: { activateQuestId: 'new-quest' } }
      ];
      
      const result = processor.filterChoicesByRestrictions(choices, mockUserData);
      
      expect(result).toHaveLength(2);
      expect(result[0].choice.text).toBe('Choice 1');
      expect(result[1].choice.text).toBe('Choice 3');
    });
    
    it('should filter out choices with noClass restriction when user has a class', () => {
      const choices = [
        { text: 'Choice 1', nextNode: {} },
        { text: 'Choice 2', nextNode: { restrictions: ['noClass'] } },
        { text: 'Choice 3', nextNode: { restrictions: ['someOtherRestriction'] } }
      ];
      
      const result = processor.filterChoicesByRestrictions(choices, mockUserData);
      
      expect(result).toHaveLength(2);
      expect(result[0].choice.text).toBe('Choice 1');
      expect(result[1].choice.text).toBe('Choice 3');
    });
    
    it('should filter out choices with enforcerOnly restriction when user is not an enforcer', () => {
      const nonEnforcerUser = {
        ...mockUserData,
        class: { name: 'Hacker' }
      };
      
      const choices = [
        { text: 'Choice 1', nextNode: {} },
        { text: 'Choice 2', nextNode: { restrictions: ['enforcerOnly'] } },
        { text: 'Choice 3', nextNode: { restrictions: ['someOtherRestriction'] } }
      ];
      
      const result = processor.filterChoicesByRestrictions(choices, nonEnforcerUser);
      
      expect(result).toHaveLength(2);
      expect(result[0].choice.text).toBe('Choice 1');
      expect(result[1].choice.text).toBe('Choice 3');
    });
    
    it('should keep choices with enforcerOnly restriction when user is an enforcer', () => {
      const choices = [
        { text: 'Choice 1', nextNode: {} },
        { text: 'Choice 2', nextNode: { restrictions: ['enforcerOnly'] } },
        { text: 'Choice 3', nextNode: { restrictions: ['someOtherRestriction'] } }
      ];
      
      const result = processor.filterChoicesByRestrictions(choices, mockUserData);
      
      expect(result).toHaveLength(3);
    });
    
    it('should keep track of original indices', () => {
      const choices = [
        { text: 'Choice 1', nextNode: {} },
        { text: 'Choice 2', nextNode: { activateQuestId: 'existing-quest' } },
        { text: 'Choice 3', nextNode: { activateQuestId: 'new-quest' } }
      ];
      
      const result = processor.filterChoicesByRestrictions(choices, mockUserData);
      
      expect(result).toHaveLength(2);
      expect(result[0].originalIndex).toBe(0);
      expect(result[1].originalIndex).toBe(2);
    });
  });
  
  describe('validateChoiceInput', () => {
    let validChoices;
    
    beforeEach(() => {
      validChoices = [
        { choice: { text: 'Choice 1' }, originalIndex: 0 },
        { choice: { text: 'Choice 2' }, originalIndex: 1 },
        { choice: { text: 'Choice 3' }, originalIndex: 2 }
      ];
    });
    
    it('should return error for non-numeric input', () => {
      const result = processor.validateChoiceInput('abc', validChoices);
      
      expect(result.error).toBe(true);
      expect(result.message).toContain('Please enter a number between 1 and 3');
      expect(result.selectedChoice).toBeNull();
    });
    
    it('should return error for out-of-range input (too low)', () => {
      const result = processor.validateChoiceInput('0', validChoices);
      
      expect(result.error).toBe(true);
      expect(result.message).toContain('Invalid choice');
      expect(result.selectedChoice).toBeNull();
    });
    
    it('should return error for out-of-range input (too high)', () => {
      const result = processor.validateChoiceInput('4', validChoices);
      
      expect(result.error).toBe(true);
      expect(result.message).toContain('Invalid choice');
      expect(result.selectedChoice).toBeNull();
    });
    
    it('should return the selected choice for valid input', () => {
      const result = processor.validateChoiceInput('2', validChoices);
      
      expect(result.error).toBe(false);
      expect(result.selectedChoice).toBe(validChoices[1].choice);
      expect(result.selectedIndex).toBe(1);
    });
  });
  
  describe('handleCombatChoice', () => {
    let mockMobInstance;
    let combatChoice;
    
    beforeEach(() => {
      mockMobInstance = {
        instanceId: 'mob-instance-123',
        mobId: 'mob-123',
        name: 'Test Monster'
      };
      
      combatChoice = {
        text: 'Fight the monster',
        mobId: 'mob-123'
      };
      
      mockMobService.loadMobFromEvent.mockResolvedValue(mockMobInstance);
    });
    
    it('should clear active event when initiating combat', async () => {
      await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
    });
    
    it('should load the mob from the event', async () => {
      await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockMobService.loadMobFromEvent).toHaveBeenCalledWith({ mobId: 'mob-123' });
    });
    
    it('should handle failure to load mob', async () => {
      mockMobService.loadMobFromEvent.mockResolvedValue(null);
      
      const result = await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(result.message).toContain('creature, but it seems to have fled');
      expect(result.isEnd).toBe(true);
    });
    
    it('should set up combat state and send messages', async () => {
      await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockStateService.setPlayerMob).toHaveBeenCalledWith('user123', mockMobInstance);
      expect(mockStateService.setUserCombatState).toHaveBeenCalledWith('user123', {
        mobInstanceId: 'mob-instance-123',
        mobName: 'Test Monster'
      });
      expect(mockMessageService.sendCombatMessage).toHaveBeenCalled();
      expect(mockMessageService.sendConsoleResponse).toHaveBeenCalled();
    });
    
    it('should process combat until input is required', async () => {
      await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockCombatService.processCombatUntilInput).toHaveBeenCalledWith(mockUserData, mockMobInstance);
    });
    
    it('should handle errors in combat processing', async () => {
      mockCombatService.processCombatUntilInput.mockRejectedValue(new Error('Combat error'));
      
      const result = await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockLogger.error).toHaveBeenCalled();
      expect(result.isEnd).toBe(true);
      expect(result.combatInitiated).toBe(true);
    });
    
    it('should handle errors in mob loading process', async () => {
      mockMobService.loadMobFromEvent.mockRejectedValue(new Error('Mob loading error'));
      
      const result = await processor.handleCombatChoice(combatChoice, mockUserData, 'user123');
      
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockStateService.clearPlayerMob).toHaveBeenCalledWith('user123');
      expect(mockStateService.clearUserCombatState).toHaveBeenCalledWith('user123');
      expect(result.message).toContain('Something went wrong');
      expect(result.isEnd).toBe(true);
    });
  });
  
  describe('handleSkillCheck', () => {
    let skillCheckChoice;
    
    beforeEach(() => {
      skillCheckChoice = {
        text: 'Try to pick the lock',
        skillCheckStat: 'dexterity',
        skillCheckTargetNumber: 15,
        nextNode: { prompt: 'Success path' },
        failureNode: { prompt: 'Failure path' }
      };
      
      // Mock Math.random to return a predictable value
      jest.spyOn(global.Math, 'random').mockReturnValue(0.5);
    });
    
    afterEach(() => {
      jest.spyOn(global.Math, 'random').mockRestore();
    });
    
    it('should pass the skill check when roll + stat >= target', async () => {
      // Mock to ensure we pass the check (0.5 * 20 + 1 = 11, plus dexterity 12 = 23 > 15)
      const result = await processor.handleSkillCheck(skillCheckChoice, mockUserData, 'user123');
      
      expect(mockMessageService.sendSuccessMessage).toHaveBeenCalled();
      expect(result.shouldContinue).toBe(true);
      expect(result.updatedChoice).toBe(skillCheckChoice);
    });
    
    it('should fail the skill check when roll + stat < target', async () => {
      // Increase target number to ensure failure
      skillCheckChoice.skillCheckTargetNumber = 30;
      
      const result = await processor.handleSkillCheck(skillCheckChoice, mockUserData, 'user123');
      
      expect(mockMessageService.sendErrorMessage).toHaveBeenCalled();
      expect(result.shouldContinue).toBe(true);
      expect(result.updatedChoice.nextNode).toBe(skillCheckChoice.failureNode);
    });
    
    it('should end event if passed but no nextNode exists', async () => {
      skillCheckChoice.nextNode = null;
      
      const result = await processor.handleSkillCheck(skillCheckChoice, mockUserData, 'user123');
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
      expect(mockMessageService.sendSuccessMessage).toHaveBeenCalled();
      expect(result.shouldContinue).toBe(false);
      expect(result.isEnd).toBe(true);
    });
    
    it('should end event if failed but no failureNode exists', async () => {
      skillCheckChoice.skillCheckTargetNumber = 30;
      skillCheckChoice.failureNode = null;
      
      const result = await processor.handleSkillCheck(skillCheckChoice, mockUserData, 'user123');
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
      expect(mockMessageService.sendErrorMessage).toHaveBeenCalled();
      expect(result.shouldContinue).toBe(false);
      expect(result.isEnd).toBe(true);
    });
  });
  
  describe('handleQuestEvents', () => {
    it('should process quest completion events', async () => {
      const choice = {
        text: 'Complete quest',
        nextNode: {
          prompt: 'Quest completed',
          questCompletionEvents: ['quest-event-1', 'quest-event-2']
        }
      };
      
      const result = await processor.handleQuestEvents(choice, mockUserData, 'user123', 'actor123', false);
      
      expect(mockQuestService.handleQuestProgression).toHaveBeenCalledWith(
        mockUserData,
        'actor123',
        ['quest-event-1', 'quest-event-2']
      );
      expect(mockUser.findById).toHaveBeenCalledWith('user123');
    });
    
    it('should handle quest activation', async () => {
      const choice = {
        text: 'Activate quest',
        nextNode: {
          prompt: 'Quest activated',
          activateQuestId: 'new-quest-123'
        }
      };
      
      await processor.handleQuestEvents(choice, mockUserData, 'user123', 'actor123', false);
      
      expect(mockQuestService.handleQuestProgression).toHaveBeenCalledWith(
        mockUserData,
        'actor123',
        [],
        'new-quest-123'
      );
      expect(mockUser.findById).toHaveBeenCalledWith('user123');
    });
    
    it('should handle both quest completion and activation', async () => {
      const choice = {
        text: 'Complete and activate',
        nextNode: {
          prompt: 'Quests handled',
          questCompletionEvents: ['quest-event-1'],
          activateQuestId: 'new-quest-123'
        }
      };
      
      await processor.handleQuestEvents(choice, mockUserData, 'user123', 'actor123', false);
      
      expect(mockQuestService.handleQuestProgression).toHaveBeenCalledTimes(2);
      expect(mockUser.findById).toHaveBeenCalledTimes(2);
    });
    
    it('should return updated user after quest processing', async () => {
      const choice = {
        text: 'Complete quest',
        nextNode: {
          prompt: 'Quest completed',
          questCompletionEvents: ['quest-event-1']
        }
      };
      
      const updatedUser = { ...mockUserData, quests: [...mockUserData.quests, { questId: 'new-quest', completed: false }] };
      mockUser.findById.mockResolvedValueOnce(updatedUser);
      
      const result = await processor.handleQuestEvents(choice, mockUserData, 'user123', 'actor123', false);
      
      expect(result).toEqual(updatedUser);
    });
  });
  
  describe('executeChoice', () => {
    // Mock formatEventResponse inside executeChoice
    beforeEach(() => {
      // Mock formatEventResponse by adding it to the prototype
      processor.formatEventResponse = jest.fn().mockImplementation(async (node, userId) => {
        return {
          message: node.prompt,
          hasChoices: node.choices?.length > 0,
          isEnd: !node.choices || node.choices.length === 0
        };
      });
    });
    
    it('should handle a combat choice', async () => {
      const choice = {
        text: 'Fight monster',
        mobId: 'mob-123'
      };
      
      const mockMobInstance = {
        instanceId: 'mob-instance-123',
        mobId: 'mob-123',
        name: 'Test Monster'
      };
      
      mockMobService.loadMobFromEvent.mockResolvedValue(mockMobInstance);
      
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false
      };
      
      await processor.executeChoice(choice, mockUserData, 'user123', activeEvent);
      
      expect(mockEventNodeService.cloneNode).toHaveBeenCalledWith(choice);
      expect(mockMobService.loadMobFromEvent).toHaveBeenCalled();
    });
    
    it('should handle a teleport choice', async () => {
      const choice = {
        text: 'Teleport',
        teleportToNode: 'destination-node-123',
        nextNode: { prompt: 'You have arrived' }
      };
      
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false
      };
      
      const result = await processor.executeChoice(choice, mockUserData, 'user123', activeEvent);
      
      expect(result.teleportAction).toEqual({ targetNode: 'destination-node-123' });
    });
    
    it('should handle a skill check choice', async () => {
      const choice = {
        text: 'Try to pick the lock',
        skillCheckStat: 'dexterity',
        skillCheckTargetNumber: 15,
        nextNode: { prompt: 'Success path' },
        failureNode: { prompt: 'Failure path' }
      };
      
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false
      };
      
      // Mock the handleSkillCheck method specifically for this test
      const mockResult = {
        shouldContinue: true,
        updatedChoice: choice,
        message: 'Success message'
      };
      
      processor.handleSkillCheck = jest.fn().mockResolvedValue(mockResult);
      
      await processor.executeChoice(choice, mockUserData, 'user123', activeEvent);
      
      // Verify handleSkillCheck was called instead of checking for sendSuccessMessage
      expect(processor.handleSkillCheck).toHaveBeenCalledWith(
        choice, 
        mockUserData, 
        'user123'
      );
    });
    
    it('should end event when choice has no nextNode', async () => {
      const choice = {
        text: 'End the conversation'
        // No nextNode
      };
      
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false
      };
      
      const result = await processor.executeChoice(choice, mockUserData, 'user123', activeEvent);
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
      expect(result.isEnd).toBe(true);
      expect(result.message).toBe('End the conversation');
    });
    
    it('should update event state and format response for continuing event', async () => {
      const choice = {
        text: 'Continue conversation',
        nextNode: {
          prompt: 'What would you like to know?',
          choices: [
            { text: 'Tell me about yourself' },
            { text: 'Tell me about this place' }
          ]
        }
      };
      
      const activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false
      };
      
      // Set up mock response
      processor.formatEventResponse.mockResolvedValueOnce({
        message: 'What would you like to know?\n\nResponses:\n1. Tell me about yourself\n2. Tell me about this place',
        hasChoices: true,
        isEnd: false
      });
      
      const result = await processor.executeChoice(choice, mockUserData, 'user123', activeEvent);
      
      expect(mockEventNodeService.ensureNodeHasId).toHaveBeenCalled();
      expect(mockEventNodeService.ensureConsistentQuestEvents).toHaveBeenCalled();
      expect(mockEventStateManager.setActiveEvent).toHaveBeenCalled();
      
      // Check response is what was returned from formatEventResponse
      expect(result.hasChoices).toBe(true);
      expect(result.message).toBe('What would you like to know?\n\nResponses:\n1. Tell me about yourself\n2. Tell me about this place');
    });
  });
  
  describe('processEventChoice', () => {
    let activeEvent;
    
    beforeEach(() => {
      activeEvent = {
        eventId: 'event-123',
        actorId: 'actor-123',
        isStoryEvent: false,
        currentNode: {
          prompt: 'What do you want to do?',
          choices: [
            { text: 'Option 1', nextNode: { prompt: 'Result 1' } },
            { text: 'Option 2', nextNode: { prompt: 'Result 2' } }
          ]
        }
      };
      
      // Mock all the methods used inside processEventChoice
      processor.filterChoicesByRestrictions = jest.fn().mockImplementation((choices, user) => {
        // Return all choices as valid for tests
        return choices.map((choice, index) => ({ choice, originalIndex: index }));
      });
      
      processor.validateChoiceInput = jest.fn().mockImplementation((input, validChoices) => {
        if (input === '3') {
          return {
            error: true,
            message: 'Invalid choice. Please choose 1-2.'
          };
        }
        if (isNaN(parseInt(input))) {
          return {
            error: true,
            message: 'Please enter a number between 1 and 2.'
          };
        }
        
        const index = parseInt(input) - 1;
        return {
          error: false,
          selectedChoice: validChoices[index].choice,
          selectedIndex: index
        };
      });
      
      processor.executeChoice = jest.fn().mockResolvedValue({
        message: 'Execution result',
        hasChoices: false,
        isEnd: true
      });
    });
    
    it('should end event if there are no choices', async () => {
      activeEvent.currentNode.choices = [];
      
      const result = await processor.processEventChoice('user123', activeEvent, '1');
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
      expect(result).toBeNull();
    });
    
    it('should return error message for non-numeric input', async () => {
      const result = await processor.processEventChoice('user123', activeEvent, 'abc');
      
      expect(result.error).toBe(true);
      expect(result.message).toContain('Please enter a number');
    });
    
    it('should filter choices and end event if no valid choices remain', async () => {
      // Override the filterChoicesByRestrictions implementation for this test
      processor.filterChoicesByRestrictions.mockReturnValueOnce([]);
      
      const result = await processor.processEventChoice('user123', activeEvent, '1');
      
      expect(mockEventStateManager.clearActiveEvent).toHaveBeenCalledWith('user123');
      expect(result).toBeNull();
    });
    
    it('should validate input against valid choices and return error if invalid', async () => {
      const result = await processor.processEventChoice('user123', activeEvent, '3');
      
      expect(result.error).toBe(true);
      expect(result.message).toContain('Invalid choice');
    });
    
    it('should execute the selected choice', async () => {
      const mockExecuteResult = {
        message: 'Result 1',
        hasChoices: false,
        isEnd: true
      };
      
      processor.executeChoice.mockResolvedValueOnce(mockExecuteResult);
      
      const result = await processor.processEventChoice('user123', activeEvent, '1');
      
      expect(processor.executeChoice).toHaveBeenCalled();
      expect(result).toBe(mockExecuteResult);
    });
    
    it('should handle errors gracefully', async () => {
      // Force an error in filterChoicesByRestrictions to trigger catch block
      processor.filterChoicesByRestrictions.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      const result = await processor.processEventChoice('user123', activeEvent, '1');
      
      expect(mockLogger.error).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
}); 