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
    this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Starting filter', {
      userId: user._id.toString(),
      initialChoicesCount: choices.length,
      userClass: user.class?.name,
      userQuestIds: user.quests?.map(q => q.questId.toString())
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
        const choiceText = choice.text?.substring(0, 30) + (choice.text?.length > 30 ? '...' : '');
        // Check quest activation restriction
        if (choice.nextNode?.activateQuestId) {
          const questToActivate = choice.nextNode.activateQuestId.toString();
          const hasQuest = user.quests?.some(userQuest => 
            userQuest.questId.toString() === questToActivate
          );
          if (hasQuest) {
            this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Filtering out choice due to already having quest to activate', { userId: user._id.toString(), choiceText, activateQuestId: questToActivate });
            return false;
          }
        }
        
        // Check blockIfQuestEventIds - if user has completed or is on any of these events, block the choice
        if (choice.nextNode?.blockIfQuestEventIds && choice.nextNode.blockIfQuestEventIds.length > 0) {
          const blockingEvents = choice.nextNode.blockIfQuestEventIds.map(id => id.toString());
          const hasBlockingEvent = blockingEvents.some(eventId => 
            userCompletedQuestEventIds.map(id => id.toString()).includes(eventId) || 
            userCurrentQuestEventIds.map(id => id.toString()).includes(eventId)
          );
          
          if (hasBlockingEvent) {
            this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Filtering out choice due to blockIfQuestEventIds', { 
              userId: user._id.toString(), 
              choiceText, 
              blockIfQuestEventIds: blockingEvents,
              userCompletedEventsThatBlock: userCompletedQuestEventIds.map(id => id.toString()).filter(id => blockingEvents.includes(id)),
              userCurrentEventsThatBlock: userCurrentQuestEventIds.map(id => id.toString()).filter(id => blockingEvents.includes(id))
            });
            return false;
          }
        }

        // Check node restrictions
        if (choice.nextNode?.restrictions?.length > 0) {
          for (const restriction of choice.nextNode.restrictions) {
            if (restriction === 'noClass' && user.class) {
              this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Filtering out choice due to noClass restriction (user has class)', { userId: user._id.toString(), choiceText, userClass: user.class.name });
              return false;
            }
            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
              this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Filtering out choice due to enforcerOnly restriction', { userId: user._id.toString(), choiceText, userClass: user.class?.name });
              return false;
            }
            // Add logging for any other unhandled known restrictions if necessary
          }
        }
        this.logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] filterChoicesByRestrictions: Keeping choice', { userId: user._id.toString(), choiceText });
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
   * @param {Object} selectedChoice - The selected choice
   * @param {Object} user - User object
   * @param {string} userId - User ID
   * @param {Object} activeEventState - The active event state (contains IDs)
   * @returns {Object} - Result of choice execution
   */
  async executeChoice(selectedChoice, user, userId, activeEventState) {
    try {
      // selectedChoice is from a fresh DB load, so it doesn't need cloning initially.
      // If selectedChoice or its sub-objects are modified (e.g. skill check prompt changes),
      // and those modifications shouldn't affect the DB representation for future loads,
      // then specific deep copies might be needed before modification.
      this.logger.debug('[DEBUG] executeChoice: Starting with choice from DB', {
        choiceText: selectedChoice.text,
        hasChoiceQCE: Array.isArray(selectedChoice.questCompletionEvents),
        choiceQCELength: selectedChoice.questCompletionEvents ? selectedChoice.questCompletionEvents.length : undefined,
        hasNextNodeQCE: selectedChoice.nextNode && Array.isArray(selectedChoice.nextNode.questCompletionEvents),
        nextNodeQCELength: selectedChoice.nextNode && selectedChoice.nextNode.questCompletionEvents ? selectedChoice.nextNode.questCompletionEvents.length : undefined,
      });

      this.logger.debug('Selected choice details:', {
        userId,
        text: selectedChoice.text,
        hasNextNode: !!selectedChoice.nextNode,
        nextNodeId: selectedChoice.nextNode?._id?.toString(),
        nextNodeHasChoices: selectedChoice.nextNode?.choices?.length > 0,
        questCompletionEventsOnChoice: selectedChoice.questCompletionEvents || [],
        questCompletionEventsOnNextNode: selectedChoice.nextNode?.questCompletionEvents || [],
        hasActivateQuest: !!selectedChoice.nextNode?.activateQuestId,
        hasMobId: !!selectedChoice.mobId
      });

      // Safety check for Exit options (remains important)
      if (selectedChoice.text && selectedChoice.text.toLowerCase().includes("exit") && 
          selectedChoice.nextNode && selectedChoice.nextNode.questCompletionEvents && 
          selectedChoice.nextNode.questCompletionEvents.length > 0) {
        this.logger.warn('Exit option incorrectly has quest completion events - clearing on loaded node', {
          userId,
          choiceText: selectedChoice.text,
          questCompletionEvents: selectedChoice.nextNode.questCompletionEvents
        });
        selectedChoice.nextNode.questCompletionEvents = []; // Modify the loaded version
      }

      if (selectedChoice.mobId) {
        return await this.handleCombatChoice(selectedChoice, user, userId);
      }
      
      let teleportAction = null;
      if (selectedChoice.teleportToNode) {
        this.logger.debug('Teleport choice selected', {
          userId,
          teleportToNode: selectedChoice.teleportToNode,
          choiceText: selectedChoice.text
        });
        teleportAction = {
          targetNode: selectedChoice.teleportToNode
        };
      }

      let choiceToProcess = selectedChoice; // Use this for potential modifications by skill checks
      if (choiceToProcess.skillCheckStat && choiceToProcess.skillCheckTargetNumber) {
        // Skill check might modify choiceToProcess.nextNode or its prompt.
        // A deep copy of choiceToProcess might be warranted here if these changes are complex
        // and shouldn't leak, but for now, we assume direct modification is okay for this flow.
        const skillCheckResult = await this.handleSkillCheck(choiceToProcess, user, userId);
        if (!skillCheckResult.shouldContinue) {
          return skillCheckResult;
        }
        choiceToProcess = skillCheckResult.updatedChoice;
      }

      if (choiceToProcess.nextNode && !choiceToProcess.nextNode.choices) {
        choiceToProcess.nextNode.choices = [];
      }

      this.logger.debug('Before handling quest events:', {
        userId,
        choiceText: choiceToProcess.text?.substring(0, 30) + '...',
        hasNextNode: !!choiceToProcess.nextNode,
        qceOnChoice: choiceToProcess.questCompletionEvents,
        qceOnNextNode: choiceToProcess.nextNode?.questCompletionEvents,
        hasActivateQuest: !!choiceToProcess.nextNode?.activateQuestId,
        userVersion: user.__v
      });
      
      user = await this.handleQuestEvents(
        choiceToProcess, 
        user, 
        userId, 
        activeEventState.actorId, 
        activeEventState.isStoryEvent
      );
      
      this.logger.debug('After handling quest events:', {
        userId,
        userVersion: user.__v,
        activeQuests: user.quests?.filter(q => !q.completed)?.length || 0,
        completedQuests: user.quests?.filter(q => q.completed)?.length || 0
      });

      if (!choiceToProcess.nextNode) {
        this.logger.debug('End of event branch reached', {
          userId,
          isStoryEvent: activeEventState.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        return {
          message: choiceToProcess.text,
          isEnd: true
        };
      }

      const nextNodeToDisplay = choiceToProcess.nextNode; // This is the node object for the next step
      const nextNodeIdToStore = nextNodeToDisplay._id.toString();

      this.logger.debug('Updating event state with next node ID', {
        userId,
        isStoryEvent: activeEventState.isStoryEvent,
        nextNodeId: nextNodeIdToStore,
        nextNodePrompt: nextNodeToDisplay.prompt?.substring(0, 30) + '...',
        nextNodeChoices: nextNodeToDisplay.choices?.length || 0
      });
      
      this.eventStateManager.setActiveEvent(
        userId, 
        activeEventState.eventId, 
        nextNodeIdToStore, // Store the ID of the next node
        activeEventState.actorId,
        activeEventState.isStoryEvent
      );

      // Format response using the nextNodeToDisplay object
      const response = await this.formatEventResponse(nextNodeToDisplay, userId);
      
      this.logger.debug('Formatted response:', {
        userId,
        message: response.message,
        hasChoices: response.hasChoices,
        isEnd: response.isEnd,
        isStoryEvent: activeEventState.isStoryEvent
      });

      if (!response.hasChoices) {
        this.logger.debug('No more choices available, ending event', {
          userId,
          isStoryEvent: activeEventState.isStoryEvent
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
   * Formats the event node prompt and choices into a user-readable message.
   * Moved from EventService.
   * @param {Object} node - The event node to format (must be fully populated with choices)
   * @param {string} userId - The ID of the user for whom to format the response
   * @returns {Promise<Object>} - Object containing message and isEnd status
   */
  async formatEventResponse(node, userId) {
    logger.debug('[EVENT_CHOICE_PROCESSOR_TRACE] formatEventResponse called with node:', {
      userId,
      nodeId: node?._id?.toString(),
      nodePrompt: node?.prompt,
      hasChoices: Array.isArray(node?.choices),
      choicesCount: node?.choices?.length,
      // Log choice text and any restrictions if present
      choicesDetails: node?.choices?.map(c => ({
        text: c.text,
        nextNodeId: c.nextNode?._id?.toString(),
        requiredQuestId: c.requiredQuestId,
        requiredQuestEventId: c.requiredQuestEventId,
        requiredClass: c.requiredClass,
        isExit: c.isExit
      }))
    });

    if (!node || !node.prompt) {
        this.logger.warn('formatEventResponse called with null or undefined node', { userId });
        return {
            message: 'An unexpected error occurred, or the event path is undefined.',
            hasChoices: false,
            isEnd: true
        };
    }

    let responseText = node.prompt ? node.prompt + '\n\n' : 'What do you do?\n\n';
    let hasChoices = false;

    if (node.choices && node.choices.length > 0) {
        // Get fresh user data to check quests and class for choice filtering
        const user = await this.User.findById(userId);
        if (!user) {
            this.logger.error('formatEventResponse: User not found for filtering choices', { userId });
            // Proceed without filtering, or return error - for now, proceed but log
            // This case should ideally not happen if userId is valid
        }
        
        // Use this.filterChoicesByRestrictions (now part of EventChoiceProcessor)
        const validChoices = user ? this.filterChoicesByRestrictions(node.choices, user) : node.choices.map((choice, index) => ({ choice, originalIndex: index }));

        if (validChoices.length > 0) {
            responseText += 'Responses:\n';
            validChoices.forEach(({ choice }, index) => {
                responseText += `${index + 1}. ${choice.text}\n`;
            });
            hasChoices = true;
        }
    }

    return {
        message: responseText.trim(),
        hasChoices: hasChoices,
        isEnd: !hasChoices // Event ends if there are no (valid) choices
    };
  }

  /**
   * Process a user input for an active event. 
   * activeEventState contains { eventId, currentNodeId, actorId, nodeHistory, isStoryEvent }
   * 
   * @param {string} userId - User ID
   * @param {Object} activeEventState - The active event state (contains IDs)
   * @param {string} input - User input
   * @returns {Object} - Result of processing the input
   */
  async processEventChoice(userId, activeEventState, input) {
    try {
      this.logger.debug('processEventChoice called with activeEventState (IDs):', {
        userId,
        input,
        activeEventState
      });

      if (!activeEventState || !activeEventState.eventId || !activeEventState.currentNodeId) {
        this.logger.error('Invalid activeEventState provided to processEventChoice', { userId, activeEventState });
        this.eventStateManager.clearActiveEvent(userId); // Clear potentially corrupt state
        return null;
      }

      // Load the fresh current node from the database using IDs from activeEventState
      const freshCurrentNode = await this.eventNodeService.loadNodeFromDatabase(
        activeEventState.eventId,
        activeEventState.currentNodeId
      );

      if (!freshCurrentNode) {
        this.logger.error('Failed to load freshCurrentNode from database in processEventChoice', {
          eventId: activeEventState.eventId,
          currentNodeId: activeEventState.currentNodeId,
          userId
        });
        this.eventStateManager.clearActiveEvent(userId);
        return null;
      }
      
      // Note: ensureConsistentQuestEvents is no longer called here as freshCurrentNode is from DB.

      if (!freshCurrentNode.choices || freshCurrentNode.choices.length === 0) {
        this.logger.debug('No choices available on freshCurrentNode, ending event', {
          userId,
          isStoryEvent: activeEventState.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        // If the node itself has a prompt, display it before ending.
        // Otherwise, it might have been an action node without further interaction.
        return {
            message: freshCurrentNode.prompt || 'The event concludes.',
            isEnd: true,
            hasChoices: false
        };
      }

      if (isNaN(parseInt(input)) && freshCurrentNode.choices.length > 0) {
        this.logger.debug('Non-numeric input received, prompting for valid choice', {
          userId,
          input,
          isStoryEvent: activeEventState.isStoryEvent
        });
        return {
          error: true,
          message: `Please enter a number between 1 and ${freshCurrentNode.choices.length} to choose your response.`
        };
      }

      let user = await this.User.findById(userId);
      const validChoices = this.filterChoicesByRestrictions(freshCurrentNode.choices, user);

      this.logger.debug('Filtered choices from freshCurrentNode:', {
        userId,
        totalChoices: freshCurrentNode.choices.length,
        validChoices: validChoices.length,
        isStoryEvent: activeEventState.isStoryEvent
      });

      if (validChoices.length === 0) {
        this.logger.debug('No valid choices available after filtering freshCurrentNode, ending event', {
          userId,
          isStoryEvent: activeEventState.isStoryEvent
        });
        this.eventStateManager.clearActiveEvent(userId);
        return {
            message: freshCurrentNode.prompt || 'No further actions available.',
            isEnd: true,
            hasChoices: false
        };
      }

      const validationResult = this.validateChoiceInput(
        input, 
        validChoices, 
        activeEventState.isStoryEvent
      );
      
      if (validationResult.error) {
        return {
          error: true,
          message: validationResult.message
        };
      }

      // Pass activeEventState (with IDs) to executeChoice
      return await this.executeChoice(
        validationResult.selectedChoice, 
        user, 
        userId, 
        activeEventState 
      );
    } catch (error) {
      this.logger.error('Error processing event choice:', error);
      this.eventStateManager.clearActiveEvent(userId); // Attempt to clear state on error
      return null;
    }
  }
}

// Create and export singleton instance
const eventChoiceProcessor = new EventChoiceProcessor();
module.exports = eventChoiceProcessor;

// Also export class for testing
module.exports.EventChoiceProcessor = EventChoiceProcessor; 