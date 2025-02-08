const Quest = require('../models/Quest');
const logger = require('../config/logger');

async function getQuests(req, res) {
    try {
        const quests = await Quest.find().sort({ title: 1 });
        res.json(quests);
    } catch (error) {
        logger.error('Error fetching quests:', error);
        res.status(500).json({ error: 'Error fetching quests' });
    }
}

async function createOrUpdateQuest(req, res) {
    const { id, title, journalDescription, events } = req.body;
    
    try {
        // Validate basic fields
        if (!title || !journalDescription || !events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate each event
        for (const event of events) {
            if (!event.id || !event.actorId || !event.message) {
                return res.status(400).json({ 
                    error: 'Invalid event data',
                    details: 'Each event must have an id, actorId, and message'
                });
            }

            // Validate choices if they exist
            if (event.choices) {
                if (!Array.isArray(event.choices)) {
                    return res.status(400).json({ 
                        error: 'Invalid choices format',
                        details: 'Choices must be an array'
                    });
                }

                for (const choice of event.choices) {
                    if (!choice.nextEventId) {
                        return res.status(400).json({ 
                            error: 'Invalid choice data',
                            details: 'Each choice must have a nextEventId'
                        });
                    }
                }
            }
        }

        // Validate that there is exactly one start event
        const startEvents = events.filter(event => event.isStart);
        if (startEvents.length !== 1) {
            return res.status(400).json({ 
                error: 'Invalid start event',
                details: 'Quest must have exactly one start event'
            });
        }

        if (id) {
            const existingQuest = await Quest.findOne({ id });
            if (!existingQuest) {
                return res.status(404).json({ error: 'Quest not found' });
            }

            existingQuest.title = title;
            existingQuest.journalDescription = journalDescription;
            existingQuest.events = events;
            
            await existingQuest.save();
            return res.json(existingQuest);
        }

        const quest = new Quest({
            title,
            journalDescription,
            events
        });
        
        await quest.save();
        res.status(201).json(quest);
    } catch (error) {
        logger.error('Error saving quest:', error);
        res.status(500).json({ error: 'Error saving quest' });
    }
}

async function deleteQuest(req, res) {
    try {
        const quest = await Quest.findOneAndDelete({ id: req.params.id });
        if (!quest) {
            return res.status(404).json({ error: 'Quest not found' });
        }
        res.json({ message: 'Quest deleted successfully' });
    } catch (error) {
        logger.error('Error deleting quest:', error);
        res.status(500).json({ error: 'Error deleting quest' });
    }
}

module.exports = {
    getQuests,
    createOrUpdateQuest,
    deleteQuest
}; 