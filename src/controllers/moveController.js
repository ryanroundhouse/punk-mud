const Move = require('../models/Move');
const logger = require('../config/logger');

async function getMoves(req, res) {
    try {
        const moves = await Move.find().sort({ name: 1 });
        res.json(moves);
    } catch (error) {
        logger.error('Error fetching moves:', error);
        res.status(500).json({ error: 'Error fetching moves' });
    }
}

async function getPublicMoves(req, res) {
    try {
        const moves = await Move.find({}, '_id name type').sort({ name: 1 });
        res.json(moves);
    } catch (error) {
        logger.error('Error fetching moves:', error);
        res.status(500).json({ error: 'Error fetching moves' });
    }
}

async function createOrUpdateMove(req, res) {
    try {
        const { 
            _id,
            name,
            helpDescription,
            delay,
            attackStat,
            defenceStat,
            success,
            failure,
            basePower,
            scalingFactor
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const moveData = {
            name,
            helpDescription: helpDescription || '',
            delay: delay || 1,
            attackStat,
            defenceStat,
            success,
            failure,
            basePower: basePower || 5,
            scalingFactor: scalingFactor || 0.8
        };

        let savedMove;
        if (_id) {
            savedMove = await Move.findByIdAndUpdate(
                _id,
                moveData,
                { new: true, runValidators: true }
            );
            if (!savedMove) {
                return res.status(404).json({ error: 'Move not found' });
            }
        } else {
            const move = new Move(moveData);
            savedMove = await move.save();
        }

        res.json(savedMove);

    } catch (error) {
        logger.error('Error saving move:', error);
        res.status(500).json({ error: 'Error saving move' });
    }
}

async function deleteMove(req, res) {
    try {
        const move = await Move.findByIdAndDelete(req.params.id);
        if (!move) {
            return res.status(404).json({ error: 'Move not found' });
        }
        res.json({ message: 'Move deleted successfully' });
    } catch (error) {
        logger.error('Error deleting move:', error);
        res.status(500).json({ error: 'Error deleting move' });
    }
}

module.exports = {
    getMoves,
    getPublicMoves,
    createOrUpdateMove,
    deleteMove
}; 