const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const User = require('../src/models/User');

async function addDefaultMoves() {
    try {
        // Find all users that don't have moves array
        const users = await User.find({ moves: { $exists: false } });
        console.log(`Found ${users.length} users without moves`);

        const defaultMoves = ["67a80524ad10e0715a1bf5f4"];

        // Update each user
        for (const user of users) {
            await User.findByIdAndUpdate(user._id, {
                $set: { moves: defaultMoves }
            });
            console.log(`Added default moves to user: ${user.email}`);
        }

        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
}

addDefaultMoves(); 