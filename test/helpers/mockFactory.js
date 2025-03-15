/**
 * Mock Factory - Helper for creating consistent mocks across tests
 */

const createMockUser = (overrides = {}) => {
    return {
        _id: 'user123',
        avatarName: 'TestUser',
        currentNode: 'oldNode123',
        class: 'class123',
        stats: {
            level: 1,
            experience: 0,
            hitpoints: 30,
            currentHitpoints: 30,
            body: 3,
            reflexes: 3,
            agility: 3,
            charisma: 3,
            tech: 3,
            luck: 3
        },
        moves: ['move1', 'move2'],
        save: jest.fn().mockResolvedValue(true),
        ...overrides
    };
};

const createMockClass = (overrides = {}) => {
    return {
        _id: 'class123',
        name: 'TestClass',
        primaryStat: 'body',
        secondaryStats: ['reflexes', 'agility'],
        baseHitpoints: 20,
        hpPerLevel: 3,
        hpPerBod: 2.5,
        moveGrowth: [
            { level: 1, move: { _id: 'move1', name: 'Move1' } },
            { level: 2, move: { _id: 'move2', name: 'Move2' } }
        ],
        ...overrides
    };
};

const createMockLogger = () => {
    return {
        error: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn()
    };
};

const createMockUserModel = (mockData = {}) => {
    const defaultUser = createMockUser();
    const user = { ...defaultUser, ...mockData };
    
    return {
        findById: jest.fn().mockImplementation((id) => {
            if (id === 'user123') {
                return Promise.resolve({ ...user });
            } else if (id === 'deadUser123') {
                return Promise.resolve({ 
                    ...user, 
                    stats: { ...user.stats, currentHitpoints: 0 } 
                });
            } else if (id === 'nonExistentUser') {
                return Promise.resolve(null);
            }
            return Promise.resolve({ ...user });
        })
    };
};

const createMockClassModel = () => {
    const mockClass = createMockClass();
    
    return {
        findById: jest.fn().mockImplementation((id) => {
            if (id === 'class123') {
                return {
                    populate: jest.fn().mockResolvedValue({ ...mockClass })
                };
            } else if (id === 'nonExistentClass') {
                return {
                    populate: jest.fn().mockResolvedValue(null)
                };
            }
            return {
                populate: jest.fn().mockResolvedValue({ ...mockClass })
            };
        })
    };
};

const createMockStateService = () => {
    return {
        addUserToNode: jest.fn(),
        removeUserFromNode: jest.fn(),
        clearUserCombatState: jest.fn(),
        clearCombatDelay: jest.fn(),
        clearCombatantEffects: jest.fn(),
        getUserCombatState: jest.fn().mockReturnValue(null)
    };
};

const createMockSocketService = () => {
    return {
        subscribeToNodeChat: jest.fn().mockResolvedValue(true),
        unsubscribeFromNodeChat: jest.fn().mockResolvedValue(true),
        emitToUser: jest.fn()
    };
};

const createMockMessageService = () => {
    return {
        sendConsoleResponse: jest.fn(),
        sendSuccessMessage: jest.fn(),
        sendErrorMessage: jest.fn(),
        sendInfoMessage: jest.fn()
    };
};

const createMockMobService = () => {
    return {
        clearUserMob: jest.fn(),
        getUserMob: jest.fn().mockReturnValue(null),
        spawnMob: jest.fn()
    };
};

const createMockDependencies = (overrides = {}) => {
    return {
        User: createMockUserModel(),
        Class: createMockClassModel(),
        Event: {},
        logger: createMockLogger(),
        socketService: createMockSocketService(),
        stateService: createMockStateService(),
        messageService: createMockMessageService(),
        nodeService: {},
        mobService: createMockMobService(),
        eventService: {},
        questService: {},
        publishSystemMessage: jest.fn().mockResolvedValue(true),
        ...overrides
    };
};

module.exports = {
    createMockUser,
    createMockClass,
    createMockLogger,
    createMockUserModel,
    createMockClassModel,
    createMockStateService,
    createMockSocketService,
    createMockMessageService,
    createMockMobService,
    createMockDependencies
}; 