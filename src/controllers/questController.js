const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const logger = require('../config/logger');

async function getQuests(req, res) {
    try {
        const quests = await Quest.find()
            .populate('events.actorId')
            .populate('events.mobId')
            .populate('events.requiredQuestId')
            .populate('events.activateQuestId')
            .populate('events.rewards.value');
        res.json(quests);
    } catch (error) {
        logger.error('Error fetching quests:', error);
        res.status(500).json({ error: 'Failed to fetch quests' });
    }
}

async function createOrUpdateQuest(req, res) {
    const { _id, title, journalDescription, events } = req.body;
    
    try {
        // Validate basic fields
        if (!title || !journalDescription || !events || !Array.isArray(events)) {
            return res.status(400).json({ error: 'Missing required fields' });
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
            } else if (event.eventType === 'stage') {
                // Stage type only uses base properties, no additional validation needed
            } else {
                return res.status(400).json({ 
                    error: 'Invalid event type',
                    details: 'Event type must be "chat", "kill", or "stage"'
                });
            }

            // Validate node event overrides if they exist
            if (event.nodeEventOverrides && event.nodeEventOverrides.length > 0) {
                for (const override of event.nodeEventOverrides) {
                    if (!override.nodeAddress) {
                        return res.status(400).json({
                            error: 'Invalid node event override',
                            details: 'Node address is required for node event overrides'
                        });
                    }

                    // Verify the node exists
                    const nodeExists = await mongoose.model('Node').exists({ address: override.nodeAddress });
                    if (!nodeExists) {
                        return res.status(400).json({
                            error: 'Invalid node event override',
                            details: `Node with address "${override.nodeAddress}" does not exist`
                        });
                    }

                    if (!override.events || !Array.isArray(override.events) || override.events.length === 0) {
                        return res.status(400).json({
                            error: 'Invalid node event override',
                            details: 'Node event overrides must have at least one event'
                        });
                    }

                    for (const nodeEvent of override.events) {
                        if (!nodeEvent.mobId) {
                            return res.status(400).json({
                                error: 'Invalid node event override',
                                details: 'Each node event must have a mobId'
                            });
                        }

                        // Verify the mob exists
                        const mobExists = await mongoose.model('Mob').exists({ _id: nodeEvent.mobId });
                        if (!mobExists) {
                            return res.status(400).json({
                                error: 'Invalid node event override',
                                details: `Mob with ID "${nodeEvent.mobId}" does not exist`
                            });
                        }

                        if (nodeEvent.chance < 0 || nodeEvent.chance > 100) {
                            return res.status(400).json({
                                error: 'Invalid node event override',
                                details: 'Event chance must be between 0 and 100'
                            });
                        }
                    }
                }
            }

            // Validate rewards if they exist
            if (event.rewards && event.rewards.length > 0) {
                for (const reward of event.rewards) {
                    if (!reward.type || !reward.value) {
                        return res.status(400).json({
                            error: 'Invalid reward data',
                            details: 'Each reward must have a type and value'
                        });
                    }
                    
                    if (reward.type === 'gainClass') {
                        // Verify the class exists
                        const classExists = await mongoose.model('Class').exists({ _id: reward.value });
                        if (!classExists) {
                            return res.status(400).json({
                                error: 'Invalid reward data',
                                details: 'Specified class does not exist'
                            });
                        }
                    } else if (reward.type === 'experiencePoints') {
                        // Validate experience points value
                        const expPoints = parseInt(reward.value);
                        if (isNaN(expPoints) || expPoints < 0) {
                            return res.status(400).json({
                                error: 'Invalid reward data',
                                details: 'Experience points must be a non-negative number'
                            });
                        }
                    }
                }
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
            .populate('events.mobId')
            .populate('events.nodeEventOverrides.events.mobId');
        
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