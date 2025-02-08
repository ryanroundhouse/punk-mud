const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');

function createUploadMiddleware(type) {
    const uploadDir = path.join(__dirname, `../../public/assets/${type}s`);
    
    // Ensure upload directory exists
    fs.mkdir(uploadDir, { recursive: true })
        .then(() => logger.info(`Upload directory ensured: ${uploadDir}`))
        .catch(err => logger.error(`Error creating upload directory: ${uploadDir}`, err));

    const storage = multer.diskStorage({
        destination: uploadDir,
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            cb(null, `${type}-${uniqueSuffix}${ext}`);
        }
    });

    return multer({
        storage,
        limits: {
            fileSize: 5 * 1024 * 1024 // 5MB limit
        },
        fileFilter: (req, file, cb) => {
            const allowedTypes = /jpeg|jpg|png|gif/;
            const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = allowedTypes.test(file.mimetype);
            
            if (extname && mimetype) {
                return cb(null, true);
            }
            cb(new Error('Only image files are allowed!'));
        }
    });
}

module.exports = {
    createUploadMiddleware
}; 