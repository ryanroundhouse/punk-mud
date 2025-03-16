const mockActor = {
    find: jest.fn(),
    findById: jest.fn()
};

const mockUser = {
    findById: jest.fn()
};

module.exports = {
    Actor: mockActor,
    User: mockUser
}; 