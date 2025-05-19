/**
 * EventChoiceProcessor
 * 
 * Handles filtering, validation, and execution of event choices.
 * Extracted from eventService.js to improve testability and separation of concerns.
 */

const logger = require('../config/logger');
const eventNodeService = require('./eventNodeService');

class EventChoiceProcessor {
  constructor(dependencies = {}) {
    // Allow dependency injection for testability
    this.logger = dependencies.logger || logger;
    this.User = dependencies.User || require('../models/User');
    this.eventNodeService = dependencies.eventNodeService || eventNodeService;
    this.messageService = dependencies.messageService || require('./messageService');
    this.publishCombatSystemMessage = dependencies.publishCombatSystemMessage || require('./systemMessageService').publishCombatSystemMessage;
    
    // Lazy-loaded services to avoid circular dependencies
    this._mobService = null;
    this._combatService = null;
    this._questService = null;
    this._stateService = null;
    this._eventStateManager = null;
  }
  
  // Lazy loaders for services to avoid circular dependencies
  get mobService() {
    if (!this._mobService) {
      this._mobService = require('./mobService');
    }
    return this._mobService;
  }
  
  get combatService() {
    if (!this._combatService) {
      this._combatService = require('./combatService');
    }
    return this._combatService;
  }
  
  get questService() {
    if (!this._questService) {
      this._questService = require('./questService');
    }
    return this._questService;
  }
  
  get stateService() {
    if (!this._stateService) {
      this._stateService = require('./stateService');
    }
    return this._stateService;
  }
  
  get eventStateManager() {
    if (!this._eventStateManager) {
      this._eventStateManager = require('./eventStateManager');
    }
    return this._eventStateManager;
  }
  
