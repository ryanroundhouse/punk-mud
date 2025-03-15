# Unit Tests for Punk MUD

This directory contains unit tests for the Punk MUD codebase.

## Running Tests

To run all tests:

```bash
npm test
```

To run tests for a specific file or directory:

```bash
npm test -- test/services/userService.test.js
```

To run tests with coverage:

```bash
npm test -- --coverage
```

## Test Structure

The test directory structure mirrors the src directory structure:

- `test/services/` - Tests for service classes
- `test/models/` - Tests for data models
- `test/controllers/` - Tests for API controllers
- `test/middlewares/` - Tests for middleware functions

## Writing Tests

Each test file should follow these principles:

1. **Isolation**: Mock all external dependencies
2. **Clarity**: Clear test descriptions and assertions
3. **Coverage**: Test both success and failure paths
4. **Independence**: Tests should not depend on the state from other tests

## Mocking Dependencies

The services are designed with dependency injection to facilitate testing. For example:

```javascript
// Create service with mocked dependencies
const userService = new UserService({
  User: mockUserModel,
  logger: mockLogger,
  // ... other dependencies
});
```

This allows us to test service methods in isolation without hitting the database or other external services. 