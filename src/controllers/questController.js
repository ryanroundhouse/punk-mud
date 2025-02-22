const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const logger = require('../config/logger');

async function getQuests(req, res) {
    try {
        const quests = await Quest.find()
            .sort({ title: 1 })
            .populate('events.mobId')
            .populate('events.conversationId'); // Add population for conversation
        res.json(quests);
    } catch (error) {
        logger.error('Error fetching quests:', error);
        res.status(500).json({ error: 'Error fetching quests' });
    }
}

async function createOrUpdateQuest(req, res) {
    const { _id, title, journalDescription, events, experiencePoints } = req.body;
    
    try {
        // Validate basic fields
        if (!title || !journalDescription || !events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate experience points
        if (experiencePoints < 0) {
            return res.status(400).json({ 
                error: 'Invalid experience points',
                details: 'Experience points cannot be negative'
            });
        }

        // Validate each event
        for (const event of events) {
            if (!event.eventType) {
                return res.status(400).json({ 
                    error: 'Invalid event data',
                    details: 'Each event must have an eventType'
                });
            }

            // Validate based on event type
            if (event.eventType === 'chat') {
                if (!event.actorId || !event.message) {
                    return res.status(400).json({ 
                        error: 'Invalid chat event data',
                        details: 'Chat events must have actorId and message'
                    });
                }
            } else if (event.eventType === 'kill') {
                if (!event.mobId || !event.quantity || event.quantity < 1) {
                    return res.status(400).json({ 
                        error: 'Invalid kill event data',
                        details: 'Kill events must have mobId and quantity (minimum 1)'
                    });
                }
            } else if (event.eventType === 'conversation') {
                if (!event.conversationId) {
                    return res.status(400).json({ 
                        error: 'Invalid conversation event data',
                        details: 'Conversation events must have a conversationId'
                    });
                }
            } else {
                return res.status(400).json({ 
                    error: 'Invalid event type',
                    details: 'Event type must be either "chat", "kill", or "conversation"'
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

        let quest;
        if (_id) {
            // Update existing quest
            quest = await Quest.findById(_id);
            if (!quest) {
                return res.status(404).json({ error: 'Quest not found' });
            }

            // Preserve existing event IDs or create new ones
            const updatedEvents = events.map(event => ({
                ...event,
                _id: event._id || new mongoose.Types.ObjectId()
            }));

            quest.title = title;
            quest.journalDescription = journalDescription;
            quest.experiencePoints = experiencePoints;
            quest.events = updatedEvents;
            await quest.save();
        } else {
            // Create new quest
            const eventsWithIds = events.map(event => ({
                ...event,
                _id: new mongoose.Types.ObjectId()
            }));

            quest = new Quest({
                title,
                journalDescription,
                experiencePoints,
                events: eventsWithIds
            });
            await quest.save();
        }
        
        res.status(_id ? 200 : 201).json(quest);
    } catch (error) {
        logger.error('Error saving quest:', error);
        res.status(500).json({ error: 'Error saving quest', details: error.message });
    }
}

async function getQuestById(req, res) {
    try {
        const quest = await Quest.findById(req.params.id)
            .populate('events.mobId');
        
        if (!quest) {
            return res.status(404).json({ error: 'Quest not found' });
        }
        
        res.json(quest);
    } catch (error) {
        logger.error('Error fetching quest:', error);
        res.status(500).json({ error: 'Error fetching quest' });
    }
}

async function deleteQuest(req, res) {
    try {
        const quest = await Quest.findByIdAndDelete(req.params.id);
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
    getQuestById,
    createOrUpdateQuest,
    deleteQuest
}; 