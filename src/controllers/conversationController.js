const Conversation = require('../models/Conversation');
const logger = require('../config/logger');
const mongoose = require('mongoose');

async function getConversations(req, res) {
    try {
        const conversations = await Conversation.find()
            .sort({ title: 1 })
            .populate('actorId')
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');
        res.json(conversations);
    } catch (error) {
        logger.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Error fetching conversations' });
    }
}

async function createOrUpdateConversation(req, res) {
    const { _id, title, actorId, rootNode } = req.body;
    
    try {
        // Validate basic fields
        if (!title || !actorId || !rootNode || !rootNode.prompt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate the conversation tree structure
        function validateNode(node) {
            if (!node.prompt) {
                throw new Error('Each node must have a prompt');
            }

            // Validate questCompletionEvents if present
            if (node.questCompletionEvents) {
                if (!Array.isArray(node.questCompletionEvents)) {
                    throw new Error('questCompletionEvents must be an array');
                }
            }

            if (node.choices) {
                if (!Array.isArray(node.choices)) {
                    throw new Error('Choices must be an array');
                }

                node.choices.forEach(choice => {
                    if (!choice.text) {
                        throw new Error('Each choice must have text');
                    }
                    if (choice.nextNode) {
                        validateNode(choice.nextNode);
                    }
                });
            }
        }

        // Validate the entire conversation tree
        try {
            validateNode(rootNode);
        } catch (error) {
            return res.status(400).json({ 
                error: 'Invalid conversation structure',
                details: error.message
            });
        }

        let conversation;
        if (_id) {
            // Update existing conversation
            conversation = await Conversation.findById(_id);
            if (!conversation) {
                return res.status(404).json({ error: 'Conversation not found' });
            }

            conversation.title = title;
            conversation.actorId = actorId;
            conversation.rootNode = rootNode;
            await conversation.save();
        } else {
            // Create new conversation
            conversation = new Conversation({
                title,
                actorId,
                rootNode
            });
            await conversation.save();
        }
        
        // Populate references before sending response
        await conversation.populate('actorId');
        await conversation.populate('rootNode.requiredQuestId');
        await conversation.populate('rootNode.activateQuestId');
        
        res.status(_id ? 200 : 201).json(conversation);
    } catch (error) {
        logger.error('Error saving conversation:', error);
        res.status(500).json({ error: 'Error saving conversation', details: error.message });
    }
}

async function getConversationById(req, res) {
    try {
        const conversation = await Conversation.findById(req.params.id)
            .populate('actorId')
            .populate('rootNode.requiredQuestId')
            .populate('rootNode.activateQuestId');
        
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        
        res.json(conversation);
    } catch (error) {
        logger.error('Error fetching conversation:', error);
        res.status(500).json({ error: 'Error fetching conversation' });
    }
}

async function deleteConversation(req, res) {
    try {
        const conversation = await Conversation.findByIdAndDelete(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json({ message: 'Conversation deleted successfully' });
    } catch (error) {
        logger.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Error deleting conversation' });
    }
}

module.exports = {
    getConversations,
    getConversationById,
    createOrUpdateConversation,
    deleteConversation
}; 