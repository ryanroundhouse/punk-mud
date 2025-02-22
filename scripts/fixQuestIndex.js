const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

async function fixQuestIndex() {
    try {
        // Get the quests collection
        const questsCollection = mongoose.connection.collection('quests');

        // List all indexes
        console.log('Current indexes:');
        const indexes = await questsCollection.indexes();
        console.log(indexes);

        // Drop the problematic index
        try {
            await questsCollection.dropIndex('id_1');
            console.log('Successfully dropped id_1 index from quests collection');
        } catch (error) {
            if (error.code === 27) {
                console.log('Note: id_1 index not found (already dropped)');
            } else {
                throw error;
            }
        }

        // List indexes after modification
        console.log('\nUpdated indexes:');
        const updatedIndexes = await questsCollection.indexes();
        console.log(updatedIndexes);

        // Update existing documents to ensure proper event IDs
        const result = await questsCollection.updateMany(
            { },
            { 
                $set: { 
                    "events.$[element]._id": new mongoose.Types.ObjectId() 
                }
            },
            {
                arrayFilters: [{ "element._id": { $exists: false } }],
                multi: true
            }
        );

        console.log('\nUpdated documents:', result.modifiedCount);

    } catch (error) {
        console.error('Error fixing quest collection:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

fixQuestIndex(); 