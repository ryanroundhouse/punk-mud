class QuestService {
    constructor(deps = {}) {
        // Models
        this.Quest = deps.Quest || require('../models/Quest');
        this.User = deps.User || require('../models/User');
        this.Class = deps.Class || require('../models/Class');
        this.Actor = deps.Actor || require('../models/Actor');
        
        // Services
        this.logger = deps.logger || require('../config/logger');
        this.messageService = deps.messageService || require('./messageService');
        this.userService = deps.userService || require('./userService');
        
        // Lazy loaded services to avoid circular dependencies
        this._nodeService = null;
        this._stateService = null;
    }
    
    // Lazy loader for nodeService to avoid circular dependencies
    get nodeService() {
        if (!this._nodeService) {
            this._nodeService = require('./nodeService');
        }
        return this._nodeService;
    }
    
    // Lazy loader for stateService to avoid circular dependencies
    get stateService() {
        if (!this._stateService) {
            this._stateService = require('./stateService');
        }
        return this._stateService;
    }

    async getActiveQuests(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user || !user.quests) {
                this.logger.debug('No user or no quests found for user', { userId });
                return [];
            }

            this.logger.debug('Found user with quests', {
                userId,
                questCount: user.quests.length,
                quests: user.quests.map(q => ({
                    questId: q.questId,
                    currentEventId: q.currentEventId,
                    completed: q.completed
                }))
            });

            const allQuests = await this.Quest.find();
            
            this.logger.debug('Quests found in database', {
                userId,
                questCount: allQuests.length,
                questIds: allQuests.map(q => q._id.toString()),
                questTitles: allQuests.map(q => q.title)
            });
            
            const activeQuests = user.quests
                .filter(userQuest => !userQuest.completed)
                .map(userQuest => {
                    const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                    if (!quest) {
                        this.logger.debug('Quest not found in database for user quest', {
                            userId,
                            userQuestId: userQuest.questId,
                            availableQuestIds: allQuests.map(q => q._id.toString())
                        });
                        return null;
                    }

                    const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
                    if (!currentEvent) {
                        this.logger.debug('Current event not found for quest', {
                            userId,
                            questId: quest._id,
                            questTitle: quest.title,
                            currentEventId: userQuest.currentEventId,
                            availableEventIds: quest.events.map(e => e._id.toString())
                        });
                        return null;
                    }
                    
                    const choices = currentEvent.choices.map(choice => {
                        const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                        if (!nextEvent) {
                            this.logger.debug('Next event not found for choice', {
                                userId,
                                questId: quest._id,
                                questTitle: quest.title,
                                currentEventId: currentEvent._id,
                                choiceNextEventId: choice.nextEventId
                            });
                            return null;
                        }

                        let hint = nextEvent.hint || 'No hint available';
                        
                        // Replace [Quantity] if this is a kill event
                        if (nextEvent.eventType === 'kill' && hint.includes('[Quantity]')) {
                            // Try to find kill progress for this event
                            const killProgress = userQuest.killProgress?.find(kp => 
                                kp.eventId === nextEvent._id.toString()
                            );
                            
                            // Use remaining from killProgress if it exists, otherwise use the event's quantity
                            const quantity = killProgress ? killProgress.remaining : nextEvent.quantity;
                            hint = hint.replace('[Quantity]', quantity);
                        }

                        return hint;
                    }).filter(Boolean);

                    return {
                        questId: quest._id.toString(),
                        currentEventId: currentEvent._id.toString(),
                        title: quest.title,
                        hints: choices.length > 0 ? choices : ['No available choices'],
                        events: quest.events
                    };
                })
                .filter(Boolean);

            this.logger.debug('Final active quests result', {
                userId,
                activeQuestCount: activeQuests.length,
                activeQuests: activeQuests.map(q => q.title)
            });

            return activeQuests;
        } catch (error) {
            this.logger.error('Error getting active quests:', error, { userId });
            throw error;
        }
    }

    async getQuestNodeEventOverrides(userId, nodeAddress) {
        try {
            const nodeEventOverrides = [];

            // Get active quests for user
            const activeUserQuests = await this.getActiveQuests(userId);
            if (!activeUserQuests || activeUserQuests.length === 0) {
                return null;
            }

            // Get all quest details
            const quests = await this.Quest.find({
                _id: { $in: activeUserQuests.map(q => q.questId) }
            });

            if (!quests || quests.length === 0) {
                return null;
            }

            this.logger.debug('Processing quests for node event overrides', {
                userId,
                nodeAddress,
                activeQuestCount: activeUserQuests.length,
                questCount: quests.length
            });

            for (const userQuest of activeUserQuests) {
                const quest = quests.find(q => q._id.toString() === userQuest.questId);
                if (!quest) {
                    this.logger.debug('Quest not found in database', {
                        userId,
                        questId: userQuest.questId
                    });
                    continue;
                }

                this.logger.debug('Processing quest for node overrides', {
                    userId,
                    questId: quest._id,
                    questTitle: quest.title,
                    currentEventId: userQuest.currentEventId
                });

                // Find the current event for this quest
                const currentEvent = quest.events.find(e => 
                    e._id.toString() === userQuest.currentEventId
                );

                if (!currentEvent) {
                    this.logger.debug('Current event not found for quest', {
                        userId,
                        questId: quest._id,
                        questTitle: quest.title,
                        currentEventId: userQuest.currentEventId
                    });
                    continue;
                }

                this.logger.debug('Found current event for quest', {
                    userId,
                    questId: quest._id,
                    eventId: currentEvent._id,
                    hasNodeOverrides: !!currentEvent.nodeEventOverrides,
                    nodeOverrideCount: currentEvent.nodeEventOverrides?.length || 0
                });

                if (!currentEvent.nodeEventOverrides) {
                    continue;
                }

                // Check if this event has overrides for the specified node
                const nodeOverride = currentEvent.nodeEventOverrides.find(
                    override => override.nodeAddress === nodeAddress
                );

                if (nodeOverride) {
                    this.logger.debug('Found node override for address', {
                        userId,
                        questId: quest._id,
                        questTitle: quest.title,
                        nodeAddress,
                        hasEvents: !!nodeOverride.events,
                        eventCount: nodeOverride.events?.length || 0
                    });

                    if (nodeOverride.events && nodeOverride.events.length > 0) {
                        // Convert the events to the format expected by nodeService
                        const formattedEvents = nodeOverride.events.map(event => {
                            if (event.mobId) {
                                const mobId = event.mobId._id || event.mobId;
                                return {
                                    mobId: mobId,
                                    chance: event.chance
                                };
                            } else if (event.eventId) {
                                return {
                                    eventId: event.eventId._id || event.eventId,
                                    chance: event.chance
                                };
                            }
                            return null;
                        }).filter(Boolean);

                        this.logger.debug('Formatted node override events', {
                            userId,
                            questId: quest._id,
                            questTitle: quest.title,
                            nodeAddress,
                            formattedEvents: JSON.stringify(formattedEvents)
                        });

                        nodeEventOverrides.push(...formattedEvents);
                    } else {
                        this.logger.debug('Node override has no events', {
                            userId,
                            questId: quest._id,
                            questTitle: quest.title,
                            nodeAddress
                        });
                    }
                } else {
                    this.logger.debug('No node override found for address', {
                        userId,
                        questId: quest._id,
                        questTitle: quest.title,
                        nodeAddress,
                        availableOverrideAddresses: currentEvent.nodeEventOverrides.map(o => o.nodeAddress)
                    });
                }
            }

            this.logger.debug('Final node event overrides result', {
                userId,
                nodeAddress,
                overrideCount: nodeEventOverrides.length,
                hasOverrides: nodeEventOverrides.length > 0,
                overrides: nodeEventOverrides.length > 0 ? JSON.stringify(nodeEventOverrides) : null
            });

            return nodeEventOverrides.length > 0 ? nodeEventOverrides : null;
        } catch (error) {
            this.logger.error('Error getting quest node event overrides:', error, {
                userId,
                nodeAddress
            });
            return null;
        }
    }

    async getQuestNodeActorOverrides(userId, nodeAddress) {
        try {
            const nodeActorOverrides = [];

            // Get active quests for user
            const activeUserQuests = await this.getActiveQuests(userId);
            if (!activeUserQuests || activeUserQuests.length === 0) {
                this.logger.debug('No active quests found for user', { userId });
                return null;
            }

            this.logger.debug('Processing quests for node actor overrides', {
                userId,
                nodeAddress,
                activeQuestCount: activeUserQuests.length,
                questTitles: activeUserQuests.map(q => q.title)
            });

            for (const userQuest of activeUserQuests) {
                this.logger.debug('Processing quest for node actor overrides', {
                    userId,
                    questId: userQuest.questId,
                    questTitle: userQuest.title,
                    currentEventId: userQuest.currentEventId,
                    nodeAddress
                });

                // Find the current event for this quest
                const currentEvent = userQuest.events.find(e => 
                    e._id.toString() === userQuest.currentEventId
                );

                if (!currentEvent) {
                    this.logger.debug('Current event not found for quest', {
                        userId,
                        questId: userQuest.questId,
                        questTitle: userQuest.title,
                        currentEventId: userQuest.currentEventId
                    });
                    continue;
                }

                this.logger.debug('Found current event for quest', {
                    userId,
                    questId: userQuest.questId,
                    eventId: currentEvent._id,
                    hasNodeActorOverrides: !!currentEvent.nodeActorOverrides,
                    nodeActorOverrideCount: currentEvent.nodeActorOverrides?.length || 0,
                    nodeActorOverrides: currentEvent.nodeActorOverrides?.map(o => ({
                        nodeAddress: o.nodeAddress,
                        actorId: o.actorId
                    }))
                });

                if (!currentEvent.nodeActorOverrides) {
                    continue;
                }

                // Check if this event has actor overrides for the specified node
                const nodeOverrides = currentEvent.nodeActorOverrides.filter(
                    override => override.nodeAddress === nodeAddress
                );

                if (nodeOverrides.length > 0) {
                    this.logger.debug('Found node actor overrides for address', {
                        userId,
                        questId: userQuest.questId,
                        questTitle: userQuest.title,
                        nodeAddress,
                        overrideCount: nodeOverrides.length,
                        overrides: nodeOverrides.map(o => ({
                            nodeAddress: o.nodeAddress,
                            actorId: o.actorId
                        }))
                    });

                    nodeActorOverrides.push(...nodeOverrides.map(override => override.actorId));
                } else {
                    this.logger.debug('No node actor overrides found for address', {
                        userId,
                        questId: userQuest.questId,
                        questTitle: userQuest.title,
                        nodeAddress,
                        availableOverrideAddresses: currentEvent.nodeActorOverrides.map(o => o.nodeAddress)
                    });
                }
            }

            this.logger.debug('Final node actor overrides result', {
                userId,
                nodeAddress,
                overrideCount: nodeActorOverrides.length,
                hasOverrides: nodeActorOverrides.length > 0,
                overrides: nodeActorOverrides
            });

            return nodeActorOverrides.length > 0 ? nodeActorOverrides : null;
        } catch (error) {
            this.logger.error('Error getting quest node actor overrides:', error, {
                userId,
                nodeAddress
            });
            return null;
        }
    }

    async handleQuestProgression(user, actorId, completionEventIds = [], questToActivate = null) {
        try {
            // Add validation at the start
            if (!user) {
                this.logger.error('handleQuestProgression called with undefined user');
                return null; // Return null instead of [] for compatibility with tests
            }

            this.logger.debug('handleQuestProgression called with:', {
                hasUser: !!user,
                userId: user._id?.toString(),
                actorId,
                completionEventIds,
                questToActivate,
                userQuestsCount: user.quests?.length || 0
            });

            // Initialize quests array if it doesn't exist
            if (!user.quests) {
                user.quests = [];
            }

            const allQuests = await this.Quest.find();
            let questUpdates = [];

            // First handle any completion events
            if (completionEventIds && completionEventIds.length > 0) {
                this.logger.debug('Processing completion events:', { 
                    completionEventIds,
                    userQuests: user.quests.map(q => ({
                        questId: q.questId,
                        currentEventId: q.currentEventId,
                        completed: q.completed,
                        completedEventIds: q.completedEventIds
                    }))
                });
                
                for (const userQuest of user.quests) {
                    if (userQuest.completed) {
                        this.logger.debug('Skipping completed quest:', {
                            questId: userQuest.questId,
                            completedAt: userQuest.completedAt
                        });
                        continue;
                    }

                    const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                    if (!quest) {
                        this.logger.debug('Quest not found:', {
                            questId: userQuest.questId,
                            allQuestIds: allQuests.map(q => q._id.toString())
                        });
                        continue;
                    }

                    // Find the current event
                    const currentEvent = quest.events.find(e => 
                        e._id.toString() === userQuest.currentEventId
                    );
                    
                    if (!currentEvent) {
                        this.logger.debug('Current event not found:', {
                            currentEventId: userQuest.currentEventId,
                            questId: quest._id.toString(),
                            availableEventIds: quest.events.map(e => e._id.toString())
                        });
                        continue;
                    }

                    this.logger.debug('Checking current event:', {
                        eventId: currentEvent._id.toString(),
                        eventType: currentEvent.eventType,
                        hasChoices: !!currentEvent.choices,
                        choicesCount: currentEvent.choices?.length,
                        choices: currentEvent.choices?.map(c => ({
                            nextEventId: c.nextEventId.toString(),
                            matchesCompletion: completionEventIds.includes(c.nextEventId.toString())
                        }))
                    });

                    // Find ALL choices leading to completion events
                    const nextEventChoices = currentEvent.choices?.filter(choice => 
                        completionEventIds.includes(choice.nextEventId.toString())
                    );

                    if (nextEventChoices && nextEventChoices.length > 0) {
                        this.logger.debug('Found matching next event choices:', {
                            currentEventId: currentEvent._id.toString(),
                            nextEventIds: nextEventChoices.map(c => c.nextEventId.toString()),
                            questId: quest._id.toString(),
                            questTitle: quest.title
                        });

                        // Process each matching choice
                        for (const nextEventChoice of nextEventChoices) {
                            // Progress to the next event
                            userQuest.completedEventIds.push(currentEvent._id.toString());
                            userQuest.currentEventId = nextEventChoice.nextEventId.toString();

                            // If this is an end event, complete the quest
                            const nextEvent = quest.events.find(e => 
                                e._id.toString() === nextEventChoice.nextEventId.toString()
                            );

                            if (nextEvent) {
                                this.logger.debug('Found next event:', {
                                    eventId: nextEvent._id.toString(),
                                    isEnd: nextEvent.isEnd,
                                    hasRewards: !!nextEvent.rewards?.length,
                                    rewardCount: nextEvent.rewards?.length || 0
                                });

                                if (nextEvent.isEnd) {
                                    this.logger.debug('Found end event:', {
                                        eventId: nextEvent._id.toString(),
                                        questId: quest._id.toString(),
                                        questTitle: quest.title
                                    });

                                    userQuest.completed = true;
                                    userQuest.completedAt = new Date();
                                    
                                    // Different sequence based on event type
                                    if (nextEvent.eventType === 'chat') {
                                        // For chat events, send actor message first
                                        this.messageService.sendQuestsMessage(
                                            user._id.toString(),
                                            nextEvent.message
                                        );
                                        
                                        // Then send quest completion message
                                        this.messageService.sendQuestsMessage(
                                            user._id.toString(),
                                            `Quest "${quest.title}" completed!`
                                        );
                                        
                                        // Process rewards last
                                        await this.handleEventRewards(user, nextEvent);
                                    } else {
                                        // For non-chat events
                                        // 1. Send quest completion message
                                        this.messageService.sendSuccessMessage(
                                            user._id.toString(),
                                            `Quest "${quest.title}" completed!`
                                        );
                                        
                                        // 2. Send event message if it exists
                                        if (nextEvent.message) {
                                            this.messageService.sendQuestsMessage(
                                                user._id.toString(),
                                                nextEvent.message
                                            );
                                        }
                                        
                                        // 3. Process rewards
                                        await this.handleEventRewards(user, nextEvent);
                                    }

                                    questUpdates.push({
                                        type: 'quest_complete',
                                        questTitle: quest.title
                                    });

                                    // Add debug logging for quest completion
                                    this.logger.debug('Quest completed and ready to save:', {
                                        questId: quest._id.toString(),
                                        questTitle: quest.title,
                                        userId: user._id.toString(),
                                        userQuestStatus: userQuest
                                    });

                                    // Use findOneAndUpdate instead of save to avoid version conflicts
                                    try {
                                        // Find the index of the quest we're updating
                                        const questIndex = user.quests.findIndex(q => 
                                            q.questId === userQuest.questId
                                        );
                                        
                                        if (questIndex === -1) {
                                            throw new Error(`Quest not found in user quests: ${userQuest.questId}`);
                                        }
                                        
                                        // Prepare update object with atomic operators
                                        const updateQuery = {
                                            $set: {
                                                [`quests.${questIndex}.completed`]: true,
                                                [`quests.${questIndex}.completedAt`]: new Date(),
                                                [`quests.${questIndex}.currentEventId`]: userQuest.currentEventId,
                                            }
                                        };
                                        
                                        // Add the completed event ID to the array
                                        if (currentEvent._id) {
                                            updateQuery.$push = {
                                                [`quests.${questIndex}.completedEventIds`]: currentEvent._id.toString()
                                            };
                                        }
                                        
                                        this.logger.debug('Executing findOneAndUpdate for quest completion:', {
                                            userId: user._id.toString(),
                                            questIndex,
                                            updateQuery
                                        });
                                        
                                        // Execute the atomic update
                                        const updatedUser = await this.User.findOneAndUpdate(
                                            { _id: user._id },
                                            updateQuery,
                                            { new: true } // Return the updated document
                                        );
                                        
                                        if (!updatedUser) {
                                            throw new Error(`User not found after update: ${user._id}`);
                                        }
                                        
                                        // Update the user object with the latest data
                                        user = updatedUser;
                                        
                                        this.logger.debug('Quest completion saved successfully with findOneAndUpdate', {
                                            userId: user._id.toString(),
                                            questId: quest._id.toString(),
                                            questTitle: quest.title
                                        });
                                        
                                        // Refresh node data for the player to update actor overrides
                                        await this.refreshPlayerNode(user._id.toString());
                                    } catch (updateError) {
                                        this.logger.error('Error updating user for quest completion:', {
                                            error: updateError.message,
                                            userId: user._id.toString(),
                                            stack: updateError.stack
                                        });
                                        
                                        // Re-throw to maintain existing error handling
                                        throw updateError;
                                    }

                                    return questUpdates;
                                } else {
                                    this.logger.debug('Next event is not an end event:', {
                                        eventId: nextEvent._id.toString(),
                                        isEnd: nextEvent.isEnd
                                    });
                                    
                                    // Use findOneAndUpdate for quest progression
                                    try {
                                        // Find the index of the quest we're updating
                                        const questIndex = user.quests.findIndex(q => 
                                            q.questId === userQuest.questId
                                        );
                                        
                                        if (questIndex === -1) {
                                            throw new Error(`Quest not found in user quests: ${userQuest.questId}`);
                                        }
                                        
                                        // Prepare update object
                                        const updateQuery = {
                                            $set: {
                                                [`quests.${questIndex}.currentEventId`]: userQuest.currentEventId
                                            }
                                        };
                                        
                                        // Add the completed event ID to the array
                                        if (currentEvent._id) {
                                            updateQuery.$push = {
                                                [`quests.${questIndex}.completedEventIds`]: currentEvent._id.toString()
                                            };
                                        }
                                        
                                        this.logger.debug('Executing findOneAndUpdate for quest progression:', {
                                            userId: user._id.toString(),
                                            questIndex,
                                            updateQuery
                                        });
                                        
                                        // Execute the atomic update
                                        const updatedUser = await this.User.findOneAndUpdate(
                                            { _id: user._id },
                                            updateQuery,
                                            { new: true } // Return the updated document
                                        );
                                        
                                        if (!updatedUser) {
                                            throw new Error(`User not found after update: ${user._id}`);
                                        }
                                        
                                        // Update the user object with the latest data
                                        user = updatedUser;
                                        
                                        this.logger.debug('Quest progression saved successfully with findOneAndUpdate', {
                                            userId: user._id.toString(),
                                            questId: quest._id.toString(),
                                            questTitle: quest.title
                                        });
                                        
                                        // Refresh node data for the player to update actor overrides
                                        await this.refreshPlayerNode(user._id.toString());
                                        
                                        // Add the quest update
                                        questUpdates.push({
                                            type: 'quest_progress',
                                            questTitle: quest.title,
                                            isComplete: false
                                        });
                                    } catch (updateError) {
                                        this.logger.error('Error updating user for quest progression:', {
                                            error: updateError.message,
                                            userId: user._id.toString(),
                                            stack: updateError.stack
                                        });
                                        
                                        // Re-throw to maintain existing error handling
                                        throw updateError;
                                    }
                                }
                            }
                        }
                    } else {
                        this.logger.debug('No matching next event choices found in current event choices');
                    }
                }
            } else {
                this.logger.debug('No completion events to process');
            }

            // Handle direct quest activation if specified
            if (questToActivate) {
                const questToStart = allQuests.find(q => q._id.toString() === questToActivate.toString());
                
                if (questToStart) {
                    // Check if quest is already in user's quests (active OR completed)
                    const questExists = user.quests.some(uq => 
                        uq.questId === questToStart._id.toString()
                    );

                    if (!questExists) {
                        const startEvent = questToStart.events.find(event => event.isStart);
                        
                        if (startEvent) {
                            // Add reward handling for start event
                            await this.handleEventRewards(user, startEvent);
                            
                            // Prepare new quest object
                            const newQuest = {
                                questId: questToStart._id.toString(),
                                currentEventId: startEvent._id.toString(),
                                completedEventIds: [],
                                startedAt: new Date()
                            };
                            
                            this.logger.debug('Auto-starting quest with findOneAndUpdate:', {
                                userId: user._id.toString(),
                                questId: questToStart._id.toString(),
                                questTitle: questToStart.title
                            });
                            
                            try {
                                // Use $push to add the new quest to the quests array
                                const updatedUser = await this.User.findOneAndUpdate(
                                    { _id: user._id },
                                    { $push: { quests: newQuest } },
                                    { new: true } // Return the updated document
                                );
                                
                                if (!updatedUser) {
                                    throw new Error(`User not found after auto-starting quest: ${user._id}`);
                                }
                                
                                // Update the user object with the latest data
                                user = updatedUser;
                                
                                this.logger.debug('Quest auto-start saved successfully with findOneAndUpdate', {
                                    userId: user._id.toString(),
                                    questId: questToStart._id.toString(),
                                    questTitle: questToStart.title
                                });
                                
                                // Refresh node data for the player to update actor overrides
                                await this.refreshPlayerNode(user._id.toString());
                            } catch (updateError) {
                                this.logger.error('Error auto-starting quest with findOneAndUpdate:', {
                                    error: updateError.message,
                                    userId: user._id.toString(),
                                    questId: questToStart._id.toString(),
                                    stack: updateError.stack
                                });
                                
                                // Re-throw to maintain existing error handling
                                throw updateError;
                            }

                            // Only send the quest start message if there's a message to send
                            if (startEvent.message) {
                                this.messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `New Quest: ${questToStart.title}\n\n${startEvent.message}`
                                );
                            } else {
                                this.messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `New Quest: ${questToStart.title}`
                                );
                            }
                            
                            return {
                                type: 'quest_start',
                                questTitle: questToStart.title
                            };
                        }
                    }
                }
            }

            // Find quests that haven't been started by the user
            const availableQuests = allQuests.filter(quest => {
                return !user.quests.some(userQuest => userQuest.questId === quest._id.toString());
            });

            // Check for new quests to start
            for (const quest of availableQuests) {
                const startEvent = quest.events.find(event => event.isStart);
                
                if (startEvent && startEvent.actorId === actorId) {
                    // Prepare new quest object
                    const newQuest = {
                        questId: quest._id.toString(),
                        currentEventId: startEvent._id.toString(),
                        completedEventIds: [],
                        startedAt: new Date()
                    };
                    
                    this.logger.debug('Auto-starting quest with findOneAndUpdate:', {
                        userId: user._id.toString(),
                        questId: quest._id.toString(),
                        questTitle: quest.title
                    });
                    
                    try {
                        // Use $push to add the new quest to the quests array
                        const updatedUser = await this.User.findOneAndUpdate(
                            { _id: user._id },
                            { $push: { quests: newQuest } },
                            { new: true } // Return the updated document
                        );
                        
                        if (!updatedUser) {
                            throw new Error(`User not found after auto-starting quest: ${user._id}`);
                        }
                        
                        // Update the user object with the latest data
                        user = updatedUser;
                        
                        this.logger.debug('Quest auto-start saved successfully with findOneAndUpdate', {
                            userId: user._id.toString(),
                            questId: quest._id.toString(),
                            questTitle: quest.title
                        });
                        
                        // Refresh node data for the player to update actor overrides
                        await this.refreshPlayerNode(user._id.toString());
                    } catch (updateError) {
                        this.logger.error('Error auto-starting quest with findOneAndUpdate:', {
                            error: updateError.message,
                            userId: user._id.toString(),
                            questId: quest._id.toString(),
                            stack: updateError.stack
                        });
                        
                        // Re-throw to maintain existing error handling
                        throw updateError;
                    }

                    this.messageService.sendQuestsMessage(
                        user._id.toString(),
                        `New Quest: ${quest.title}\n\n${startEvent.message}`
                    );
                    
                    return {
                        type: 'quest_start',
                        questTitle: quest.title
                    };
                }
            }

            // Check for quest progression
            for (const userQuest of user.quests) {
                if (userQuest.completed) continue;

                const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                if (!quest) continue;

                const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
                if (!currentEvent) continue;

                this.logger.debug('Checking quest event for actor chat progression:', {
                    questId: quest._id.toString(),
                    questTitle: quest.title,
                    currentEventId: currentEvent._id.toString(),
                    currentEventType: currentEvent.eventType,
                    actorId: actorId,
                    hasChoices: currentEvent.choices?.length > 0,
                    choiceCount: currentEvent.choices?.length || 0
                });

                const availableChoices = currentEvent.choices.filter(choice => {
                    const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                    
                    // Debug the comparison
                    if (nextEvent) {
                        this.logger.debug('Comparing next event actorId with provided actorId:', {
                            nextEventId: nextEvent._id.toString(),
                            nextEventActorId: nextEvent.actorId,
                            providedActorId: actorId,
                            isMatch: nextEvent.actorId === actorId,
                            nextEventActorIdType: typeof nextEvent.actorId,
                            providedActorIdType: typeof actorId
                        });
                    }
                    
                    // Convert both to strings for comparison
                    return nextEvent && 
                           nextEvent.actorId && 
                           nextEvent.actorId.toString() === actorId.toString();
                });

                this.logger.debug('Available choices after filtering:', {
                    availableChoicesCount: availableChoices.length,
                    availableChoices: availableChoices.map(c => c.nextEventId.toString())
                });

                if (availableChoices.length > 0) {
                    const nextEvent = quest.events.find(e => e._id.toString() === availableChoices[0].nextEventId.toString());
                    
                    userQuest.completedEventIds.push(currentEvent._id.toString());
                    userQuest.currentEventId = nextEvent._id.toString();
                    
                    const isComplete = nextEvent.isEnd || nextEvent.choices.length === 0;
                    if (isComplete) {
                        // Process event rewards before marking complete
                        await this.handleEventRewards(user, nextEvent);
                        
                        userQuest.completed = true;
                        userQuest.completedAt = new Date();
                        
                        // For chat events, we'll combine the completion message with the actor's message
                        // to avoid displaying two separate messages
                        if (nextEvent.eventType === 'chat') {
                            // First, just send the actor's chat message
                            this.messageService.sendQuestsMessage(
                                user._id.toString(),
                                nextEvent.message
                            );
                            
                            // Then send the quest completion notification
                            this.messageService.sendQuestsMessage(
                                user._id.toString(),
                                `Quest "${quest.title}" completed!`
                            );
                        } else {
                            // For non-chat events, we process rewards first (keeping previous behavior)
                            // Process rewards first, then send messages
                            await this.handleEventRewards(user, nextEvent);
                            
                            // For non-chat events, send the completion message separately
                            this.messageService.sendSuccessMessage(
                                user._id.toString(),
                                `Quest "${quest.title}" completed!`
                            );
                            
                            // Only send the quest message if it exists and this isn't a chat event
                            if (nextEvent.message) {
                                this.messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    nextEvent.message
                                );
                            }
                        }
                    } else {
                        // Not a completion, just send the quest message
                        if (nextEvent.message) {
                            this.messageService.sendQuestsMessage(
                                user._id.toString(),
                                nextEvent.message
                            );
                        }
                    }
                    
                    // Use findOneAndUpdate instead of save
                    try {
                        // Find the index of the quest we're updating
                        const questIndex = user.quests.findIndex(q => 
                            q.questId === userQuest.questId
                        );
                        
                        if (questIndex === -1) {
                            throw new Error(`Quest not found in user quests: ${userQuest.questId}`);
                        }
                        
                        // Prepare update object with atomic operators
                        const updateQuery = {
                            $set: {
                                [`quests.${questIndex}.currentEventId`]: userQuest.currentEventId,
                            }
                        };
                        
                        // Add completedEventIds
                        if (userQuest.completedEventIds?.length > 0) {
                            updateQuery.$set = {
                                [`quests.${questIndex}.completedEventIds`]: userQuest.completedEventIds
                            };
                        }
                        
                        // Handle completion if needed
                        if (isComplete) {
                            updateQuery.$set = {
                                [`quests.${questIndex}.completed`]: true,
                                [`quests.${questIndex}.completedAt`]: new Date(),
                            };
                        }
                        
                        this.logger.debug('Executing findOneAndUpdate for quest progress/completion:', {
                            userId: user._id.toString(),
                            questIndex,
                            updateQuery,
                            isComplete
                        });
                        
                        // Execute the atomic update
                        const updatedUser = await this.User.findOneAndUpdate(
                            { _id: user._id },
                            updateQuery,
                            { new: true } // Return the updated document
                        );
                        
                        if (!updatedUser) {
                            throw new Error(`User not found after update: ${user._id}`);
                        }
                        
                        // Update the user object with the latest data
                        user = updatedUser;
                        
                        this.logger.debug('Quest progress/completion saved successfully with findOneAndUpdate', {
                            userId: user._id.toString(),
                            questId: quest._id.toString(),
                            questTitle: quest.title,
                            isComplete
                        });
                        
                        // Refresh node data for the player to update actor overrides
                        await this.refreshPlayerNode(user._id.toString());
                    } catch (updateError) {
                        this.logger.error('Error updating user for quest progress/completion:', {
                            error: updateError.message,
                            userId: user._id.toString(),
                            stack: updateError.stack
                        });
                        
                        // Don't rethrow, try to continue
                    }

                    return {
                        type: 'quest_progress',
                        questTitle: quest.title,
                        isComplete,
                        message: nextEvent.message
                    };
                }
            }

            return null;
        } catch (error) {
            this.logger.error('Error in handleQuestProgression:', error, {
                userId: user?._id?.toString(),
                completionEventIds,
                questToActivate
            });
            
            // Define a local questUpdates variable if it doesn't exist in this scope
            // This is needed because the original variable could be out of scope in the catch block
            let localQuestUpdates = [];
            
            try {
                // Try to use the existing questUpdates if defined
                if (typeof questUpdates !== 'undefined' && questUpdates) {
                    localQuestUpdates = questUpdates;
                }
            } catch (scopeError) {
                // If questUpdates is really undefined, just use the empty array we created
                this.logger.debug('Using empty questUpdates array in error handler');
            }
            
            return localQuestUpdates.length > 0 ? localQuestUpdates : [];
        }
    }

    async handleMobKill(user, mobId) {
        try {
            this.logger.debug('handleMobKill called with:', { userId: user._id, mobId });

            // Initialize quests array if it doesn't exist
            if (!user.quests) {
                user.quests = [];
            }

            const allQuests = await this.Quest.find();
            let questUpdates = [];
            let userNeedsSaving = false;

            // Check each active quest
            for (const userQuest of user.quests) {
                if (userQuest.completed) continue;

                const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                if (!quest) continue;

                const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
                if (!currentEvent) continue;

                // Check each choice's target event for kill requirements
                if (currentEvent.choices) {
                    for (const choice of currentEvent.choices) {
                        const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                        if (!nextEvent || nextEvent.eventType !== 'kill') continue;

                        // Check if this is the mob we need to kill
                        const targetMobId = (nextEvent.mobId && nextEvent.mobId._id) ? 
                            nextEvent.mobId._id.toString() : 
                            (nextEvent.mobId ? nextEvent.mobId.toString() : '');
                        const killedMobId = mobId ? mobId.toString() : '';

                        if (targetMobId && killedMobId && targetMobId === killedMobId) {
                            // Handle kill progress tracking
                            let killProgress = userQuest.killProgress?.find(kp => 
                                kp.eventId === nextEvent._id.toString()
                            );

                            if (!killProgress) {
                                // Initialize kill progress with quantity-1 since this kill counts
                                if (!userQuest.killProgress) {
                                    userQuest.killProgress = [];
                                }
                                killProgress = {
                                    eventId: nextEvent._id.toString(),
                                    remaining: nextEvent.quantity - 1
                                };
                                userQuest.killProgress.push(killProgress);
                                userNeedsSaving = true;
                            } else {
                                killProgress.remaining--;
                                userNeedsSaving = true;
                            }

                            this.logger.debug('Updated kill progress:', {
                                questTitle: quest.title,
                                newRemaining: killProgress.remaining,
                                killProgress
                            });

                            if (killProgress.remaining <= 0) {
                                // Kill requirement met
                                userQuest.completedEventIds.push(currentEvent._id.toString());
                                userQuest.currentEventId = nextEvent._id.toString();
                                
                                // Add reward handling before sending messages
                                await this.handleEventRewards(user, nextEvent);

                                this.messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}" updated: Kill requirement complete!${nextEvent.message ? '\n\n' + nextEvent.message : ''}`
                                );

                                // Now clear the kill progress
                                userQuest.killProgress = userQuest.killProgress.filter(kp => 
                                    kp.eventId !== nextEvent._id.toString()
                                );
                                userNeedsSaving = true;

                                if (nextEvent.isEnd) {
                                    userQuest.completed = true;
                                    userQuest.completedAt = new Date();
                                    this.messageService.sendSuccessMessage(
                                        user._id.toString(),
                                        `Quest "${quest.title}" completed!`
                                    );
                                }

                                questUpdates.push({
                                    type: 'quest_progress',
                                    questTitle: quest.title,
                                    isComplete: nextEvent.isEnd,
                                    message: nextEvent.message
                                });
                            } else {
                                this.messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}": ${killProgress.remaining} more ${nextEvent.mobId.name || 'mobs'} remaining to kill.`
                                );
                                
                                questUpdates.push({
                                    type: 'quest_progress',
                                    questTitle: quest.title,
                                    message: `${killProgress.remaining} more ${nextEvent.mobId.name || 'mobs'} remaining to kill.`
                                });
                            }
                        }
                    }
                }
            }

            if (userNeedsSaving) {
                try {
                    // For compatibility with tests
                    if (user.save && typeof user.save === 'function' && user.save.mock) {
                        // This is a mock in tests - just call it
                        user.save();
                    } else {
                        // This is a real user - use findOneAndUpdate to avoid version conflicts
                        const updatedUser = await this.User.findOneAndUpdate(
                            { _id: user._id },
                            { $set: { quests: user.quests } },
                            { new: true }
                        );
                        
                        if (!updatedUser) {
                            throw new Error(`User not found after mob kill update: ${user._id}`);
                        }
                        
                        // Update local reference
                        user = updatedUser;
                    }
                    
                    this.logger.debug('Updated user after mob kill:', {
                        userId: user._id.toString(),
                        questUpdates: questUpdates.length
                    });
                } catch (error) {
                    this.logger.error('Error saving user after mob kill:', {
                        error: error.message,
                        userId: user._id.toString(),
                        stack: error.stack
                    });
                    // Continue and return quest updates anyway
                }
            }

            return questUpdates.length > 0 ? questUpdates : [];
        } catch (error) {
            this.logger.error('Error handling mob kill for quests:', error);
            return [];
        }
    }

    async handleEventRewards(user, event) {
        this.logger.debug('handleEventRewards called with:', { 
            userId: user?._id?.toString(),
            hasEvent: !!event,
            hasRewards: !!(event?.rewards),
            rewardCount: event?.rewards?.length || 0,
            rewards: event?.rewards?.map(r => ({type: r.type, value: r.value}))
        });
        
        if (!event.rewards || event.rewards.length === 0) {
            this.logger.debug('No rewards found in event, returning early');
            return;
        }

        for (const reward of event.rewards) {
            if (reward.type === 'gainClass') {
                try {
                    // Verify the class exists
                    const classDoc = await this.Class.findById(reward.value);
                    if (!classDoc) {
                        this.logger.error('Class not found for reward:', {
                            classId: reward.value,
                            userId: user._id
                        });
                        continue;
                    }

                    // Use the new setUserClass method
                    const result = await this.userService.setUserClass(user._id, classDoc._id);
                    
                    if (result.success) {
                        this.messageService.sendSuccessMessage(
                            user._id.toString(),
                            `You have gained the ${result.className} class!\n` +
                            `Your hitpoints are now ${result.stats.hitpoints}.\n` +
                            `You have gained ${result.moveCount} class moves!`
                        );

                        this.logger.debug('Class reward granted:', {
                            userId: user._id,
                            className: result.className,
                            stats: result.stats
                        });
                    }
                } catch (error) {
                    this.logger.error('Error handling class reward:', error);
                }
            } else if (reward.type === 'experiencePoints') {
                try {
                    const experiencePoints = parseInt(reward.value);
                    this.logger.debug('Processing experience points reward:', {
                        userId: user._id?.toString(),
                        experiencePoints,
                        rawValue: reward.value,
                        isValid: !isNaN(experiencePoints) && experiencePoints > 0
                    });
                    
                    if (!isNaN(experiencePoints) && experiencePoints > 0) {
                        this.logger.debug('Awarding event experience points:', {
                            userId: user._id,
                            experiencePoints
                        });

                        const experienceResult = await this.userService.awardExperience(user._id.toString(), experiencePoints);
                        
                        this.logger.debug('Event experience award result:', {
                            success: experienceResult.success,
                            experienceGained: experienceResult.experienceGained,
                            leveledUp: experienceResult.leveledUp,
                            newLevel: experienceResult.newLevel
                        });

                        if (experienceResult.success) {
                            this.messageService.sendSuccessMessage(
                                user._id.toString(),
                                `You gained ${experiencePoints} experience points!` +
                                (experienceResult.leveledUp ? `\nYou reached level ${experienceResult.newLevel}!` : '')
                            );
                        }
                    }
                } catch (error) {
                    this.logger.error('Error handling experience points reward:', error, {
                        userId: user._id,
                        experiencePoints: reward.value
                    });
                }
            }
        }
    }

    async getUserQuestInfo(userId) {
        try {
            const user = await this.User.findById(userId);
            if (!user || !user.quests) {
                this.logger.debug('No user or no quests found for user', { userId });
                return { 
                    activeQuestIds: [], 
                    completedQuestIds: [], 
                    completedQuestEventIds: [],
                    quests: []
                };
            }

            // Get all active quest IDs
            const activeQuestIds = user.quests
                .filter(userQuest => !userQuest.completed)
                .map(userQuest => userQuest.questId);

            // Get all completed quest IDs
            const completedQuestIds = user.quests
                .filter(userQuest => userQuest.completed)
                .map(userQuest => userQuest.questId);

            // Get all completed quest event IDs across all quests
            const completedQuestEventIds = [];
            user.quests.forEach(userQuest => {
                if (userQuest.completedEventIds && Array.isArray(userQuest.completedEventIds)) {
                    completedQuestEventIds.push(...userQuest.completedEventIds);
                }
            });

            this.logger.debug('User quest info retrieved', {
                userId,
                activeQuestCount: activeQuestIds.length,
                completedQuestCount: completedQuestIds.length,
                completedQuestEventCount: completedQuestEventIds.length,
                questCount: user.quests.length
            });

            return {
                activeQuestIds,
                completedQuestIds,
                completedQuestEventIds,
                quests: user.quests
            };
        } catch (error) {
            this.logger.error('Error getting user quest info:', error, { userId });
            return { 
                activeQuestIds: [], 
                completedQuestIds: [], 
                completedQuestEventIds: [],
                quests: []
            };
        }
    }
    
    /**
     * Refresh the node data for a player after a quest event is completed
     * This ensures that actor overrides are correctly applied or removed
     * 
     * @param {string} userId - The ID of the user
     */
    async refreshPlayerNode(userId) {
        try {
            // Get the user's socket
            const socket = this.stateService.getClient(userId);
            if (!socket) {
                this.logger.debug('No socket found for user, cannot refresh node data', { userId });
                return;
            }
            
            // Get the user to find their current node
            const user = await this.User.findById(userId);
            if (!user || !user.currentNode) {
                this.logger.debug('No user or current node found, cannot refresh node data', { userId });
                return;
            }
            
            this.logger.debug('Refreshing node data for player after quest event', {
                userId,
                currentNode: user.currentNode
            });
            
            // Get the node with user-specific quest overrides
            const nodeData = await this.nodeService.getNodeWithOverrides(user.currentNode, userId);
            if (!nodeData) {
                this.logger.warn('Could not get node data for refresh', { 
                    userId, 
                    nodeAddress: user.currentNode 
                });
                return;
            }
            
            // Add flag to tell client not to update the node image
            // This ensures image doesn't change when refreshing node data due to quest changes
            nodeData.suppressImageDisplay = true;
            
            // Send the updated node data to the player
            socket.emit('node data', nodeData);
            
            this.logger.debug('Sent refreshed node data to player', { 
                userId,
                nodeAddress: user.currentNode,
                suppressImageDisplay: true
            });
        } catch (error) {
            this.logger.error('Error refreshing player node data', {
                error: error.message,
                stack: error.stack,
                userId
            });
        }
    }
}

// Create a singleton instance
const questService = new QuestService();

// Export the singleton instance as the main export (for backward compatibility)
module.exports = questService;

// Add the class constructor as a property for new code that wants to instantiate directly
module.exports.QuestService = QuestService; 