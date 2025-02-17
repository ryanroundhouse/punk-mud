const Class = require('../models/Class');
const logger = require('../config/logger');

async function getClasses(req, res) {
    try {
        const classes = await Class.find()
            .populate('moveGrowth.move')
            .sort({ name: 1 });
        res.json(classes);
    } catch (error) {
        logger.error('Error fetching classes:', error);
        res.status(500).json({ error: 'Error fetching classes' });
    }
}

async function getPublicClasses(req, res) {
    try {
        const classes = await Class.find({}, '_id name')
            .sort({ name: 1 });
        res.json(classes);
    } catch (error) {
        logger.error('Error fetching classes:', error);
        res.status(500).json({ error: 'Error fetching classes' });
    }
}

async function createOrUpdateClass(req, res) {
    try {
        const { 
            _id,
            name,
            description,
            baseHitpoints,
            hpPerLevel,
            hpPerBod,
            primaryStat,
            secondaryStats,
            moveGrowth
        } = req.body;

        if (!name || !primaryStat || !description || !baseHitpoints || !hpPerLevel || !hpPerBod) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const classData = {
            name,
            description,
            baseHitpoints,
            hpPerLevel,
            hpPerBod,
            primaryStat,
            secondaryStats,
            moveGrowth
        };

        if (_id) {
            const existingClass = await Class.findById(_id);
            if (!existingClass) {
                return res.status(404).json({ error: 'Class not found' });
            }

            Object.assign(existingClass, classData);
            const savedClass = await existingClass.save();
            return res.json(await savedClass.populate('moveGrowth.move'));
        }

        const newClass = new Class(classData);
        const savedClass = await newClass.save();
        res.status(201).json(await savedClass.populate('moveGrowth.move'));

    } catch (error) {
        logger.error('Error saving class:', error);
        res.status(500).json({ error: 'Error saving class' });
    }
}

async function deleteClass(req, res) {
    try {
        const classDoc = await Class.findByIdAndDelete(req.params.id);
        if (!classDoc) {
            return res.status(404).json({ error: 'Class not found' });
        }
        res.json({ message: 'Class deleted successfully' });
    } catch (error) {
        logger.error('Error deleting class:', error);
        res.status(500).json({ error: 'Error deleting class' });
    }
}

module.exports = {
    getClasses,
    getPublicClasses,
    createOrUpdateClass,
    deleteClass
}; 