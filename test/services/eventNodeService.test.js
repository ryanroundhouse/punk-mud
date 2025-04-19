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

        it('should not generate IDs as this is now handled by the system', () => {
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

            // The function should still traverse the tree without generating IDs
            eventNodeService.findNodeInEventTree(mockEvent, 'root-id');
            
            // The node should still not have an ID since we no longer generate them
            expect(mockEvent.rootNode.choices[0].nextNode._id).toBeUndefined();
            expect(logger.debug).not.toHaveBeenCalledWith('Generated ID for node without _id', expect.any(Object));
        });

        it('should return null and log warning if node is not found', () => {
            const mockEvent = createMockEvent();

            const result = eventNodeService.findNodeInEventTree(mockEvent, 'non-existent-id');
            
            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith('Node not found in event tree', expect.any(Object));
        });
    });

    describe('ensureNodeHasId', () => {
        // This test section should be removed since the method no longer exists
        it('should be removed - method no longer exists', () => {
            // Placeholder test since the method has been removed
            expect(true).toBe(true);
        });
    });

    describe('validateNodeStructure', () => {
        // Tests for validateNodeStructure are skipped since this method was removed
        it('should be removed - method no longer exists', () => {
            // This test is now a placeholder since the method was removed
            expect(true).toBe(true);
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

        it('should initialize questCompletionEvents arrays on all choices without copying them', () => {
            // Create a node with 3 choices where only the first one has quest completion events
            const node = createMockNode({
                withQuestCompletionEvents: true,
                choiceCount: 3
            });
            
            // Make the last choice an Exit option
            node.choices[2].text = "Exit";
            
            // Remove questCompletionEvents property from the non-first choices
            delete node.choices[1].nextNode.questCompletionEvents;
            delete node.choices[2].nextNode.questCompletionEvents;
            
            const referenceEvents = node.choices[0].nextNode.questCompletionEvents;
            
            const result = eventNodeService.ensureConsistentQuestEvents(node);
            
            // The original reference events should not be modified
            expect(node.choices[0].nextNode.questCompletionEvents).toEqual(referenceEvents);
            
            // The current implementation initializes empty arrays but doesn't copy events
            expect(node.choices[1].nextNode.questCompletionEvents).toEqual([]);
            expect(node.choices[2].nextNode.questCompletionEvents).toEqual([]);
            
            // Ensure we got the same node back
            expect(result).toBe(node);
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
            ensureQuestEventsSpy = jest.spyOn(eventNodeService, 'ensureConsistentQuestEvents');
            
            // Setup return values
            findNodeSpy.mockReturnValue(mockNode);
            ensureQuestEventsSpy.mockImplementation(node => node);
        });

        afterEach(() => {
            // Restore spies
            findNodeSpy.mockRestore();
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
        });

        it('should ensure consistent quest events for found node', async () => {
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBe(mockNode);
            expect(findNodeSpy).toHaveBeenCalledWith(mockEvent, 'node-id');
            expect(ensureQuestEventsSpy).toHaveBeenCalledWith(mockNode);
        });

        it('should handle errors and return null', async () => {
            findNodeSpy.mockImplementation(() => {
                throw new Error('Test error');
            });
            
            const result = await eventNodeService.loadNodeFromDatabase('event-id', 'node-id');
            
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith('Error loading node from database:', expect.any(Object));
        });
    });
}); 