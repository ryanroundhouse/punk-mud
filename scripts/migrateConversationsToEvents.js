const mongoose = require('mongoose');
require('dotenv').config();

// Add empty restrictions array to each node in the conversation tree
function addRestrictionsToNode(node) {
    if (!node) return node;

    // Add restrictions array to current node
    node.restrictions = node.restrictions || [];

    // Process choices recursively
    if (node.choices && Array.isArray(node.choices)) {
        node.choices.forEach(choice => {
            if (choice.nextNode) {
                choice.nextNode = addRestrictionsToNode(choice.nextNode);
            }
        });
    }

    return node;
}

async function migrateConversationsToEvents() {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://mongodb:27017/myapp', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Get the collections
        const conversationsCollection = mongoose.connection.collection('conversations');
        const eventsCollection = mongoose.connection.collection('events');

        // Get all conversations
        const conversations = await conversationsCollection.find({}).toArray();
        console.log(`Found ${conversations.length} conversations to migrate`);

        // Convert each conversation to an event
        for (const conversation of conversations) {
            // Check if event with same title already exists
            const existingEvent = await eventsCollection.findOne({ 
                title: `${conversation.title} (from conv)` 
            });
            
            if (existingEvent) {
                console.log(`Skipping ${conversation.title} - event already exists`);
                continue;
            }

            // Create new event from conversation
            const eventData = {
                title: `${conversation.title} (from conv)`, // Add suffix to distinguish from original
                actorId: conversation.actorId,  // Already an ObjectId
                rootNode: addRestrictionsToNode(JSON.parse(JSON.stringify(conversation.rootNode))), // Deep clone and add restrictions
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Insert the new event
            await eventsCollection.insertOne(eventData);
            console.log(`Migrated: ${conversation.title}`);
        }

        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('Disconnected from MongoDB');
    }
}

// Run the migration
migrateConversationsToEvents(); 