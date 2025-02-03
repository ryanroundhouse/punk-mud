const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const User = require('../models/User');

async function addDefaultStats() {
    try {
        // Find all users that don't have stats
        const users = await User.find({ stats: { $exists: false } });
        console.log(`Found ${users.length} users without stats`);

        const defaultStats = {
            hitPoints: 100,
            armor: 0,
            body: 1,
            reflexes: 1,
            agility: 1,
            charisma: 1,
            tech: 1,
            luck: 1
        };

        // Update each user
        for (const user of users) {
            await User.findByIdAndUpdate(user._id, {
                $set: { stats: defaultStats }
            });
            console.log(`Added default stats to user: ${user.email}`);
        }

        console.log('Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

addDefaultStats(); 