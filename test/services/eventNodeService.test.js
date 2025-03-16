const mongoose = require('mongoose');

// Import test helpers
const {
    createMockEvent,
    createMockNode,
    createMockChoice,
    createComplexEventTree,
    createTestObjectId
} = require('../helpers/eventNodeTestHelpers');

// Mock the logger - properly with Jest hoisting in mind
jest.mock('../../src/config/logger', () => ({
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
}));

// Mock the mongoose module
jest.mock('mongoose', () => {
    const originalModule = jest.requireActual('mongoose');
    return {
        ...originalModule,
        model: jest.fn()
    };
});

// Import the logger after mocking
const logger = require('../../src/config/logger');

// Now import the module under test
const eventNodeService = require('../../src/services/eventNodeService');

describe('EventNodeService', () => {
    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    describe('findNodeInEventTree', () => {
        it('should return rootNode if nodeId is not provided', () => {
            const mockEvent = createMockEvent();

            const result = eventNodeService.findNodeInEventTree(mockEvent, null);
            
            expect(result).toBe(mockEvent.rootNode);
        });

        it('should find a node by its ID', () => {
            const { event, targetNode } = createComplexEventTree();

            const result = eventNodeService.findNodeInEventTree(event, 'target-node-id');
            
            expect(result).toBe(targetNode);
            expect(logger.debug).toHaveBeenCalledWith('Found node in event tree', expect.objectContaining({ nodeId: 'target-node-id' }));
        });

        it('should handle different ID formats (ObjectId, string, etc.)', () => {
            const targetNodeId = createTestObjectId();
            
            const targetNode = { 
                _id: targetNodeId, 
                prompt: 'Target node with ObjectId',
                choices: []
            };
            
            const mockEvent = createMockEvent({
                rootNode: createMockNode({
                    choices: [
                        createMockChoice({
                            text: 'Choice to node with ObjectId',
                            hasNextNode: false
                        })
                    ]
                })
            });

            // Manually set the nextNode to use our ObjectId node
            mockEvent.rootNode.choices[0].nextNode = targetNode;

            // Test with the actual ObjectId
            const result1 = eventNodeService.findNodeInEventTree(mockEvent, targetNodeId);
            expect(result1).toBe(targetNode);
            
            // Test with the string representation
            const result2 = eventNodeService.findNodeInEventTree(mockEvent, targetNodeId.toString());
            expect(result2).toBe(targetNode);
        });

        it('should generate IDs for nodes without them', () => {
            const mockEvent = createMockEvent({
                rootNode: createMockNode({
                    _id: 'root-id',
                    choices: [
                        createMockChoice({
                            text: 'Choice with node missing ID'
                        })
                    ]
                })
            });

            // Remove the ID from the next node
            delete mockEvent.rootNode.choices[0].nextNode._id;

            // The function doesn't return the node it adds IDs to,
            // so we can just verify the next node now has an ID
            eventNodeService.findNodeInEventTree(mockEvent, 'root-id');
            
            expect(mockEvent.rootNode.choices[0].nextNode._id).toBeDefined();
            expect(logger.debug).toHaveBeenCalledWith('Generated ID for node without _id', expect.any(Object));
        });

        it('should return null and log warning if node is not found', () => {
            const mockEvent = createMockEvent();

            const result = eventNodeService.findNodeInEventTree(mockEvent, 'non-existent-id');
            
            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith('Node not found in event tree', expect.any(Object));
        });
    });

    describe('ensureNodeHasId', () => {
        it('should not modify a node that already has an ID', () => {
            const existingId = 'existing-id';
            const node = createMockNode({ _id: existingId });
            
            const result = eventNodeService.ensureNodeHasId(node);
            
            expect(result).toBe(existingId);
            expect(node._id).toBe(existingId);
        });

        it('should generate a new ID for a node without one', () => {
            const node = createMockNode();
            delete node._id;
            
            const result = eventNodeService.ensureNodeHasId(node);
            
            expect(node._id).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result).toContain('generated_');
            expect(logger.debug).toHaveBeenCalledWith('Generated ID for node', expect.any(Object));
        });

        it('should incorporate path information in generated ID when provided', () => {
            const node = createMockNode();
            delete node._id;
            const path = 'root.choices[0].nextNode';
            
            eventNodeService.ensureNodeHasId(node, path);
            
            expect(node._id).toContain('_root_choices[0]_nextNode_');
        });
    });

    describe('validateNodeStructure', () => {
        it('should return null for null or undefined nodes', () => {
            expect(eventNodeService.validateNodeStructure(null)).toBeNull();
            expect(eventNodeService.validateNodeStructure(undefined)).toBeNull();
            expect(logger.error).toHaveBeenCalledWith('Node is null or undefined');
        });

        it('should ensure node has an ID', () => {
            const node = createMockNode();
            delete node._id;
            
            const result = eventNodeService.validateNodeStructure(node);
            
            expect(result._id).toBeDefined();
        });

        it('should initialize empty choices array if undefined', () => {
            const node = createMockNode({ hasChoices: false });
            delete node.choices;
            
            const result = eventNodeService.validateNodeStructure(node);
            
            expect(Array.isArray(result.choices)).toBe(true);
            expect(result.choices.length).toBe(0);
            expect(logger.debug).toHaveBeenCalledWith('Initialized empty choices array for node');
        });

        it('should not modify existing choices array', () => {
            const node = createMockNode();
            const originalChoices = node.choices;
            
            const result = eventNodeService.validateNodeStructure(node);
            
            expect(result.choices).toBe(originalChoices);
        });
    });

    describe('ensureConsistentQuestEvents', () => {
        it('should return the node unchanged if it has no choices', () => {
            const node = createMockNode({ hasChoices: false });
            
            const result = eventNodeService.ensureConsistentQuestEvents(node);
            
            expect(result).toBe(node);
        });

        it('should return the node unchanged if choices array is empty', () => {
            const node = createMockNode({ choices: [] });
            
            const result = eventNodeService.ensureConsistentQuestEvents(node);
            
            expect(result).toBe(node);
            expect(result.choices).toEqual([]);
        });

        it('should copy quest completion events to choices missing them', () => {
            // Create a node with 3 choices where only the first one has quest completion events
            const node = createMockNode({
                withQuestCompletionEvents: true,
                choiceCount: 3
            });
            
            const referenceEvents = node.choices[0].nextNode.questCompletionEvents;
            
            const result = eventNodeService.ensureConsistentQuestEvents(node);
            
            // The original reference events should not be modified
            expect(node.choices[0].nextNode.questCompletionEvents).toEqual(referenceEvents);
            
            // The events should be copied to other nodes
            expect(node.choices[1].nextNode.questCompletionEvents).toEqual(referenceEvents);
            expect(node.choices[2].nextNode.questCompletionEvents).toEqual(referenceEvents);
            
            // The events should be deep copies, not references
            expect(node.choices[1].nextNode.questCompletionEvents).not.toBe(referenceEvents);
            
            // The function should log what it did
            expect(logger.debug).toHaveBeenCalledWith('Fixed questCompletionEvents for 2 choices', expect.any(Object));
        });

        it('should do nothing if no choices have quest completion events', () => {
            const node = createMockNode({
                choiceCount: 2,
                withQuestCompletionEvents: false
            });
            
            // Make sure no choice has quest completion events
            node.choices.forEach(choice => {
                if (choice.nextNode && choice.nextNode.questCompletionEvents) {
                    delete choice.nextNode.questCompletionEvents;
                }
            });
            
            // Add empty array to the second choice
            if (node.choices[1].nextNode) {
                node.choices[1].nextNode.questCompletionEvents = [];
            }
            
            const result = eventNodeService.ensureConsistentQuestEvents(node);
            
            expect(result).toBe(node);
            expect(node.choices[0].nextNode.questCompletionEvents).toBeUndefined();
            expect(node.choices[1].nextNode.questCompletionEvents).toEqual([]);
        });
    });

    describe('cloneNode', () => {
        it('should create a deep copy of a node', () => {
            const originalNode = createMockNode({
                withQuestCompletionEvents: true,
                choiceCount: 1
            });
            
            const clonedNode = eventNodeService.cloneNode(originalNode);
            
            // Should be equal in content
            expect(clonedNode).toEqual(originalNode);
            
            // But not the same object references
            expect(clonedNode).not.toBe(originalNode);
            expect(clonedNode.choices).not.toBe(originalNode.choices);
            expect(clonedNode.choices[0]).not.toBe(originalNode.choices[0]);
            expect(clonedNode.choices[0].nextNode).not.toBe(originalNode.choices[0].nextNode);
            expect(clonedNode.choices[0].nextNode.questCompletionEvents).not.toBe(originalNode.choices[0].nextNode.questCompletionEvents);
            
            // Modifying the clone should not affect the original
            clonedNode.prompt = 'Modified prompt';
            clonedNode.choices[0].text = 'Modified choice';
            
            expect(originalNode.prompt).not.toBe('Modified prompt');
            expect(originalNode.choices[0].text).not.toBe('Modified choice');
        });
    });

    describe('loadNodeFromDatabase', () => {
        let mockEvent;
        let mockNode;
        let findByIdMock;
        let leanMock;
        let findNodeSpy;
        let validateNodeSpy;
        let ensureQuestEventsSpy;

        beforeEach(() => {
            // Setup mock event and node
            mockEvent = createMockEvent();
            mockNode = createMockNode({ _id: 'node-id' });
            
            // Setup mongoose mocks
            findByIdMock = jest.fn();
            leanMock = jest.fn();
            
            findByIdMock.mockReturnValue({ lean: leanMock });
            leanMock.mockResolvedValue(mockEvent);
            
            mongoose.model.mockReturnValue({
                findById: findByIdMock
            });
            
            // Spy on internal methods
            findNodeSpy = jest.spyOn(eventNodeService, 'findNodeInEventTree');
            validateNodeSpy = jest.spyOn(eventNodeService, 'validateNodeStructure');
            ensureQuestEventsSpy = jest.spyOn(eventNodeService, 'ensureConsistentQuestEvents');
            
            // Setup return values
            findNodeSpy.mockReturnValue(mockNode);
            validateNodeSpy.mockImplementation(node => node);
            ensureQuestEventsSpy.mockImplementation(node => node);
        });

        afterEach(() => {
            // Restore spies
            findNodeSpy.mockRestore();
            validateNodeSpy.mockRestore();
            ensureQuestEventsSpy.mockRestore();
        });

        it('should return null if event is not found', async () => {
            leanMock.mockResolvedValue(null);
            
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith('Event not found in database:', expect.any(Object));
        });

        it('should return null if node is not found in event tree', async () => {
            findNodeSpy.mockReturnValue(null);
            
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBeNull();
            expect(findNodeSpy).toHaveBeenCalledWith(mockEvent, 'node-id');
            expect(logger.error).toHaveBeenCalledWith('Node not found in event tree:', expect.any(Object));
        });

        it('should validate and ensure consistent quest events for found node', async () => {
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBe(mockNode);
            expect(mongoose.model).toHaveBeenCalledWith('Event');
            expect(findByIdMock).toHaveBeenCalledWith('event-id');
            expect(leanMock).toHaveBeenCalled();
            expect(findNodeSpy).toHaveBeenCalledWith(mockEvent, 'node-id');
            expect(validateNodeSpy).toHaveBeenCalledWith(mockNode);
            expect(ensureQuestEventsSpy).toHaveBeenCalledWith(mockNode);
        });

        it('should handle errors and return null', async () => {
            const error = new Error('Test error');
            leanMock.mockRejectedValue(error);
            
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith('Error loading node from database:', expect.objectContaining({ error: error.message }));
        });
    });
}); 