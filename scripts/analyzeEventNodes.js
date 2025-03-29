const mongoose = require('mongoose');
require('dotenv').config();

// Use the same connection configuration as the main app
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

async function analyzeEventNodes() {
    try {
        // Connect to database first
        await connectDB();
        
        // Get the events collection
        const eventsCollection = mongoose.connection.collection('events');
        
        console.log('Starting event node analysis...');
        
        // Find all events
        const events = await eventsCollection.find({}).toArray();
        console.log(`Found ${events.length} events to analyze`);
        
        let totalNodesFixed = 0;
        let totalEventsFixed = 0;
        
        for (const event of events) {
            let eventModified = false;
            const originalEvent = JSON.parse(JSON.stringify(event)); // Deep copy for comparison
            
            // Process the event tree
            const processNode = (node, path = '') => {
                if (!node) return null;
                
                let nodeModified = false;
                const originalNode = JSON.parse(JSON.stringify(node)); // Deep copy for comparison
                
                // Fix missing ID
                if (!node._id) {
                    node._id = new mongoose.Types.ObjectId();
                    nodeModified = true;
                }
                
                // Ensure choices array exists
                if (!Array.isArray(node.choices)) {
                    node.choices = [];
                    nodeModified = true;
                }
                
                // Process each choice
                if (node.choices.length > 0) {
                    // Find reference quest events if they exist
                    const referenceChoice = node.choices.find(c => 
                        c.nextNode && 
                        c.nextNode.questCompletionEvents && 
                        c.nextNode.questCompletionEvents.length > 0
                    );
                    
                    const referenceEvents = referenceChoice?.nextNode?.questCompletionEvents || [];
                    
                    // Process each choice
                    node.choices.forEach((choice, index) => {
                        if (choice.nextNode) {
                            // Recursively process the next node
                            const processedNode = processNode(choice.nextNode, `${path}.choices[${index}].nextNode`);
                            if (processedNode) {
                                choice.nextNode = processedNode;
                                nodeModified = true;
                            }
                            
                            // Fix quest events consistency
                            if (referenceEvents.length > 0 && 
                                (!choice.nextNode.questCompletionEvents || 
                                 choice.nextNode.questCompletionEvents.length === 0)) {
                                choice.nextNode.questCompletionEvents = [...referenceEvents];
                                nodeModified = true;
                            }
                        }
                    });
                }
                
                return nodeModified ? node : null;
            };
            
            // Process the root node
            if (event.rootNode) {
                const processedRoot = processNode(event.rootNode, 'rootNode');
                if (processedRoot) {
                    event.rootNode = processedRoot;
                    eventModified = true;
                }
            }
            
            // If the event was modified, show the differences
            if (eventModified) {
                totalEventsFixed++;
                console.log('\n' + '='.repeat(80));
                console.log(`Event ID: ${event._id}`);
                console.log('='.repeat(80));
                
                // Show differences in a readable format
                console.log('\nOriginal Event:');
                console.log(JSON.stringify(originalEvent, null, 2));
                
                console.log('\nModified Event:');
                console.log(JSON.stringify(event, null, 2));
                
                // Show a summary of changes
                console.log('\nChanges Summary:');
                if (event._id !== originalEvent._id) {
                    console.log('- Added missing event ID');
                }
                if (JSON.stringify(event.rootNode) !== JSON.stringify(originalEvent.rootNode)) {
                    console.log('- Modified root node structure');
                }
                console.log('='.repeat(80) + '\n');
            }
        }
        
        console.log('\nAnalysis Summary:');
        console.log(`Total events analyzed: ${events.length}`);
        console.log(`Events that would be fixed: ${totalEventsFixed}`);
        console.log(`Total nodes that would be fixed: ${totalNodesFixed}`);
        
        // Show what indexes would be created
        console.log('\nIndexes that would be created:');
        console.log('- { "rootNode._id": 1 }');
        console.log('- { "rootNode.choices.nextNode._id": 1 }');
        
    } catch (error) {
        console.error('Error analyzing event nodes:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\nDatabase connection closed');
    }
}

// Run the analysis
analyzeEventNodes();