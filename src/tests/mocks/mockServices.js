const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
};

const mockQuestService = {
    getQuestNodeActorOverrides: jest.fn(),
    handleQuestProgression: jest.fn()
};

module.exports = {
    logger: mockLogger,
    questService: mockQuestService
}; 