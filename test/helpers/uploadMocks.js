/**
 * Mock helpers for upload service tests
 */

/**
 * Creates a mock Express request object
 * @param {string} path - Request path
 * @returns {Object} Mock request object
 */
function createMockRequest(path = '/') {
  return {
    path
  };
}

/**
 * Creates a mock file object
 * @param {string} originalname - Original filename
 * @param {string} mimetype - MIME type
 * @returns {Object} Mock file object
 */
function createMockFile(originalname = 'test.jpg', mimetype = 'image/jpeg') {
  return {
    originalname,
    mimetype,
    size: 1024,
    buffer: Buffer.from('test')
  };
}

/**
 * Creates a mock logger
 * @returns {Object} Mock logger with spy methods
 */
function createMockLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  };
}

/**
 * Creates a mock filesystem module
 * @param {boolean} shouldSucceed - Whether operations should succeed
 * @param {Error} error - Error to return if shouldSucceed is false
 * @returns {Object} Mock fs module
 */
function createMockFs(shouldSucceed = true, error = new Error('Mock fs error')) {
  return {
    promises: {
      mkdir: shouldSucceed 
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(error),
      writeFile: shouldSucceed
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(error),
      readFile: shouldSucceed
        ? jest.fn().mockResolvedValue(Buffer.from('test'))
        : jest.fn().mockRejectedValue(error),
      unlink: shouldSucceed
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(error)
    }
  };
}

module.exports = {
  createMockRequest,
  createMockFile,
  createMockLogger,
  createMockFs
}; 