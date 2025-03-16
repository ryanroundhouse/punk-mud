/**
 * Test helpers for EventNodeService tests
 */

const mongoose = require('mongoose');

/**
 * Creates a mock event with a simple structure for testing
 * 
 * @param {Object} options - Customization options
 * @returns {Object} - A mock event object
 */
function createMockEvent(options = {}) {
    const defaults = {
        _id: 'test-event-id',
        title: 'Test Event',
        actorId: 'test-actor-id',
        requiresEnergy: true
    };

    const config = { ...defaults, ...options };

    return {
        _id: config._id,
        title: config.title,
        actorId: config.actorId,
        requiresEnergy: config.requiresEnergy,
        rootNode: createMockNode({
            _id: `${config._id}-root`,
            prompt: 'Root prompt'
        })
    };
}

/**
 * Creates a mock event node for testing
 * 
 * @param {Object} options - Customization options
 * @returns {Object} - A mock node object
 */
function createMockNode(options = {}) {
    const defaults = {
        _id: `node-${Date.now()}`,
        prompt: 'Test node prompt',
        hasChoices: true,
        choiceCount: 2,
        withQuestCompletionEvents: false
    };

    const config = { ...defaults, ...options };
    const node = {
        _id: config._id,
        prompt: config.prompt
    };

    if (config.choices) {
        node.choices = config.choices;
    } else if (config.hasChoices) {
        node.choices = [];
        for (let i = 0; i < config.choiceCount; i++) {
            node.choices.push(createMockChoice({
                text: `Choice ${i + 1}`,
                withQuestCompletionEvents: i === 0 && config.withQuestCompletionEvents
            }));
        }
    }

    if (config.restrictions) {
        node.restrictions = config.restrictions;
    }

    if (config.activateQuestId) {
        node.activateQuestId = config.activateQuestId;
    }

    if (config.questCompletionEvents) {
        node.questCompletionEvents = config.questCompletionEvents;
    }

    return node;
}

/**
 * Creates a mock choice for testing
 * 
 * @param {Object} options - Customization options
 * @returns {Object} - A mock choice object
 */
function createMockChoice(options = {}) {
    const defaults = {
        text: 'Test choice',
        hasNextNode: true,
        withQuestCompletionEvents: false
    };

    const config = { ...defaults, ...options };
    const choice = {
        text: config.text
    };

    if (config.mobId) {
        choice.mobId = config.mobId;
    }

    if (config.teleportToNode) {
        choice.teleportToNode = config.teleportToNode;
    }

    if (config.skillCheckStat) {
        choice.skillCheckStat = config.skillCheckStat;
        choice.skillCheckTargetNumber = config.skillCheckTargetNumber || 10;
        
        if (config.failureNode) {
            choice.failureNode = config.failureNode;
        }
    }

    if (config.hasNextNode) {
        choice.nextNode = createMockNode({
            _id: `next-node-${Date.now()}`,
            prompt: `Next node for ${config.text}`,
            hasChoices: config.nextNodeHasChoices || false
        });

        if (config.withQuestCompletionEvents) {
            choice.nextNode.questCompletionEvents = [
                { type: 'COMPLETE_OBJECTIVE', objectiveId: 'obj1' },
                { type: 'GIVE_ITEM', itemId: 'item1' }
            ];
        }

        if (config.nextNodeActivateQuestId) {
            choice.nextNode.activateQuestId = config.nextNodeActivateQuestId;
        }
    }

    return choice;
}

/**
 * Creates a complex event tree for testing traversal
 * 
 * @returns {Object} - A complex event object
 */
function createComplexEventTree() {
    // Create a deeper event tree for more complex testing
    const targetNode = {
        _id: 'target-node-id',
        prompt: 'Target node',
        choices: []
    };

    const alternativeNode = {
        _id: 'alternative-node-id',
        prompt: 'Alternative node',
        choices: []
    };

    const event = {
        _id: 'complex-event-id',
        title: 'Complex Test Event',
        rootNode: {
            _id: 'root-node-id',
            prompt: 'Root node',
            choices: [
                {
                    text: 'First choice',
                    nextNode: {
                        _id: 'level1-node1-id',
                        prompt: 'Level 1 Node 1',
                        choices: [
                            {
                                text: 'Go to target',
                                nextNode: targetNode
                            },
                            {
                                text: 'Go to alternative',
                                nextNode: alternativeNode
                            }
                        ]
                    }
                },
                {
                    text: 'Second choice',
                    nextNode: {
                        _id: 'level1-node2-id',
                        prompt: 'Level 1 Node 2',
                        choices: [
                            {
                                text: 'No next node',
                                // Intentionally omitting nextNode
                            }
                        ]
                    }
                }
            ]
        }
    };

    return {
        event,
        targetNode,
        alternativeNode
    };
}

/**
 * Creates a test ObjectId for a specific string
 * 
 * @param {String} id - String to base the ObjectId on
 * @returns {ObjectId} - A mongoose ObjectId
 */
function createTestObjectId(id = '5f7e1b94e6e8c00674a55555') {
    // If mongoose is mocked, we need to handle it properly
    try {
        // Try to create an actual ObjectId
        const objectId = new mongoose.Types.ObjectId(id);
        return objectId;
    } catch (error) {
        // If that fails (likely due to mocking), return a mock ObjectId object
        return {
            _id: id,
            toString: function() { return id; },
            equals: function(other) { 
                return other && other.toString() === id;
            }
        };
    }
}

module.exports = {
    createMockEvent,
    createMockNode,
    createMockChoice,
    createComplexEventTree,
    createTestObjectId
}; 