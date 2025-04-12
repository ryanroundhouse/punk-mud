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

const createMockEmailService = (overrides = {}) => {
    return {
        sendAuthCode: jest.fn().mockResolvedValue(true),
        validateConfig: jest.fn().mockReturnValue(true),
        createMailgunClient: jest.fn(),
        createMailOptions: jest.fn(),
        ...overrides
    };
};

const createMockUserModel = (mockData = {}) => {
    const defaultUser = createMockUser();
    const user = { ...defaultUser, ...mockData };
    
    return {
        findById: jest.fn().mockImplementation((id) => {
            if (id === 'user123') {
                return {
                    ...Promise.resolve({ ...user }),
                    populate: jest.fn().mockResolvedValue({ ...user })
                };
            } else if (id === 'deadUser123') {
                return {
                    ...Promise.resolve({ 
                        ...user, 
                        stats: { ...user.stats, currentHitpoints: 0 } 
                    }),
                    populate: jest.fn().mockResolvedValue({ 
                        ...user, 
                        stats: { ...user.stats, currentHitpoints: 0 } 
                    })
                };
            } else if (id === 'nonExistentUser') {
                return Promise.resolve(null);
            }
            return {
                ...Promise.resolve({ ...user }),
                populate: jest.fn().mockResolvedValue({ ...user })
            };
        }),
        findByIdAndUpdate: jest.fn().mockImplementation((id, update, options) => {
            if (id === 'user123') {
                const updatedUser = { ...user };
                if (update.stats) {
                    updatedUser.stats = { ...updatedUser.stats, ...update.stats };
                }
                if (update.currentNode) {
                    updatedUser.currentNode = update.currentNode;
                }
                return Promise.resolve(updatedUser);
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
        addClient: jest.fn(),
        removeClient: jest.fn(),
        addUserToNode: jest.fn(),
        removeUserFromNode: jest.fn(),
        getUsersInNode: jest.fn(),
        updateNodeUsernames: jest.fn(),
        setUserCombatState: jest.fn(),
        getUserCombatState: jest.fn(),
        clearUserCombatState: jest.fn(),
        isUserInCombat: jest.fn(),
        addCombatantEffect: jest.fn(),
        getCombatantEffects: jest.fn(),
        updateCombatantEffects: jest.fn(),
        clearCombatantEffects: jest.fn(),
        setCombatDelay: jest.fn(),
        getCombatDelay: jest.fn(),
        clearCombatDelay: jest.fn(),
        processDelays: jest.fn(),
        setPlayerMob: jest.fn(),
        getPlayerMob: jest.fn(),
        clearPlayerMob: jest.fn(),
        hasPlayerMob: jest.fn(),
        setActiveEvent: jest.fn(),
        getActiveEvent: jest.fn(),
        clearActiveEvent: jest.fn(),
        isInEvent: jest.fn(),
        addUserToNodeAndUpdateUsernames: jest.fn(),
        removeUserFromNodeAndUpdateUsernames: jest.fn()
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
        sendInfoMessage: jest.fn(),
        sendPlayerStatusMessage: jest.fn()
    };
};

const createMockMobService = () => {
    return {
        clearUserMob: jest.fn(),
        getUserMob: jest.fn().mockReturnValue(null),
        spawnMob: jest.fn()
    };
};

const createMockActor = (overrides = {}) => {
    return {
        _id: 'actor123',
        name: 'Test Actor',
        description: 'A test actor for unit tests',
        location: 'location123',
        image: 'actor.png',
        chatMessages: [
            { message: 'Hello 1', order: 2 },
            { message: 'Hello 3', order: 3 },
            { message: 'Hello 2', order: 1 }
        ],
        save: jest.fn().mockResolvedValue(true),
        ...overrides
    };
};

const createMockDependencies = (overrides = {}) => {
    return {
        User: createMockUserModel(),
        Class: createMockClassModel(),
        Actor: {
            find: jest.fn(),
            findById: jest.fn()
        },
        Event: {},
        logger: createMockLogger(),
        socketService: createMockSocketService(),
        stateService: createMockStateService(),
        messageService: createMockMessageService(),
        nodeService: {},
        mobService: createMockMobService(),
        eventService: {},
        questService: {
            getQuestNodeActorOverrides: jest.fn(),
            handleQuestProgression: jest.fn()
        },
        publishSystemMessage: jest.fn().mockResolvedValue(true),
        emailService: createMockEmailService(),
        ...overrides
    };
};

module.exports = {
    createMockUser,
    createMockClass,
    createMockLogger,
    createMockEmailService,
    createMockUserModel,
    createMockClassModel,
    createMockStateService,
    createMockSocketService,
    createMockMessageService,
    createMockMobService,
    createMockActor,
    createMockDependencies
}; 