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
            type,
            helpDescription,
            successChance,
            success,
            failure
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const moveData = {
            name,
            type: type || 'none',
            helpDescription: helpDescription || '',
            successChance: successChance || 50,
            success: {
                message: success.message,
                target: success.target,
                stat: success.stat,
                amount: Number(success.amount)
            },
            failure: {
                message: failure.message,
                target: failure.target,
                stat: failure.stat,
                amount: Number(failure.amount)
            }
        };

        if (_id) {
            const existingMove = await Move.findById(_id);
            if (!existingMove) {
                return res.status(404).json({ error: 'Move not found' });
            }

            Object.assign(existingMove, moveData);
            const savedMove = await existingMove.save();
            return res.json(savedMove);
        }

        const move = new Move(moveData);
        const savedMove = await move.save();
        res.status(201).json(savedMove);

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