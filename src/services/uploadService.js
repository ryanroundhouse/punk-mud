const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');

/**
 * Extracts type from the request path
 * @param {Object} req - Express request object
 * @param {string} defaultType - Default type if none can be extracted
 * @returns {string} The extracted type
 */
function extractTypeFromPath(req, defaultType = 'misc') {
    // Handle paths like /api/upload/actor by checking if the path includes 'upload'
    const pathSegments = req.path.split('/').filter(segment => segment.length > 0);
    
    if (pathSegments.length >= 3 && pathSegments[1] === 'upload') {
        // For paths like /api/upload/actor, return 'actor'
        return pathSegments[2] || defaultType;
    }
    
    // Original behavior for direct routes like /avatar
    return pathSegments[0] || defaultType;
}

/**
 * Builds the upload directory path based on the type
 * @param {string} type - The content type (e.g., 'avatar', 'image')
 * @param {string} basePath - Base path for uploads
 * @returns {string} The full upload directory path
 */
function buildUploadPath(type, basePath = path.join(__dirname, '../../public/assets')) {
    return path.join(basePath, `${type}s`);
}

/**
 * Ensures a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path to ensure
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists(dirPath, logger) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        logger.info(`Upload directory ensured: ${dirPath}`);
        return dirPath;
    } catch (err) {
        logger.error(`Error creating upload directory: ${dirPath}`, err);
        throw err;
    }
}

/**
 * Generates a unique filename for uploads
 * @param {string} type - Content type
 * @param {string} originalFilename - Original filename
 * @returns {string} The generated filename
 */
function generateFilename(type, originalFilename) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(originalFilename);
    return `${type}-${uniqueSuffix}${ext}`;
}

/**
 * Creates the file filter function for uploads
 * @param {RegExp} allowedTypes - Regex of allowed file types
 * @returns {Function} File filter function
 */
function createFileFilter(allowedTypes = /jpeg|jpg|png|gif/) {
    return (req, file, cb) => {
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    };
}

/**
 * Creates multer storage configuration
 * @param {Object} dependencies - Dependencies
 * @returns {Object} Multer disk storage configuration
 */
function createStorage({ 
    extractType = extractTypeFromPath,
    buildPath = buildUploadPath,
    ensureDir = ensureDirectoryExists,
    generateName = generateFilename,
    fsModule = fs,
    loggerInstance = logger
} = {}) {
    return multer.diskStorage({
        destination: function(req, file, cb) {
            const type = extractType(req);
            const uploadDir = buildPath(type);
            
            ensureDir(uploadDir, loggerInstance)
                .then(() => cb(null, uploadDir))
                .catch(err => cb(err));
        },
        filename: function (req, file, cb) {
            const type = extractType(req);
            const filename = generateName(type, file.originalname);
            cb(null, filename);
        }
    });
}

/**
 * Creates a configured multer middleware
 * @param {Object} options - Configuration options
 * @returns {Function} Configured multer middleware
 */
function createUploadMiddleware(options = {}) {
    const {
        fileSize = 5 * 1024 * 1024,
        fileFilter = createFileFilter(),
        storageConfig = {}
    } = options;

    const storage = createStorage(storageConfig);

    return multer({
        storage,
        limits: { fileSize },
        fileFilter
    });
}

module.exports = {
    createUploadMiddleware,
    // Export internal functions for testing
    extractTypeFromPath,
    buildUploadPath,
    ensureDirectoryExists,
    generateFilename,
    createFileFilter,
    createStorage
}; 