  /**
   * Filter choices based on user eligibility (class, quests, etc.)
   * 
   * @param {Array} choices - Array of choices to filter
   * @param {Object} user - User object
   * @returns {Array} - Filtered array of choices with original indices
   */
  filterChoicesByRestrictions(choices, user) {
    this.logger.debug('Filtering choices by restrictions', {
      userId: user._id.toString(),
      totalChoices: choices.length,
      userQuests: user.quests?.map(q => ({
        questId: q.questId,
        currentEventId: q.currentEventId,
        completed: q.completed,
        completedEventIds: q.completedEventIds
      }))
    });
    
    // Get the user's completed quest event IDs and current event IDs
    const userCompletedQuestEventIds = [];
    const userCurrentQuestEventIds = [];
    
    if (user.quests && Array.isArray(user.quests)) {
      user.quests.forEach(userQuest => {
        // Collect completed event IDs
        if (userQuest.completedEventIds && Array.isArray(userQuest.completedEventIds)) {
          userCompletedQuestEventIds.push(...userQuest.completedEventIds);
        }
        
        // Collect current event ID if it exists
        if (userQuest.currentEventId) {
          userCurrentQuestEventIds.push(userQuest.currentEventId);
        }
      });
    }
    
    this.logger.debug('User quest event IDs:', {
      userId: user._id.toString(),
      completedEventIds: userCompletedQuestEventIds,
      currentEventIds: userCurrentQuestEventIds
    });
    
    return choices
      .map((choice, index) => ({ choice, originalIndex: index }))
      .filter(({ choice }) => {
        // Check blockIfQuestEventIds - if user has completed or is on any of these events, block the choice
        if (choice.nextNode?.blockIfQuestEventIds && choice.nextNode.blockIfQuestEventIds.length > 0) {
          const hasBlockingEvent = choice.nextNode.blockIfQuestEventIds.some(eventId => 
            userCompletedQuestEventIds.includes(eventId) || userCurrentQuestEventIds.includes(eventId)
          );
          
          if (hasBlockingEvent) {
            this.logger.debug('[CHOICE FILTER] Excluded by blockIfQuestEventIds', {
              userId: user._id.toString(),
              choiceText: choice.text,
              blockIfQuestEventIds: choice.nextNode.blockIfQuestEventIds,
              userCompletedEventIds: userCompletedQuestEventIds,
              userCurrentEventIds: userCurrentQuestEventIds
            });
            return false;
          }
        }

        // Check node restrictions
        if (choice.nextNode?.restrictions?.length > 0) {
          for (const restriction of choice.nextNode.restrictions) {
            // 'noClass' restriction - only show if user has no class
            if (restriction === 'noClass' && user.class) {
              this.logger.debug('[CHOICE FILTER] Excluded by noClass restriction', {
                userId: user._id.toString(),
                choiceText: choice.text,
                userClass: user.class
              });
              return false;
            }
            // 'enforcerOnly' restriction - only show if user is enforcer class
            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
              this.logger.debug('[CHOICE FILTER] Excluded by enforcerOnly restriction', {
                userId: user._id.toString(),
                choiceText: choice.text,
                userClass: user.class
              });
              return false;
            }
          }
        }

        this.logger.debug('[CHOICE FILTER] Included', {
          userId: user._id.toString(),
          choiceText: choice.text
        });
        return true;
      });
  }
  
  /**
   * Validate user input against available choices
   * 
   * @param {string} input - User input
   * @param {Array} validChoices - Array of valid choices
   * @param {boolean} isStoryEvent - Whether this is a story event
   * @returns {Object} - Result object with error status and message or selected choice
   */
  validateChoiceInput(input, validChoices, isStoryEvent = false) {
    // If input is not a number in an event with choices
    if (isNaN(parseInt(input)) && validChoices.length > 0) {
      this.logger.debug('Non-numeric input received', {
        input,
        isStoryEvent
      });
      return {
        error: true,
        message: `Please enter a number between 1 and ${validChoices.length} to choose your response.`,
        selectedChoice: null
      };
    }
    
    // Validate choice number
    const selectedIndex = parseInt(input) - 1;
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= validChoices.length) {
      this.logger.debug('Invalid choice provided', {
        input,
        validChoiceRange: `1-${validChoices.length}`,
        isStoryEvent
      });
      return {
        error: true,
        message: `Invalid choice. Please choose 1-${validChoices.length}.`,
        selectedChoice: null
      };
    }
    
    // Return valid choice
    return {
      error: false,
      message: null,
      selectedChoice: validChoices[selectedIndex].choice,
      selectedIndex
    };
  }
  
  /**
   * Process a combat encounter from a choice
   * 
   * @param {Object} choice - The choice with mobId
   * @param {Object} user - User object
   * @param {string} userId - User ID
   * @returns {Object} - Result of combat initiation
   */
  async handleCombatChoice(choice, user, userId) {
    this.logger.debug('Combat mob choice selected', {
      userId,
      mobId: choice.mobId,
      choiceText: choice.text
    });

    // Check if user has enough energy
    if (user.stats.currentEnergy < 1) {
        this.logger.warn('User attempted combat with insufficient energy', { userId, energy: user.stats.currentEnergy });
        this.messageService.sendErrorMessage(userId, "You're too tired to face this challenge right now. Rest and recover first.");
        // Clear any potential active event state
        this.eventStateManager.clearActiveEvent(userId);
        return {
            message: choice.text + "\n\nYou feel too exhausted to proceed.",
            isEnd: true
        };
    }

    // Deduct energy before initiating combat
    user.stats.currentEnergy -= 1;
    try {
        await this.User.findByIdAndUpdate(userId, {
            'stats.currentEnergy': user.stats.currentEnergy
        });
        this.logger.debug('Deducted 1 energy for combat initiation', { userId, newEnergy: user.stats.currentEnergy });
    } catch (dbError) {
        this.logger.error('Failed to update user energy in database', { userId, error: dbError.message, stack: dbError.stack });
        // Don't stop combat, but log the error
    }
    
    // Send status update after energy deduction
    this.messageService.sendPlayerStatusMessage(
        userId,
        `HP: ${user.stats.currentHitpoints}/${user.stats.hitpoints} | Energy: ${user.stats.currentEnergy}/${user.stats.energy}`
    );

    // Clear the active event since we're transitioning to combat
    this.eventStateManager.clearActiveEvent(userId);

    // Create a mock event object with the mobId for the loadMobFromEvent function
    const mockEvent = {
      mobId: choice.mobId
    };

    try {
      // Load the mob from the event
      const mobInstance = await this.mobService.loadMobFromEvent(mockEvent);
      
      if (!mobInstance) {
        this.logger.error('Failed to load mob for combat', {
          userId,
          mobId: choice.mobId
        });
        return {
          message: choice.text + "\n\nYou were going to encounter a creature, but it seems to have fled.",
          isEnd: true
        };
      }

      // Store the mob instance for the user
      this.stateService.setPlayerMob(userId, mobInstance);

      // Set the user's combat state
      this.stateService.setUserCombatState(userId, {
        mobInstanceId: mobInstance.instanceId,
        mobName: mobInstance.name
      });

      // Send combat initiation messages
      this.messageService.sendCombatMessage(
        userId,
        `${choice.text}\n\nA hostile creature attacks you!`,
        'Type ? to see available combat commands.',
        mobInstance.image
      );

      // Announce combat to the room
      this.publishCombatSystemMessage(
        user.currentNode,
        {
          message: `${user.avatarName} engages in combat with ${mobInstance.name}!`
        },
        user
      );

      try {
        // Process combat until user input is required
        await this.combatService.processCombatUntilInput(user, mobInstance);
      } catch (combatError) {
        // Log detailed error information but continue
        this.logger.error('Error in processCombatUntilInput:', {
          error: combatError.message,
          stack: combatError.stack,
          userId: userId,
          mobId: mobInstance.mobId,
          mobName: mobInstance.name
        });
      }

      // Return success even if processCombatUntilInput had an error
      return {
        message: null, // Don't send an additional message, combat message already sent
        isEnd: true,
        combatInitiated: true
      };
    } catch (error) {
      this.logger.error('Error initiating combat from event choice', {
        error: error.message,
        stack: error.stack,
        userId: userId,
        mobId: choice.mobId
      });
      
      // Clean up any partial combat state
      this.stateService.clearPlayerMob(userId);
      this.stateService.clearUserCombatState(userId);
      
      return {
        message: choice.text + "\n\nSomething went wrong with the encounter.",
        isEnd: true
      };
    }
  }
  
  /**
   * Process a skill check choice
   * 
   * @param {Object} choice - The choice with skill check parameters
   * @param {Object} user - User object
   * @param {string} userId - User ID
   * @returns {Object} - Result of skill check with updated choice if necessary
   */
  async handleSkillCheck(choice, user, userId) {
    this.logger.debug('Skill check choice selected', {
      userId,
      stat: choice.skillCheckStat,
      targetNumber: choice.skillCheckTargetNumber,
      choiceText: choice.text
    });
    
    // Get the user's stat value for the skill check
    const userStatValue = user.stats[choice.skillCheckStat];
    
    // Roll a d20
    const diceRoll = Math.floor(Math.random() * 20) + 1;
    
    // Calculate the total check result
    const checkResult = userStatValue + diceRoll;
    
    // Determine if the check passed or failed
    const passed = checkResult >= choice.skillCheckTargetNumber;
    
    // Format the skill check result message
    let resultMessage = `${choice.text}\n\n`;
    resultMessage += `SKILL CHECK: ${choice.skillCheckStat.toUpperCase()} (${userStatValue}) + D20 (${diceRoll}) = ${checkResult} vs ${choice.skillCheckTargetNumber}\n`;
    
    if (passed) {
      resultMessage += `SUCCESS! You passed the ${choice.skillCheckStat} check.\n`;
      
      // If there's no nextNode (success path), end the event
      if (!choice.nextNode) {
        this.logger.debug('Skill check passed but no success path found, ending event', {
          userId,
          stat: choice.skillCheckStat,
          roll: diceRoll,
          total: checkResult,
          target: choice.skillCheckTargetNumber
        });
        
        this.eventStateManager.clearActiveEvent(userId);
        
        return {
          message: resultMessage,
          isEnd: true,
          shouldContinue: false
        };
      }
      
      // Continue with the success path (nextNode)
      this.logger.debug('Skill check passed, continuing with success path', {
        userId,
        stat: choice.skillCheckStat,
        roll: diceRoll,
        total: checkResult,
        target: choice.skillCheckTargetNumber
      });
      
      // Prepend the skill check result to the next node's prompt
      if (choice.nextNode && choice.nextNode.prompt) {
        choice.nextNode.prompt = `${resultMessage}\n\n${choice.nextNode.prompt}`;
      }
    } else {
      resultMessage += `FAILURE! You failed the ${choice.skillCheckStat} check.\n`;
      
      // If there's no failureNode, end the event
      if (!choice.failureNode) {
        this.logger.debug('Skill check failed but no failure path found, ending event', {
          userId,
          stat: choice.skillCheckStat,
          roll: diceRoll,
          total: checkResult,
          target: choice.skillCheckTargetNumber
        });
        
        this.eventStateManager.clearActiveEvent(userId);
        
        return {
          message: resultMessage,
          isEnd: true,
          shouldContinue: false
        };
      }
      
      // Continue with the failure path
      this.logger.debug('Skill check failed, continuing with failure path', {
        userId,
        stat: choice.skillCheckStat,
        roll: diceRoll,
        total: checkResult,
        target: choice.skillCheckTargetNumber
      });
      
      // Prepend the skill check result to the failure node's prompt
      if (choice.failureNode && choice.failureNode.prompt) {
        choice.failureNode.prompt = `${resultMessage}\n\n${choice.failureNode.prompt}`;
      }
      
      // Replace the nextNode with the failureNode
      choice.nextNode = choice.failureNode;
    }
    
    return {
      isEnd: false,
      shouldContinue: true,
      updatedChoice: choice
    };
  }
  
  /**
   * Process quest events from a choice node
   * 
   * @param {Object} choice - The choice with quest events
   * @param {Object} user - User object
   * @param {string} userId - User ID
   * @param {string} actorId - Actor ID
   * @param {boolean} isStoryEvent - Whether this is a story event
   * @returns {Promise<Object>} - Updated user object
   */
  async handleQuestEvents(choice, user, userId, actorId, isStoryEvent) {
    let updatedUser = user;

    try {
      // PATCH: Support questCompletionEvents on the choice itself, not just nextNode
      let questCompletionEvents = [];
      if (Array.isArray(choice.questCompletionEvents) && choice.questCompletionEvents.length > 0) {
        questCompletionEvents = choice.questCompletionEvents;
      } else if (
        choice.nextNode &&
        Array.isArray(choice.nextNode.questCompletionEvents) &&
        choice.nextNode.questCompletionEvents.length > 0
      ) {
        questCompletionEvents = choice.nextNode.questCompletionEvents;
      }

      // DEBUG LOGGING: Print the selected choice text and questCompletionEvents being processed
      this.logger.debug('[DEBUG] handleQuestEvents: Choice selected', {
        userId,
        choiceText: choice.text,
        questCompletionEvents,
        hasChoiceQCE: Array.isArray(choice.questCompletionEvents),
        choiceQCELength: choice.questCompletionEvents ? choice.questCompletionEvents.length : undefined,
        hasNextNodeQCE: choice.nextNode && Array.isArray(choice.nextNode.questCompletionEvents),
        nextNodeQCELength: choice.nextNode && choice.nextNode.questCompletionEvents ? choice.nextNode.questCompletionEvents.length : undefined
      });

      // SAFETY CHECK: Check for Exit choices by text and prevent quest completions
      if (
        choice.text &&
        choice.text.toLowerCase().includes("exit") &&
        questCompletionEvents.length === 0
      ) {
        this.logger.debug('Skipping quest processing for Exit option', {
          userId,
          choiceText: choice.text
        });
        return updatedUser;
      }

      // Process quest completion events if they exist AND they're not empty
      if (questCompletionEvents.length > 0) {
        this.logger.debug(`Processing quest completion events: ${questCompletionEvents.join(', ')}`);
        this.logger.debug('User state before quest completion processing:', {
          userId,
          version: updatedUser.__v,
          questCount: updatedUser.quests?.length || 0,
          activeQuests: updatedUser.quests?.filter(q => !q.completed)?.length || 0,
          completedQuests: updatedUser.quests?.filter(q => q.completed)?.length || 0,
          questIds: updatedUser.quests?.map(q => ({ id: q.questId, completed: q.completed }))
        });
        await this.questService.handleQuestProgression(
          updatedUser,
          actorId,
          questCompletionEvents
        );
        // Refresh user after quest progression
        const UserModel = this.User;
        updatedUser = await UserModel.findById(userId);
        this.logger.debug('User state after quest completion processing:', {
          userId,
          version: updatedUser.__v,
          questCount: updatedUser.quests?.length || 0,
          activeQuests: updatedUser.quests?.filter(q => !q.completed)?.length || 0,
          completedQuests: updatedUser.quests?.filter(q => q.completed)?.length || 0,
          questIds: updatedUser.quests?.map(q => ({ id: q.questId, completed: q.completed }))
        });
      } else {
        // Add explicit log when skipping quest processing
        this.logger.debug('Skipping quest completion processing - no valid quest events', {
          userId,
          hasQuestCompletionEvents: !!questCompletionEvents,
          isArray: Array.isArray(questCompletionEvents),
          length: questCompletionEvents.length
        });
      }

      // Process quest activation if it exists
      if (choice.nextNode && choice.nextNode.activateQuestId) {
        this.logger.debug(`Processing quest activation: ${choice.nextNode.activateQuestId}`);
        this.logger.debug('User state before quest activation:', {
          userId,
          version: updatedUser.__v,
          questCount: updatedUser.quests?.length || 0,
          activatingQuestId: choice.nextNode.activateQuestId?.toString?.() || choice.nextNode.activateQuestId
        });
        await this.questService.handleQuestProgression(
          updatedUser,
          actorId,
          [],
          choice.nextNode.activateQuestId
        );
        // Refresh user after quest activation
        const UserModel = this.User;
        updatedUser = await UserModel.findById(userId);
        this.logger.debug('User state after quest activation:', {
          userId,
          version: updatedUser.__v,
          questCount: updatedUser.quests?.length || 0,
          activeQuests: updatedUser.quests?.filter(q => !q.completed)?.length || 0
        });
      }

      return updatedUser;
    } catch (error) {
      this.logger.error(`Error in handleQuestEvents: ${error.message}`, {
        stack: error.stack,
        userId,
        choiceText: choice.text?.substring(0, 30)
      });
      return user;
    }
  }
  
  /**
   * Execute a selected choice and handle all side effects
   * 
   * @param {Object} choice - The selected choice
   * @param {Object} user - User object
   * @param {string} userId - User ID
   * @param {Object} activeEvent - The active event
   * @returns {Object} - Result of choice execution
   */
  async executeChoice(choice, user, userId, activeEvent) {
    try {
      // DEBUG LOGGING: Print the selected choice and its nextNode questCompletionEvents before cloning
      this.logger.debug('[DEBUG] executeChoice: Before clone', {
        choiceText: choice.text,
        hasChoiceQCE: Array.isArray(choice.questCompletionEvents),
        choiceQCELength: choice.questCompletionEvents ? choice.questCompletionEvents.length : undefined,
        choiceQCE: choice.questCompletionEvents,
        hasNextNodeQCE: choice.nextNode && Array.isArray(choice.nextNode.questCompletionEvents),
        nextNodeQCELength: choice.nextNode && choice.nextNode.questCompletionEvents ? choice.nextNode.questCompletionEvents.length : undefined,
        nextNodeQCE: choice.nextNode && choice.nextNode.questCompletionEvents
      });
      // Use eventNodeService to clone the selected choice
      let clonedChoice = this.eventNodeService.cloneNode(choice);
      // DEBUG LOGGING: Print the cloned choice and its nextNode questCompletionEvents after cloning
      this.logger.debug('[DEBUG] executeChoice: After clone', {
        choiceText: clonedChoice.text,
        hasChoiceQCE: Array.isArray(clonedChoice.questCompletionEvents),
        choiceQCELength: clonedChoice.questCompletionEvents ? clonedChoice.questCompletionEvents.length : undefined,
        choiceQCE: clonedChoice.questCompletionEvents,
        hasNextNodeQCE: clonedChoice.nextNode && Array.isArray(clonedChoice.nextNode.questCompletionEvents),
        nextNodeQCELength: clonedChoice.nextNode && clonedChoice.nextNode.questCompletionEvents ? clonedChoice.nextNode.questCompletionEvents.length : undefined,
        nextNodeQCE: clonedChoice.nextNode && clonedChoice.nextNode.questCompletionEvents
      });
      
      // Add logging
      this.logger.debug('Selected choice details:', {
        userId,
        text: clonedChoice.text,
        hasNextNode: !!clonedChoice.nextNode,
        nextNodeId: clonedChoice.nextNode?._id?.toString(),
        nextNodeHasChoices: clonedChoice.nextNode?.choices?.length > 0,
        questCompletionEvents: clonedChoice.nextNode?.questCompletionEvents || [],
        hasActivateQuest: !!clonedChoice.nextNode?.activateQuestId,
        hasMobId: !!clonedChoice.mobId
      });

      // Safety check: If this is an Exit option, ensure it doesn't have quest completion events
      if (clonedChoice.text && clonedChoice.text.toLowerCase().includes("exit") && 
          clonedChoice.nextNode && clonedChoice.nextNode.questCompletionEvents && 
          clonedChoice.nextNode.questCompletionEvents.length > 0) {
        
        this.logger.warn('Exit option incorrectly has quest completion events - clearing', {
          userId,
          choiceText: clonedChoice.text,
          questCompletionEvents: clonedChoice.nextNode.questCompletionEvents
        });
        
        // Clear the quest completion events for this Exit option
        clonedChoice.nextNode.questCompletionEvents = [];
      }

      // Check if this choice has a mobId for combat
      if (clonedChoice.mobId) {
        return await this.handleCombatChoice(clonedChoice, user, userId);
      }
      
      // Check if this choice has a teleportToNode for location teleportation
      let teleportAction = null;
      if (clonedChoice.teleportToNode) {
        this.logger.debug('Teleport choice selected', {
          userId,
          teleportToNode: clonedChoice.teleportToNode,
          choiceText: clonedChoice.text
        });
        
        // Store the teleport information to return to the caller
        teleportAction = {
          targetNode: clonedChoice.teleportToNode
        };
      }

      // Check if this choice has a skill check
      if (clonedChoice.skillCheckStat && clonedChoice.skillCheckTargetNumber) {
        const skillCheckResult = await this.handleSkillCheck(clonedChoice, user, userId);
        
        if (!skillCheckResult.shouldContinue) {
          return skillCheckResult;
        }
        
        // Update the choice with any modifications from the skill check
        clonedChoice = skillCheckResult.updatedChoice;
      }

      // Validate the next node structure
      if (clonedChoice.nextNode) {
        // Ensure node has a choices array
        if (!clonedChoice.nextNode.choices) {
          clonedChoice.nextNode.choices = [];
        }
      }

      // Process quest events
      this.logger.debug('Before handling quest events:', {
        userId,
        choiceText: clonedChoice.text?.substring(0, 30) + '...',
        hasNextNode: !!clonedChoice.nextNode,
        questCompletionEvents: clonedChoice.nextNode?.questCompletionEvents || [],
        hasActivateQuest: !!clonedChoice.nextNode?.activateQuestId,
        userVersion: user.__v,
        userQuestCount: user.quests?.length || 0
      });
      
      user = await this.handleQuestEvents(
        clonedChoice, 
        user, 
        userId, 
        activeEvent.actorId, 
        activeEvent.isStoryEvent
      );
      
      this.logger.debug('After handling quest events:', {
        userId,
        userVersion: user.__v,
        userQuestCount: user.quests?.length || 0,
        activeQuests: user.quests?.filter(q => !q.completed)?.length || 0,
        completedQuests: user.quests?.filter(q => q.completed)?.length || 0
      });

      // Check if we've reached the end of a branch
      if (!clonedChoice.nextNode) {
        this.logger.debug('End of event branch reached', {
          userId,
          isStoryEvent: activeEvent.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        return {
          message: clonedChoice.text,
          isEnd: true
        };
      }

      // Update event state
      this.logger.debug('Updating event state with next node', {
        userId,
        isStoryEvent: activeEvent.isStoryEvent,
        nextNodeId: clonedChoice.nextNode._id?.toString(),
        nextNodePrompt: clonedChoice.nextNode.prompt?.substring(0, 30) + '...',
        nextNodeChoices: clonedChoice.nextNode.choices?.length || 0
      });

      // Ensure consistent questCompletionEvents before storing
      // REMOVED: clonedChoice.nextNode = this.eventNodeService.ensureConsistentQuestEvents(clonedChoice.nextNode);
      
      // Update the active event state
      this.eventStateManager.setActiveEvent(
        userId, 
        activeEvent.eventId, 
        clonedChoice.nextNode,
        activeEvent.actorId,
        activeEvent.isStoryEvent
      );

      // Format and return response to display to the user
      const formatEventResponse = async (node, userId) => {
        let response = node.prompt + '\n\n';
        
        if (node.choices && node.choices.length > 0) {
          // Get user data to check quests and class
          const user = await this.User.findById(userId);
          
          // Filter choices based on restrictions and quests
          const validChoices = this.filterChoicesByRestrictions(node.choices, user);

          if (validChoices.length > 0) {
            response += 'Responses:\n';
            validChoices.forEach(({ choice }, index) => {
              response += `${index + 1}. ${choice.text}\n`;
            });
          }

          return {
            message: response.trim(),
            hasChoices: validChoices.length > 0,
            isEnd: validChoices.length === 0
          };
        }

        return {
          message: response.trim(),
          hasChoices: false,
          isEnd: true
        };
      };
      
      // Format the response for the client
      const response = await formatEventResponse(clonedChoice.nextNode, userId);
      
      this.logger.debug('Formatted response:', {
        userId,
        message: response.message,
        hasChoices: response.hasChoices,
        isEnd: response.isEnd,
        isStoryEvent: activeEvent.isStoryEvent
      });

      // Clear event state if there are no more choices
      if (!response.hasChoices) {
        this.logger.debug('No more choices available, ending event', {
          userId,
          isStoryEvent: activeEvent.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
      }

      return {
        message: response.message,
        hasChoices: response.hasChoices,
        isEnd: response.isEnd,
        error: false,
        teleportAction: teleportAction
      };
    } catch (error) {
      this.logger.error('Error executing choice:', error);
      return null;
    }
  }
  
  /**
   * Process a user input for an active event
   * 
   * @param {string} userId - User ID
   * @param {Object} activeEvent - The active event
   * @param {string} input - User input
   * @returns {Object} - Result of processing the input
   */
  async processEventChoice(userId, activeEvent, input) {
    try {
      this.logger.debug('processEventChoice called:', {
        userId,
        input,
        activeEvent: {
          eventId: activeEvent.eventId,
          hasCurrentNode: !!activeEvent.currentNode,
          actorId: activeEvent.actorId,
          isStoryEvent: activeEvent.isStoryEvent
        }
      });

      const currentNode = activeEvent.currentNode;

      // Ensure the node has consistent quest completion events
      // REMOVED: this.eventNodeService.ensureConsistentQuestEvents(currentNode);

      // If no choices available, end event and allow new one to start
      if (!currentNode.choices || currentNode.choices.length === 0) {
        this.logger.debug('No choices available, ending event', {
          userId,
          isStoryEvent: activeEvent.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        return null;
      }

      // If we get a non-numeric input in an event with choices, 
      // return an error message instead of clearing the event
      if (isNaN(parseInt(input)) && currentNode.choices.length > 0) {
        this.logger.debug('Non-numeric input received, prompting for valid choice', {
          userId,
          input,
          isStoryEvent: activeEvent.isStoryEvent
        });
        return {
          error: true,
          message: `Please enter a number between 1 and ${currentNode.choices.length} to choose your response.`
        };
      }

      // Get user data to check quests
      let user = await this.User.findById(userId);
      
      // Filter choices first
      const validChoices = this.filterChoicesByRestrictions(currentNode.choices, user);

      this.logger.debug('Filtered choices:', {
        userId,
        totalChoices: currentNode.choices.length,
        validChoices: validChoices.length,
        isStoryEvent: activeEvent.isStoryEvent
      });

      // End event if no valid choices remain
      if (validChoices.length === 0) {
        this.logger.debug('No valid choices available after filtering, ending event', {
          userId,
          isStoryEvent: activeEvent.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        return null;
      }

      // Validate the user's input
      const validationResult = this.validateChoiceInput(
        input, 
        validChoices, 
        activeEvent.isStoryEvent
      );
      
      if (validationResult.error) {
        return {
          error: true,
          message: validationResult.message
        };
      }

      // Execute the selected choice
      return await this.executeChoice(
        validationResult.selectedChoice, 
        user, 
        userId, 
        activeEvent
      );
    } catch (error) {
      this.logger.error('Error processing event choice:', error);
      return null;
    }
  }
}

// Create and export singleton instance
const eventChoiceProcessor = new EventChoiceProcessor();
module.exports = eventChoiceProcessor;

// Also export class for testing
module.exports.EventChoiceProcessor = EventChoiceProcessor; 