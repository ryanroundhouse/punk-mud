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
            
            logger.debug('Starting conversation:', {
                userId,
                conversationId: conversation._id,
                hasActivateQuest: !!rootNode.activateQuestId,
                activateQuestId: rootNode.activateQuestId?._id?.toString()
            });

            // Store conversation state using stateService
            stateService.setActiveConversation(
                userId, 
                conversation._id, 
                rootNode,
                conversation.actorId
            );

            // Handle quest activation if specified
            if (rootNode.activateQuestId) {
                // Get the user object first
                const user = await User.findById(userId);
                if (!user) {
                    logger.error('User not found when starting conversation:', { userId });
                    return null;
                }
                
                logger.debug('Activating quest from conversation:', {
                    userId: user._id.toString(),
                    questId: rootNode.activateQuestId._id.toString(),
                    questTitle: rootNode.activateQuestId.title
                });

                // Pass the correct parameters
                await questService.handleQuestProgression(
                    user,
                    conversation.actorId,
                    [],  // No completion events
                    rootNode.activateQuestId._id  // Pass the actual quest ID
                );
            }

            // Handle quest completion events
            if (rootNode.questCompletionEvents?.length > 0) {
                // Implement quest completion logic here
                // This would need to be coordinated with questService
            }

            // Pass userId to formatConversationResponse
            return await this.formatConversationResponse(rootNode, userId);
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
                activeConv: {
                    conversationId: activeConv.conversationId,
                    hasCurrentNode: !!activeConv.currentNode,
                    actorId: activeConv.actorId,
                    isStoryEvent: activeConv.isStoryEvent
                }
            });

            const currentNode = activeConv.currentNode;

            // If no choices available, end conversation and allow new one to start
            if (!currentNode.choices || currentNode.choices.length === 0) {
                logger.debug('No choices available, ending conversation', {
                    userId,
                    isStoryEvent: activeConv.isStoryEvent
                });
                stateService.clearActiveConversation(userId);
                return null;
            }

            // If we get a non-numeric input in a conversation with choices, 
            // return an error message instead of clearing the conversation
            if (isNaN(parseInt(choice)) && currentNode.choices.length > 0) {
                logger.debug('Non-numeric input received, prompting for valid choice', {
                    userId,
                    input: choice,
                    isStoryEvent: activeConv.isStoryEvent
                });
                return {
                    error: true,
                    message: `Please enter a number between 1 and ${currentNode.choices.length} to choose your response.`
                };
            }

            // Get user data to check quests
            let user = await User.findById(userId);
            
            // Filter choices first
            const validChoices = currentNode.choices
                .map((choice, index) => ({ choice, originalIndex: index }))
                .filter(({ choice }) => {
                    // Check quest activation restriction
                    if (choice.nextNode?.activateQuestId) {
                        const hasQuest = user.quests?.some(userQuest => 
                            userQuest.questId.toString() === choice.nextNode.activateQuestId.toString()
                        );
                        if (hasQuest) return false;
                    }

                    // Check node restrictions
                    if (choice.nextNode?.restrictions?.length > 0) {
                        for (const restriction of choice.nextNode.restrictions) {
                            // 'noClass' restriction - only show if user has no class
                            if (restriction === 'noClass' && user.class) {
                                return false;
                            }
                            // 'enforcerOnly' restriction - only show if user is enforcer class
                            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                                return false;
                            }
                        }
                    }

                    return true;
                });

            logger.debug('Filtered choices:', {
                userId,
                totalChoices: currentNode.choices.length,
                validChoices: validChoices.length,
                isStoryEvent: activeConv.isStoryEvent
            });

            // End conversation if no valid choices remain
            if (validChoices.length === 0) {
                logger.debug('No valid choices available after filtering, ending conversation', {
                    userId,
                    isStoryEvent: activeConv.isStoryEvent
                });
                stateService.clearActiveConversation(userId);
                return null;
            }

            // Now validate the choice against valid choices
            const selectedIndex = parseInt(choice) - 1;
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= validChoices.length) {
                logger.debug('Invalid choice provided', {
                    userId,
                    choice,
                    validChoiceRange: `1-${validChoices.length}`,
                    isStoryEvent: activeConv.isStoryEvent
                });
                return {
                    error: true,
                    message: `Invalid choice. Please choose 1-${validChoices.length}.`
                };
            }

            const selectedChoice = validChoices[selectedIndex].choice;
            
            logger.debug('Selected choice:', {
                userId,
                text: selectedChoice.text,
                hasNextNode: !!selectedChoice.nextNode,
                hasActivateQuest: !!selectedChoice.nextNode?.activateQuestId,
                hasQuestCompletionEvents: !!selectedChoice.nextNode?.questCompletionEvents?.length,
                isStoryEvent: activeConv.isStoryEvent
            });

            // Process quest completion events BEFORE updating state or ending conversation
            if (selectedChoice.nextNode?.questCompletionEvents?.length > 0) {
                logger.debug('Processing quest completion events:', {
                    events: selectedChoice.nextNode.questCompletionEvents,
                    userId: user._id.toString(),
                    isStoryEvent: activeConv.isStoryEvent
                });

                const result = await questService.handleQuestProgression(
                    user,
                    activeConv.actorId,
                    selectedChoice.nextNode.questCompletionEvents
                );

                // Refresh user after quest progression
                user = await User.findById(userId);
                
                logger.debug('Quest completion result:', { result });
            }

            // Handle quest activation if specified in the choice's next node
            if (selectedChoice.nextNode?.activateQuestId) {
                if (!user) {
                    logger.error('User not found for quest activation:', { userId });
                    return null;
                }

                await questService.handleQuestProgression(
                    user,
                    activeConv.actorId,
                    [],  // No completion events
                    selectedChoice.nextNode.activateQuestId // Pass the quest to activate
                );
            }

            if (!selectedChoice.nextNode) {
                logger.debug('End of conversation branch reached', {
                    userId,
                    isStoryEvent: activeConv.isStoryEvent
                });
                stateService.clearActiveConversation(userId);
                return {
                    message: selectedChoice.text,
                    isEnd: true
                };
            }

            // Update conversation state
            logger.debug('Updating conversation state with next node', {
                userId,
                isStoryEvent: activeConv.isStoryEvent,
                nextNodePrompt: selectedChoice.nextNode.prompt,
                nextNodeChoices: selectedChoice.nextNode.choices?.length || 0
            });

            stateService.setActiveConversation(
                userId, 
                activeConv.conversationId, 
                selectedChoice.nextNode,
                activeConv.actorId,
                activeConv.isStoryEvent
            );

            // Return the formatted response
            const response = await this.formatConversationResponse(selectedChoice.nextNode, userId);
            logger.debug('Formatted response:', {
                userId,
                message: response.message,
                hasChoices: response.hasChoices,
                isEnd: response.isEnd,
                isStoryEvent: activeConv.isStoryEvent
            });

            // Clear conversation state if there are no more choices
            if (!response.hasChoices) {
                logger.debug('No more choices available, ending conversation', {
                    userId,
                    isStoryEvent: activeConv.isStoryEvent
                });
                stateService.clearActiveConversation(userId);
            }

            return {
                message: response.message,
                hasChoices: response.hasChoices,
                isEnd: response.isEnd,
                error: false
            };
        } catch (error) {
            logger.error('Error in handleConversationChoice:', error);
            return null;
        }
    }

    async formatConversationResponse(node, userId) {
        let response = node.prompt + '\n\n';
        
        if (node.choices && node.choices.length > 0) {
            // Get user data to check quests and class
            const user = await User.findById(userId);
            
            // Filter choices based on restrictions and quests
            const validChoices = node.choices
                .map((choice, index) => ({ choice, originalIndex: index }))
                .filter(({ choice }) => {
                    // Check quest activation restriction
                    if (choice.nextNode?.activateQuestId) {
                        const hasQuest = user.quests?.some(userQuest => 
                            userQuest.questId.toString() === choice.nextNode.activateQuestId.toString()
                        );
                        if (hasQuest) return false;
                    }

                    // Check node restrictions
                    if (choice.nextNode?.restrictions?.length > 0) {
                        for (const restriction of choice.nextNode.restrictions) {
                            // 'noClass' restriction - only show if user has no class
                            if (restriction === 'noClass' && user.class) {
                                return false;
                            }
                            // 'enforcerOnly' restriction - only show if user is enforcer class
                            if (restriction === 'enforcerOnly' && (!user.class || user.class.name !== 'Enforcer')) {
                                return false;
                            }
                        }
                    }

                    return true;
                });

            if (validChoices.length > 0) {
                response += 'Responses:\n';
                validChoices.forEach(({ choice }, index) => {
                    response += `${index + 1}. ${choice.text}\n`;
                });
            }

            return {
                message: response.trim(),
                hasChoices: validChoices.length > 0,
                isEnd: validChoices.length === 0
            };
        }

        return {
            message: response.trim(),
            hasChoices: false,
            isEnd: true
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