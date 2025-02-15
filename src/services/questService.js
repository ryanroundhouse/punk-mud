const Quest = require('../models/Quest');
const User = require('../models/User');
const logger = require('../config/logger');

class QuestService {
    async getActiveQuests(userId) {
        try {
            const user = await User.findById(userId);
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
                        return nextEvent?.hint || 'No hint available';
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

    async handleQuestProgression(userId, actorId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                logger.error('No user found for userId:', userId);
                return null;
            }

            // Find quests that haven't been started by the user
            const allQuests = await Quest.find();
            
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
                    
                    return {
                        type: 'quest_start',
                        message: startEvent.message,
                        questTitle: quest.title,
                        choices: startEvent.choices,
                        hint: startEvent.hint
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
                    }
                    
                    await user.save();

                    return {
                        type: 'quest_progress',
                        message: nextEvent.message,
                        questTitle: quest.title,
                        choices: nextEvent.choices,
                        isComplete,
                        hint: nextEvent.hint
                    };
                }
            }

            return null;
        } catch (error) {
            logger.error('Error handling quest progression:', error);
            return null;
        }
    }

    async handleMobKill(userId, mobId) {
        try {
            logger.debug('handleMobKill called with:', { userId, mobId });

            const user = await User.findById(userId);
            if (!user) {
                logger.error('No user found for userId:', userId);
                return null;
            }
            logger.debug('Found user:', { 
                userId: user._id, 
                questCount: user.quests?.length || 0 
            });

            const allQuests = await Quest.find();
            logger.debug('Loaded quests:', { 
                questCount: allQuests.length,
                questIds: allQuests.map(q => q._id)
            });

            let questUpdates = [];

            // Check each active quest
            for (const userQuest of user.quests) {
                logger.debug('Checking user quest:', {
                    questId: userQuest.questId,
                    completed: userQuest.completed,
                    currentEventId: userQuest.currentEventId
                });

                if (userQuest.completed) {
                    logger.debug('Skipping completed quest:', userQuest.questId);
                    continue;
                }

                const quest = allQuests.find(q => q._id.toString() === userQuest.questId);
                if (!quest) {
                    logger.debug('Quest not found:', userQuest.questId);
                    continue;
                }

                const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);
                if (!currentEvent) {
                    logger.debug('Current event not found:', userQuest.currentEventId);
                    continue;
                }

                logger.debug('Current event:', {
                    eventId: currentEvent._id,
                    eventType: currentEvent.eventType,
                    choicesCount: currentEvent.choices?.length || 0
                });

                // Check each choice's target event for kill requirements
                if (currentEvent.choices) {
                    for (const choice of currentEvent.choices) {
                        const nextEvent = quest.events.find(e => e._id.toString() === choice.nextEventId.toString());
                        if (!nextEvent || nextEvent.eventType !== 'kill') continue;

                        logger.debug('Checking next kill event:', {
                            eventId: nextEvent._id,
                            mobId: nextEvent.mobId,
                            mobIdType: typeof nextEvent.mobId,
                            mobIdValue: nextEvent.mobId ? nextEvent.mobId.toString() : 'undefined',
                            quantity: nextEvent.quantity
                        });

                        // Check if this is the mob we need to kill
                        const targetMobId = (nextEvent.mobId && nextEvent.mobId._id) ? 
                            nextEvent.mobId._id.toString() : 
                            (nextEvent.mobId ? nextEvent.mobId.toString() : '');
                        const killedMobId = mobId ? mobId.toString() : '';

                        logger.debug('Comparing mob IDs:', {
                            targetMobId,
                            targetMobIdType: typeof targetMobId,
                            killedMobId,
                            killedMobIdType: typeof killedMobId,
                            matches: targetMobId === killedMobId,
                            nextEventMobId: nextEvent.mobId,
                            providedMobId: mobId
                        });

                        if (targetMobId && killedMobId && targetMobId === killedMobId) {
                            // Find or create kill progress for this specific event
                            let killProgress = userQuest.killProgress?.find(kp => 
                                kp.eventId === nextEvent._id.toString()
                            );

                            if (!killProgress) {
                                // Initialize kill progress for this event if it doesn't exist
                                if (!userQuest.killProgress) {
                                    userQuest.killProgress = [];
                                }
                                killProgress = {
                                    eventId: nextEvent._id.toString(),
                                    remaining: nextEvent.quantity
                                };
                                userQuest.killProgress.push(killProgress);
                                // Mark the quest as modified
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);
                                
                                logger.debug('Initialized kill progress for event:', {
                                    eventId: nextEvent._id,
                                    quantity: nextEvent.quantity
                                });
                            }

                            // Decrement the kill count for this specific event
                            killProgress.remaining--;
                            // Mark the quest as modified after updating kill progress
                            user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);
                            
                            logger.debug('Updated kill progress:', {
                                questId: quest._id,
                                eventId: nextEvent._id,
                                remaining: killProgress.remaining
                            });

                            if (killProgress.remaining <= 0) {
                                logger.debug('Kill requirement met for event:', nextEvent._id);
                                // Move to this kill event now that we've met its requirement
                                userQuest.completedEventIds.push(currentEvent._id.toString());
                                userQuest.currentEventId = nextEvent._id.toString();
                                
                                // Remove the kill progress for this event
                                userQuest.killProgress = userQuest.killProgress.filter(kp => 
                                    kp.eventId !== nextEvent._id.toString()
                                );
                                // Mark the quest as modified after removing kill progress
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);

                                questUpdates.push({
                                    type: 'quest_progress',
                                    message: `Quest "${quest.title}" updated: Kill requirement complete!`,
                                    nextMessage: nextEvent.message,
                                    questTitle: quest.title
                                });

                                // If this is an end event, complete the quest
                                if (nextEvent.isEnd) {
                                    logger.debug('Completing quest:', quest._id);
                                    userQuest.completed = true;
                                    userQuest.completedAt = new Date();

                                    questUpdates.push({
                                        type: 'quest_complete',
                                        message: `Quest "${quest.title}" completed!`,
                                        questTitle: quest.title
                                    });
                                }
                            } else {
                                logger.debug('More kills needed for event:', {
                                    eventId: nextEvent._id,
                                    remaining: killProgress.remaining
                                });
                                questUpdates.push({
                                    type: 'quest_progress',
                                    message: `Quest "${quest.title}": ${killProgress.remaining} more ${nextEvent.mobId.name || 'mobs'} remaining to kill.`,
                                    questTitle: quest.title
                                });
                            }
                            // Don't break here - allow checking other kill events for the same mob
                        }
                    }
                }
            }

            if (questUpdates.length > 0) {
                logger.debug('Saving user with updates:', {
                    userId: user._id,
                    updateCount: questUpdates.length,
                    updates: questUpdates,
                    killProgressUpdates: user.quests.map(q => q.killProgress)
                });
                await user.save();
            } else {
                logger.debug('No quest updates to save');
            }

            return questUpdates;
        } catch (error) {
            logger.error('Error handling mob kill for quests:', error);
            return null;
        }
    }
}

const questService = new QuestService();
module.exports = {
    getActiveQuests: questService.getActiveQuests.bind(questService),
    handleQuestProgression: questService.handleQuestProgression.bind(questService),
    handleMobKill: questService.handleMobKill.bind(questService)
}; 