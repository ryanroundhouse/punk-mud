const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

async function fixActorIndex() {
    try {
        // Get the actors collection
        const actorsCollection = mongoose.connection.collection('actors');

        // List all indexes
        console.log('Current indexes:');
        const indexes = await actorsCollection.indexes();
        console.log(indexes);

        // Drop the problematic index
        try {
            await actorsCollection.dropIndex('id_1');
            console.log('Successfully dropped id_1 index from actors collection');
        } catch (error) {
            if (error.code === 27) {
                console.log('Note: id_1 index not found (already dropped)');
            } else {
                throw error;
            }
        }

        // Create new index on name field
        await actorsCollection.createIndex({ name: 1 });
        console.log('Successfully created new index on name field');

        // List indexes after modification
        console.log('\nUpdated indexes:');
        const updatedIndexes = await actorsCollection.indexes();
        console.log(updatedIndexes);

        // Clean up any documents that might have an 'id' field
        const result = await actorsCollection.updateMany(
            { },
            { 
                $unset: { id: "" }
            }
        );

        console.log('\nCleaned up documents:', result.modifiedCount);

    } catch (error) {
        console.error('Error fixing actors collection:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

fixActorIndex(); 