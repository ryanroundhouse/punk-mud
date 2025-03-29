const mongoose = require('mongoose');
require('dotenv').config();

async function connectDB() {
    try {
        const connectionString = process.env.MONGODB_URI || 'mongodb://mongodb:27017/myapp';
        
        await mongoose.connect(connectionString, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

async function fixEventNodes() {
    try {
        await connectDB();
        
        const eventsCollection = mongoose.connection.collection('events');
        console.log('Starting event node fixes...');
        
        const events = await eventsCollection.find({}).toArray();
        console.log(`Found ${events.length} events to process`);
        
        let totalNodesFixed = 0;
        let totalEventsFixed = 0;
        
        for (const event of events) {
            let eventModified = false;
            const originalEvent = JSON.parse(JSON.stringify(event));
            
            const processNode = (node, path = '') => {
                if (!node) return null;
                
                let nodeModified = false;
                const originalNode = JSON.parse(JSON.stringify(node));
                
                // Only fix missing ID and choices array
                if (!node._id) {
                    node._id = new mongoose.Types.ObjectId();
                    nodeModified = true;
                }
                
                if (!Array.isArray(node.choices)) {
                    node.choices = [];
                    nodeModified = true;
                }
                
                // Process each choice's nextNode
                if (node.choices.length > 0) {
                    node.choices.forEach((choice, index) => {
                        if (choice.nextNode) {
                            const processedNode = processNode(choice.nextNode, `${path}.choices[${index}].nextNode`);
                            if (processedNode) {
                                choice.nextNode = processedNode;
                                nodeModified = true;
                            }
                        }
                    });
                }
                
                return nodeModified ? node : null;
            };
            
            if (event.rootNode) {
                const processedRoot = processNode(event.rootNode, 'rootNode');
                if (processedRoot) {
                    event.rootNode = processedRoot;
                    eventModified = true;
                }
            }
            
            if (eventModified) {
                totalEventsFixed++;
                console.log('\n' + '='.repeat(80));
                console.log(`Event ID: ${event._id}`);
                console.log('='.repeat(80));
                
                console.log('\nOriginal Event:');
                console.log(JSON.stringify(originalEvent, null, 2));
                
                console.log('\nModified Event:');
                console.log(JSON.stringify(event, null, 2));
                
                // Actually update the database
                await eventsCollection.updateOne(
                    { _id: event._id },
                    { $set: { rootNode: event.rootNode } }
                );
                
                console.log('\nChanges Applied:');
                if (event._id !== originalEvent._id) {
                    console.log('- Added missing event ID');
                }
                if (JSON.stringify(event.rootNode) !== JSON.stringify(originalEvent.rootNode)) {
                    console.log('- Modified root node structure');
                }
                console.log('='.repeat(80) + '\n');
            }
        }
        
        console.log('\nFix Summary:');
        console.log(`Total events processed: ${events.length}`);
        console.log(`Events fixed: ${totalEventsFixed}`);
        console.log(`Total nodes fixed: ${totalNodesFixed}`);
        
        // Create the indexes
        console.log('\nCreating indexes...');
        await eventsCollection.createIndex({ 'rootNode._id': 1 });
        await eventsCollection.createIndex({ 'rootNode.choices.nextNode._id': 1 });
        console.log('Indexes created successfully');
        
    } catch (error) {
        console.error('Error fixing event nodes:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

// Run the fix
fixEventNodes();