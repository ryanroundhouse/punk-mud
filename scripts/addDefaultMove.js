const mongoose = require('mongoose');
const User = require('../models/User');

async function addDefaultMove() {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://localhost:27017/myapp');
        console.log('Connected to MongoDB');

        // Find all users that have no moves
        const users = await User.find({ moves: { $size: 0 } });
        console.log(`Found ${users.length} users without moves`);

        const defaultMoveId = '67b29a30dbc2d3999df0dcdc';

        // Update each user
        for (const user of users) {
            await User.findByIdAndUpdate(user._id, {
                $set: { moves: [defaultMoveId] }
            });
            console.log(`Added default move to user: ${user.email}`);
        }

        console.log('Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
}

addDefaultMove(); 