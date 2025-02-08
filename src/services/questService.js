const Quest = require('../models/Quest');
const User = require('../models/User');
const logger = require('../config/logger');

async function handleQuestProgression(userId, actorId) {
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
            if (!quest) {
                logger.error('No quest found for ID:', userQuest.questId);
                continue;
            }

            const currentEvent = quest.events.find(e => e._id.toString() === userQuest.currentEventId);

            if (!currentEvent) {
                logger.error('No current event found');
                continue;
            }

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

        logger.debug('No quest progression found');
        return null;
    } catch (error) {
        logger.error('Error handling quest progression:', error);
        return null;
    }
}

module.exports = {
    handleQuestProgression
}; 