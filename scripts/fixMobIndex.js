const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

async function fixMobIndex() {
    try {
        // Get the mobs collection
        const mobsCollection = mongoose.connection.collection('mobs');

        // List all indexes
        console.log('Current indexes:');
        const indexes = await mobsCollection.indexes();
        console.log(indexes);

        // Drop the problematic index
        try {
            await mobsCollection.dropIndex('id_1');
            console.log('Successfully dropped id_1 index from mobs collection');
        } catch (error) {
            if (error.code === 27) {
                console.log('Note: id_1 index not found (already dropped)');
            } else {
                throw error;
            }
        }

        // Create unique index on name field
        await mobsCollection.createIndex({ name: 1 }, { unique: true });
        console.log('Created unique index on name field');

        // List indexes after modification
        console.log('\nUpdated indexes:');
        const updatedIndexes = await mobsCollection.indexes();
        console.log(updatedIndexes);

        // Clean up any documents with null or undefined id field
        const result = await mobsCollection.updateMany(
            { id: { $exists: true } },
            { $unset: { id: "" } }
        );

        console.log('\nCleaned up documents:', result.modifiedCount);

    } catch (error) {
        console.error('Error fixing mobs collection:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

fixMobIndex(); 