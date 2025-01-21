const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb://mongodb:27017/myapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Update User Schema
const userSchema = new mongoose.Schema({
    email: String,
    authCode: {
        code: String,
        expiresAt: Date
    },
    avatarName: String,
    isBuilder: {
        type: Boolean,
        default: false
    }
});

const User = mongoose.model('User', userSchema);

async function updateBuilder() {
    try {
        // Update specific user to be a builder
        const result = await User.findOneAndUpdate(
            { email: 'rg@ryangraham.ca' },
            { isBuilder: true },
            { new: true }
        );

        if (result) {
            console.log('Builder flag added successfully:', result);
        } else {
            console.log('User not found');
        }
    } catch (error) {
        console.error('Error updating user:', error);
    } finally {
        mongoose.connection.close();
    }
}

updateBuilder(); 