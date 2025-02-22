const logger = require('../config/logger');
const Conversation = require('../models/Conversation');
const stateService = require('./stateService');
const messageService = require('./messageService');
const questService = require('./questService');
const User = require('../models/User');

class ConversationService {
    async handleActorChat(user, actor) {
        try {
            logger.debug('handleActorChat called:', {
                userId: user._id.toString(),
                actorId: actor._id,
                actorName: actor.name
            });

            // Check if user is already in a conversation
            const activeConv = stateService.getActiveConversation(user._id.toString());
            logger.debug('Active conversation state:', {
                exists: !!activeConv,
                activeConv
            });

            if (activeConv) {
                logger.debug('Processing existing conversation');
                const result = await this.handleConversationChoice(user._id.toString(), activeConv, null);
                logger.debug('Conversation choice result:', { result });
                
                if (!result) {
                    logger.debug('Clearing conversation state due to null result');
                    stateService.clearActiveConversation(user._id.toString());
                }
                return result;
            }

            // Find conversations for this actor
            const conversations = await Conversation.find({ actorId: actor._id })
                .populate('rootNode.requiredQuestId')
                .populate('rootNode.activateQuestId');

            logger.debug('Found conversations for actor:', {
                count: conversations.length,
                conversations: conversations.map(c => ({
                    id: c._id,
                    title: c.title,
                    hasRequiredQuest: !!c.rootNode.requiredQuestId
                }))
            });

            // Filter conversations by quest requirements
            const availableConversations = conversations.filter(conv => {
                if (!conv.rootNode.requiredQuestId) return true;
                
                // Check if user has the required quest active
                const hasRequiredQuest = user.quests?.some(userQuest => 
                    userQuest.questId === conv.rootNode.requiredQuestId._id.toString() &&
                    !userQuest.completed
                );

                logger.debug('Quest requirement check:', {
                    conversationId: conv._id,
                    requiredQuestId: conv.rootNode.requiredQuestId._id,
                    hasRequiredQuest
                });

                return hasRequiredQuest;
            });

            logger.debug('Available conversations after filtering:', {
                count: availableConversations.length
            });

            if (availableConversations.length === 0) {
                logger.debug('No available conversations found');
                return null;
            }

            // Start the first available conversation
            const conversation = availableConversations[0];
            logger.debug('Starting new conversation:', {
                conversationId: conversation._id,
                title: conversation.title
            });

            return this.startConversation(user._id.toString(), conversation);
        } catch (error) {
            logger.error('Error handling actor chat:', error);
            return null;
        }
    }

    async startConversation(userId, conversation) {
        try {
            const rootNode = conversation.rootNode;
            
            // Store conversation state using stateService
            stateService.setActiveConversation(
                userId, 
                conversation._id, 
                rootNode,
                conversation.actorId
            );

            // Handle quest activation if specified
            if (rootNode.activateQuestId) {
                await questService.handleQuestProgression(userId, rootNode.activateQuestId);
            }

            // Handle quest completion events
            if (rootNode.questCompletionEvents?.length > 0) {
                // Implement quest completion logic here
                // This would need to be coordinated with questService
            }

            // Format and send the conversation prompt
            return this.formatConversationResponse(rootNode);
        } catch (error) {
            logger.error('Error starting conversation:', error);
            return null;
        }
    }

    async handleConversationChoice(userId, activeConv, choice) {
        try {
            logger.debug('handleConversationChoice called:', {
                userId,
                choice,
                activeConv
            });

            const currentNode = activeConv.currentNode;

            // If no choices available, end conversation and allow new one to start
            if (!currentNode.choices || currentNode.choices.length === 0) {
                logger.debug('No choices available, ending conversation');
                stateService.clearActiveConversation(userId);
                return null;
            }

            // If we get a non-numeric input in a conversation with choices, 
            // clear the conversation and return null to allow a new one to start
            if (isNaN(parseInt(choice)) && currentNode.choices.length > 0) {
                logger.debug('Non-numeric input received, ending conversation');
                stateService.clearActiveConversation(userId);
                return null;
            }

            // Validate choice
            const choiceIndex = parseInt(choice) - 1;
            logger.debug('Processing choice:', {
                rawChoice: choice,
                parsedIndex: choiceIndex,
                validRange: `0-${currentNode.choices.length - 1}`
            });

            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= currentNode.choices.length) {
                logger.debug('Invalid choice provided');
                return {
                    error: true,
                    message: `Invalid choice. Please choose 1-${currentNode.choices.length}.`
                };
            }

            const selectedChoice = currentNode.choices[choiceIndex];
            logger.debug('Selected choice:', {
                text: selectedChoice.text,
                hasNextNode: !!selectedChoice.nextNode
            });

            if (!selectedChoice.nextNode) {
                logger.debug('End of conversation branch reached');
                stateService.clearActiveConversation(userId);
                return {
                    message: selectedChoice.text,
                    isEnd: true
                };
            }

            // Update conversation state
            logger.debug('Updating conversation state with next node');
            stateService.setActiveConversation(
                userId, 
                activeConv.conversationId, 
                selectedChoice.nextNode,
                activeConv.actorId
            );

            // Handle quest activation if specified
            if (selectedChoice.nextNode.activateQuestId) {
                await questService.handleQuestProgression(userId, selectedChoice.nextNode.activateQuestId);
            }

            // Handle quest completion events
            if (selectedChoice.nextNode.questCompletionEvents?.length > 0) {
                const user = await User.findById(userId);
                if (user) {
                    logger.debug('Processing conversation quest completion events:', {
                        userId: user._id.toString(),
                        events: selectedChoice.nextNode.questCompletionEvents,
                        userQuests: user.quests.map(q => ({
                            questId: q.questId,
                            currentEventId: q.currentEventId,
                            completed: q.completed
                        }))
                    });
                    
                    const result = await questService.handleQuestProgression(
                        user, 
                        activeConv.actorId,
                        selectedChoice.nextNode.questCompletionEvents
                    );

                    logger.debug('Quest progression result:', {
                        result,
                        conversationId: activeConv.conversationId
                    });
                }
            }

            return this.formatConversationResponse(selectedChoice.nextNode);
        } catch (error) {
            logger.error('Error handling conversation choice:', error);
            return null;
        }
    }

    formatConversationResponse(node) {
        let response = node.prompt + '\n\n';
        
        if (node.choices && node.choices.length > 0) {
            response += 'Responses:\n';
            node.choices.forEach((choice, index) => {
                response += `${index + 1}. ${choice.text}\n`;
            });
        }

        return {
            message: response.trim(),
            hasChoices: node.choices && node.choices.length > 0,
            isEnd: !node.choices || node.choices.length === 0
        };
    }

    isInConversation(userId) {
        return stateService.isInConversation(userId);
    }

    async processConversationInput(userId, input) {
        logger.debug('processConversationInput called:', { userId, input });
        
        const activeConv = stateService.getActiveConversation(userId);
        logger.debug('Active conversation state:', { exists: !!activeConv, activeConv });
        
        if (!activeConv) {
            logger.debug('No active conversation found');
            return null;
        }

        return this.handleConversationChoice(userId, activeConv, input);
    }
}

const conversationService = new ConversationService();
module.exports = conversationService; 