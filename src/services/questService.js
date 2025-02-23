const Quest = require('../models/Quest');
const User = require('../models/User');
const logger = require('../config/logger');
const messageService = require('./messageService');
const userService = require('./userService');
const Class = require('../models/Class');

class QuestService {
    async getActiveQuests(userId) {
        try {
            const user = await User.findById(userId);
            if (!user || !user.quests) {
                return [];
            }

            const allQuests = await Quest.find();
            
            const activeQuests = user.quests
                .filter(userQuest => !userQuest.completed)
                .map(userQuest => {
                    const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                    if (!quest) return null;

                    const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
                    if (!currentEvent) return null;
                    
                    const choices = currentEvent.choices.map(choice => {
                        const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                        if (!nextEvent) return null;

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
                        title: quest.title,
                        hints: choices.length > 0 ? choices : ['No available choices']
                    };
                })
                .filter(Boolean);

            return activeQuests;
        } catch (error) {
            logger.error('Error getting active quests:', error);
            throw error;
        }
    }

    async handleQuestProgression(user, actorId, completionEventIds = [], questToActivate = null) {
        try {
            // Add validation at the start
            if (!user) {
                logger.error('handleQuestProgression called with undefined user');
                return null;
            }

            logger.debug('handleQuestProgression called with:', {
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

            const allQuests = await Quest.find();
            let questUpdates = [];

            // First handle any completion events
            if (completionEventIds && completionEventIds.length > 0) {
                logger.debug('Processing completion events:', { 
                    completionEventIds,
                    userQuests: user.quests.map(q => ({
                        questId: q.questId,
                        currentEventId: q.currentEventId,
                        completed: q.completed
                    }))
                });
                
                for (const userQuest of user.quests) {
                    if (userQuest.completed) {
                        logger.debug('Skipping completed quest:', {
                            questId: userQuest.questId
                        });
                        continue;
                    }

                    const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                    if (!quest) {
                        logger.debug('Quest not found:', {
                            questId: userQuest.questId
                        });
                        continue;
                    }

                    // Find the current event
                    const currentEvent = quest.events.find(e => 
                        e._id.toString() === userQuest.currentEventId
                    );
                    
                    if (!currentEvent) {
                        logger.debug('Current event not found:', {
                            currentEventId: userQuest.currentEventId
                        });
                        continue;
                    }

                    logger.debug('Checking current event:', {
                        eventId: currentEvent._id.toString(),
                        eventType: currentEvent.eventType,
                        hasChoices: !!currentEvent.choices,
                        choicesCount: currentEvent.choices?.length
                    });

                    // Check if current event has a choice leading to our completion event
                    const nextEventChoice = currentEvent.choices?.find(choice => 
                        completionEventIds.includes(choice.nextEventId.toString())
                    );

                    if (nextEventChoice) {
                        logger.debug('Found matching next event choice:', {
                            currentEventId: currentEvent._id.toString(),
                            nextEventId: nextEventChoice.nextEventId.toString()
                        });

                        // Progress to the next event
                        userQuest.completedEventIds.push(currentEvent._id.toString());
                        userQuest.currentEventId = nextEventChoice.nextEventId.toString();

                        // If this is an end event, complete the quest
                        const nextEvent = quest.events.find(e => 
                            e._id.toString() === nextEventChoice.nextEventId.toString()
                        );

                        if (nextEvent) {
                            // Add reward handling here
                            await this.handleEventRewards(user, nextEvent);

                            if (nextEvent.isEnd) {
                                logger.debug('Found end event:', {
                                    eventId: nextEvent._id.toString(),
                                    questId: quest._id.toString(),
                                    questTitle: quest.title,
                                    hasExperiencePoints: !!quest.experiencePoints,
                                    experiencePoints: quest.experiencePoints
                                });

                                userQuest.completed = true;
                                userQuest.completedAt = new Date();
                                
                                // Make sure to save the user object after updating the quest
                                await user.save();

                                // Always send completion message first
                                messageService.sendSuccessMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}" completed!`
                                );

                                // Award experience points for quest completion
                                try {
                                    const experiencePoints = quest.experiencePoints || 0;
                                    if (experiencePoints > 0) {
                                        logger.debug('Attempting to award experience:', {
                                            questId: quest._id.toString(),
                                            questTitle: quest.title,
                                            experiencePoints,
                                            userId: user._id.toString()
                                        });

                                        const experienceResult = await userService.awardExperience(user._id.toString(), experiencePoints);
                                        
                                        logger.debug('Experience award result:', {
                                            success: experienceResult.success,
                                            experienceGained: experienceResult.experienceGained,
                                            leveledUp: experienceResult.leveledUp,
                                            newLevel: experienceResult.newLevel
                                        });

                                        if (experienceResult.success && experienceResult.leveledUp) {
                                            messageService.sendSuccessMessage(
                                                user._id.toString(),
                                                `You gained ${experiencePoints} experience points!\nYou reached level ${experienceResult.newLevel}!`
                                            );
                                        }
                                    } else {
                                        logger.debug('No experience points to award for quest:', {
                                            questId: quest._id.toString(),
                                            questTitle: quest.title
                                        });
                                    }
                                } catch (error) {
                                    logger.error('Error in experience award process:', error);
                                }

                                questUpdates.push({
                                    type: 'quest_complete',
                                    questTitle: quest.title,
                                    experiencePoints: quest.experiencePoints || 0
                                });

                                // Add debug logging for quest completion
                                logger.debug('Quest completed and saved:', {
                                    questId: quest._id.toString(),
                                    questTitle: quest.title,
                                    userId: user._id.toString(),
                                    userQuestStatus: userQuest
                                });

                                return questUpdates;
                            } else {
                                logger.debug('Next event is not an end event:', {
                                    eventId: nextEvent._id.toString(),
                                    isEnd: nextEvent.isEnd
                                });
                            }
                        }
                    } else {
                        logger.debug('No matching next event choice found in current event choices');
                    }
                }
            } else {
                logger.debug('No completion events to process');
            }

            // Handle direct quest activation if specified
            if (questToActivate) {
                const questToStart = allQuests.find(q => q._id.toString() === questToActivate.toString());
                
                if (questToStart) {
                    // Check if quest is already active
                    const isQuestActive = user.quests.some(uq => 
                        uq.questId === questToStart._id.toString() && !uq.completed
                    );

                    if (!isQuestActive) {
                        const startEvent = questToStart.events.find(event => event.isStart);
                        
                        if (startEvent) {
                            user.quests.push({
                                questId: questToStart._id.toString(),
                                currentEventId: startEvent._id.toString(),
                                completedEventIds: [],
                                startedAt: new Date()
                            });

                            // Add reward handling for start event
                            await this.handleEventRewards(user, startEvent);
                            
                            await user.save();
                            
                            // Only send the quest start message if there's a message to send
                            if (startEvent.message) {
                                messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `New Quest: ${questToStart.title}\n\n${startEvent.message}`
                                );
                            } else {
                                messageService.sendQuestsMessage(
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
                    user.quests.push({
                        questId: quest._id.toString(),
                        currentEventId: startEvent._id.toString(),
                        completedEventIds: [],
                        startedAt: new Date()
                    });
                    await user.save();
                    
                    messageService.sendQuestsMessage(
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

                const availableChoices = currentEvent.choices.filter(choice => {
                    const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                    return nextEvent && nextEvent.actorId === actorId;
                });

                if (availableChoices.length > 0) {
                    const nextEvent = quest.events.find(e => e._id.toString() === availableChoices[0].nextEventId.toString());
                    
                    userQuest.completedEventIds.push(currentEvent._id.toString());
                    userQuest.currentEventId = nextEvent._id.toString();
                    
                    const isComplete = nextEvent.choices.length === 0;
                    if (isComplete) {
                        userQuest.completed = true;
                        userQuest.completedAt = new Date();

                        // Add experience point handling here
                        try {
                            const experiencePoints = quest.experiencePoints || 0;
                            if (experiencePoints > 0) {
                                logger.debug('Awarding quest completion experience:', {
                                    questId: quest._id.toString(),
                                    questTitle: quest.title,
                                    experiencePoints,
                                    userId: user._id.toString()
                                });

                                const experienceResult = await userService.awardExperience(user._id.toString(), experiencePoints);
                                
                                logger.debug('Quest experience award result:', {
                                    success: experienceResult.success,
                                    experienceGained: experienceResult.experienceGained,
                                    leveledUp: experienceResult.leveledUp,
                                    newLevel: experienceResult.newLevel
                                });

                                if (experienceResult.success) {
                                    messageService.sendSuccessMessage(
                                        user._id.toString(),
                                        `Quest "${quest.title}" completed!\nYou gained ${experiencePoints} experience points!` +
                                        (experienceResult.leveledUp ? `\nYou reached level ${experienceResult.newLevel}!` : '')
                                    );
                                } else {
                                    messageService.sendSuccessMessage(
                                        user._id.toString(),
                                        `Quest "${quest.title}" completed!`
                                    );
                                }
                            } else {
                                messageService.sendSuccessMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}" completed!`
                                );
                            }
                        } catch (error) {
                            logger.error('Error awarding quest experience points:', error, {
                                questId: quest._id.toString(),
                                questTitle: quest.title,
                                experiencePoints: quest.experiencePoints,
                                userId: user._id.toString()
                            });
                            messageService.sendSuccessMessage(
                                user._id.toString(),
                                `Quest "${quest.title}" completed!`
                            );
                        }
                    }
                    
                    await user.save();

                    messageService.sendQuestsMessage(
                        user._id.toString(),
                        nextEvent.message
                    );

                    return {
                        type: 'quest_progress',
                        questTitle: quest.title,
                        isComplete,
                        experiencePoints: isComplete ? (quest.experiencePoints || 0) : 0
                    };
                }
            }

            return null;
        } catch (error) {
            logger.error('Error in handleQuestProgression:', error, {
                userId: user._id.toString(),
                completionEventIds,
                questToActivate
            });
            return null;
        }
    }

    async handleMobKill(user, mobId) {
        try {
            logger.debug('handleMobKill called with:', { userId: user._id, mobId });

            // Initialize quests array if it doesn't exist
            if (!user.quests) {
                user.quests = [];
            }

            const allQuests = await Quest.find();
            let questUpdates = [];

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
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);
                            } else {
                                killProgress.remaining--;
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);
                            }

                            logger.debug('Updated kill progress:', {
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

                                messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}" updated: Kill requirement complete!${nextEvent.message ? '\n\n' + nextEvent.message : ''}`
                                );

                                // Now clear the kill progress
                                userQuest.killProgress = userQuest.killProgress.filter(kp => 
                                    kp.eventId !== nextEvent._id.toString()
                                );
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);

                                if (nextEvent.isEnd) {
                                    userQuest.completed = true;
                                    userQuest.completedAt = new Date();
                                    messageService.sendSuccessMessage(
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
                                messageService.sendQuestsMessage(
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

            if (questUpdates.length > 0) {
                await user.save();
            }

            return questUpdates;
        } catch (error) {
            logger.error('Error handling mob kill for quests:', error);
            return null;
        }
    }

    async handleEventRewards(user, event) {
        if (!event.rewards || event.rewards.length === 0) {
            return;
        }

        for (const reward of event.rewards) {
            if (reward.type === 'gainClass') {
                try {
                    // Verify the class exists
                    const classDoc = await Class.findById(reward.value);
                    if (!classDoc) {
                        logger.error('Class not found for reward:', {
                            classId: reward.value,
                            userId: user._id
                        });
                        continue;
                    }

                    // Use the new setUserClass method
                    const result = await userService.setUserClass(user._id, classDoc._id);
                    
                    if (result.success) {
                        messageService.sendSuccessMessage(
                            user._id.toString(),
                            `You have gained the ${result.className} class!\n` +
                            `Your hitpoints are now ${result.stats.hitpoints}.\n` +
                            `You have gained ${result.moveCount} class moves!`
                        );

                        logger.debug('Class reward granted:', {
                            userId: user._id,
                            className: result.className,
                            stats: result.stats
                        });
                    }
                } catch (error) {
                    logger.error('Error handling class reward:', error);
                }
            }
        }
    }
}

const questService = new QuestService();
module.exports = {
    getActiveQuests: questService.getActiveQuests.bind(questService),
    handleQuestProgression: questService.handleQuestProgression.bind(questService),
    handleMobKill: questService.handleMobKill.bind(questService)
}; 