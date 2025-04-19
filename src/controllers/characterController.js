const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../config/logger');

// Add these level thresholds at the top of the file
const levelThresholds = [
    0,      // Level 1
    100,    // Level 2
    241,    // Level 3
    465,    // Level 4
    781,    // Level 5
    1202,   // Level 6
    1742,   // Level 7
    2415,   // Level 8
    3236,   // Level 9
    4220,   // Level 10
    5383    // Level 11
];

function calculateExpProgress(experience, level) {
    if (level >= levelThresholds.length) {
        return { current: 0, required: 0, percentage: 100 };
    }
    
    const currentLevelExp = levelThresholds[level - 1] || 0;
    const nextLevelExp = levelThresholds[level] || levelThresholds[levelThresholds.length - 1];
    const expToNext = nextLevelExp - currentLevelExp;
    const currentProgress = experience - currentLevelExp;
    const percentage = Math.min(100, Math.floor((currentProgress / expToNext) * 100));

    return {
        current: currentProgress,
        required: expToNext,
        percentage
    };
}

async function registerAvatar(req, res) {
    try {
        const { avatarName } = req.body;
        const email = req.user.email;
        logger.info(`Registering avatar name "${avatarName}" for email: ${email}`);

        // Basic validation
        if (!avatarName || avatarName.trim() === '') {
            return res.status(400).json({ error: 'Avatar name is required' });
        }

        // Check if trying to use reserved name "SYSTEM" (case insensitive)
        if (avatarName.toUpperCase() === 'SYSTEM') {
            return res.status(400).json({ error: 'This avatar name is reserved' });
        }

        // Check if avatar name is already taken (case insensitive)
        const existingAvatar = await User.findOne({ 
            avatarName: { $regex: new RegExp(`^${avatarName}$`, 'i') } 
        });
        
        if (existingAvatar) {
            return res.status(400).json({ error: 'Avatar name already taken' });
        }

        // Get the current user to check their moves
        const currentUser = await User.findOne({ email });
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prepare update object
        const updateObj = { avatarName };
        
        // If user has no moves, add the default move
        if (!currentUser.moves || currentUser.moves.length === 0) {
            updateObj.moves = ['67e5ee92505d5890de625149'];
            logger.debug('Adding default move to new character');
        }

        // Update user with avatar name and potentially default move
        const user = await User.findOneAndUpdate(
            { email },
            updateObj,
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'Avatar registered successfully' });
    } catch (error) {
        logger.error('Avatar registration error:', error);
        res.status(500).json({ error: 'Failed to register avatar' });
    }
}

async function getCharacterData(req, res) {
    try {
        const user = await User.findById(req.user.userId).populate('class').populate('moves');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const expProgress = calculateExpProgress(user.stats.experience, user.stats.level);

        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image,
            stats: user.stats,
            class: user.class ? user.class.name : null,
            moves: user.moves,
            expProgress
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
}

async function getCharacterByUsername(req, res) {
    try {
        const character = await User.findOne({ avatarName: req.params.username }).populate('class').populate('moves');
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }

        const expProgress = calculateExpProgress(character.stats.experience, character.stats.level);
        
        res.json({
            avatarName: character.avatarName,
            description: character.description,
            image: character.image,
            stats: character.stats,
            class: character.class ? character.class.name : null,
            moves: character.moves,
            expProgress
        });
    } catch (error) {
        logger.error('Error fetching character data:', error);
        res.status(500).json({ error: 'Error fetching character data' });
    }
}

async function updateCharacter(req, res) {
    try {
        const { description, image } = req.body;
        
        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { description, image },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            avatarName: user.avatarName,
            description: user.description,
            image: user.image
        });
    } catch (error) {
        logger.error('Error updating character:', error);
        res.status(500).json({ error: 'Error updating character' });
    }
}

