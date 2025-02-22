const Quest = require('../models/Quest');
const User = require('../models/User');
const logger = require('../config/logger');
const messageService = require('./messageService');

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

    async handleQuestProgression(user, actorId, completionEventIds = []) {
        try {
            if (!user) {
                logger.error('No user provided');
                return null;
            }

            logger.debug('handleQuestProgression called with:', {
                userId: user._id.toString(),
                actorId,
                completionEventIds,
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
                    if (!quest) continue;

                    // Find the current event
                    const currentEvent = quest.events.find(e => 
                        e._id.toString() === userQuest.currentEventId
                    );
                    
                    if (!currentEvent) continue;

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

                        if (nextEvent?.isEnd) {
                            userQuest.completed = true;
                            userQuest.completedAt = new Date();
                            
                            logger.debug('Completing quest:', {
                                questId: quest._id.toString(),
                                questTitle: quest.title
                            });

                            messageService.sendSuccessMessage(
                                user._id.toString(),
                                `Quest "${quest.title}" completed!`
                            );

                            questUpdates.push({
                                type: 'quest_complete',
                                questTitle: quest.title
                            });
                        }
                    }
                }

                if (questUpdates.length > 0) {
                    logger.debug('Saving quest updates:', {
                        updates: questUpdates
                    });
                    await user.save();
                    return questUpdates;
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
                        messageService.sendSuccessMessage(
                            user._id.toString(),
                            `Quest "${quest.title}" completed!`
                        );
                    }
                    
                    await user.save();

                    messageService.sendQuestsMessage(
                        user._id.toString(),
                        nextEvent.message
                    );

                    return {
                        type: 'quest_progress',
                        questTitle: quest.title,
                        isComplete
                    };
                }
            }

            return null;
        } catch (error) {
            logger.error('Error handling quest progression:', error, {
                userId: user._id.toString(),
                completionEventIds
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
                                // Initialize kill progress
                                if (!userQuest.killProgress) {
                                    userQuest.killProgress = [];
                                }
                                killProgress = {
                                    eventId: nextEvent._id.toString(),
                                    remaining: nextEvent.quantity
                                };
                                userQuest.killProgress.push(killProgress);
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);
                            }

                            killProgress.remaining--;
                            user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);

                            if (killProgress.remaining <= 0) {
                                // Kill requirement met
                                userQuest.completedEventIds.push(currentEvent._id.toString());
                                userQuest.currentEventId = nextEvent._id.toString();
                                
                                userQuest.killProgress = userQuest.killProgress.filter(kp => 
                                    kp.eventId !== nextEvent._id.toString()
                                );
                                user.markModified(`quests.${user.quests.indexOf(userQuest)}.killProgress`);

                                messageService.sendQuestsMessage(
                                    user._id.toString(),
                                    `Quest "${quest.title}" updated: Kill requirement complete!\n\n${nextEvent.message}`
                                );

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
}

const questService = new QuestService();
module.exports = {
    getActiveQuests: questService.getActiveQuests.bind(questService),
    handleQuestProgression: questService.handleQuestProgression.bind(questService),
    handleMobKill: questService.handleMobKill.bind(questService)
}; 