async function getCharacterQuests(req, res) {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // If no quests, return empty arrays
        if (!user.quests || user.quests.length === 0) {
            return res.json({
                active: [],
                completed: []
            });
        }

        // Get all questIds to fetch
        const questIds = user.quests.map(q => q.questId);
        logger.debug('Fetching quest details for IDs:', questIds);
        
        // Fetch all quest details from Quest collection
        const Quest = mongoose.model('Quest');
        const questDetails = await Quest.find({ _id: { $in: questIds } })
            .populate('events.mobId'); // Populate mob references for kill events
        
        // Create lookup table for quest details by ID
        const questLookup = {};
        questDetails.forEach(quest => {
            questLookup[quest._id.toString()] = quest;
        });

        // Function to find event by ID in a quest
        const findEventById = (quest, eventId) => {
            if (!quest || !quest.events || !eventId) return null;
            return quest.events.find(e => e._id.toString() === eventId);
        };

        // Format active and completed quests with event hints
        const result = {
            active: [],
            completed: []
        };

        // Process active quests
        for (const userQuest of user.quests.filter(q => !q.completed)) {
            const questDetail = questLookup[userQuest.questId];
            if (!questDetail) continue;

            // Find the current event
            const currentEvent = findEventById(questDetail, userQuest.currentEventId);
            if (!currentEvent) continue;

            // Get choice events and their hints
            const choiceHints = [];
            if (currentEvent.choices && currentEvent.choices.length > 0) {
                for (const choice of currentEvent.choices) {
                    const nextEventId = choice.nextEventId.toString();
                    const nextEvent = findEventById(questDetail, nextEventId);
                    
                    if (nextEvent) {
                        // Get the hint from the next event
                        let hintText = nextEvent.hint || '';
                        
                        // If it's a kill event and hint contains [Quantity], replace with remaining count
                        if (nextEvent.eventType === 'kill' && hintText.includes('[Quantity]')) {
                            // Find kill progress for this event if available
                            const killProgress = userQuest.killProgress?.find(kp => kp.eventId === nextEventId);
                            const remaining = killProgress ? killProgress.remaining : nextEvent.quantity;
                            hintText = hintText.replace('[Quantity]', remaining);
                        }
                        // If no hint is available, generate one based on event type
                        else if (!hintText) {
                            if (nextEvent.eventType === 'kill' && nextEvent.mobId) {
                                const mobName = nextEvent.mobId.name || 'enemies';
                                
                                // Check if we have kill progress info for this event
                                const killProgress = userQuest.killProgress?.find(kp => kp.eventId === nextEventId);
                                const remaining = killProgress ? killProgress.remaining : nextEvent.quantity;
                                
                                hintText = `Defeat ${remaining} ${mobName}.`;
                            } else if (nextEvent.eventType === 'chat') {
                                hintText = 'Speak with someone.';
                            } else if (nextEvent.eventType === 'stage') {
                                hintText = 'Complete the current objective.';
                            }
                        }
                        
                        if (hintText) {
                            choiceHints.push({
                                eventId: nextEventId,
                                hint: hintText
                            });
                        }
                    }
                }
            }

            result.active.push({
                questId: userQuest.questId,
                title: questDetail.title || 'Unknown Quest',
                journalDescription: questDetail.journalDescription || 'No description available',
                currentEventId: userQuest.currentEventId,
                choiceHints: choiceHints,
                progress: userQuest.progress || 0
            });
        }

        // Process completed quests
        for (const userQuest of user.quests.filter(q => q.completed)) {
            const questDetail = questLookup[userQuest.questId];
            if (!questDetail) continue;

            // Get hints for all completed events
            const completedHints = [];
            if (userQuest.completedEventIds && userQuest.completedEventIds.length > 0) {
                for (const eventId of userQuest.completedEventIds) {
                    const event = findEventById(questDetail, eventId);
                    if (event && event.hint) {
                        completedHints.push({
                            eventId: eventId,
                            hint: event.hint
                        });
                    }
                }
            }
            
            // Add the current event hint at the end of the list (for completed quests)
            if (userQuest.currentEventId) {
                const currentEvent = findEventById(questDetail, userQuest.currentEventId);
                if (currentEvent && currentEvent.hint) {
                    completedHints.push({
                        eventId: userQuest.currentEventId,
                        hint: currentEvent.hint
                    });
                }
            }

            result.completed.push({
                questId: userQuest.questId,
                title: questDetail.title || 'Unknown Quest',
                journalDescription: questDetail.journalDescription || 'No description available',
                completedHints: completedHints,
                dateCompleted: userQuest.completedAt
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('Error fetching character quests:', error);
        res.status(500).json({ error: 'Error fetching character quests' });
    }
}

module.exports = {
    registerAvatar,
    getCharacterData,
    getCharacterByUsername,
    updateCharacter,
    getCharacterQuests
}; 