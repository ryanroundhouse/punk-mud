#!/bin/bash
set -e

# Ensure the MONGO_PASSWORD is available from environment
if [ -z "$MONGO_PASSWORD" ]; then
  echo "Error: MONGO_PASSWORD environment variable is not set"
  exit 1
fi

# Create a temporary file with the MongoDB initialization script
cat > /tmp/mongo-init.js <<EOF
db = db.getSiblingDB('admin');

// Create application user
db.createUser({
  user: "app_user",
  pwd: "$MONGO_PASSWORD",
  roles: [
    { role: "readWrite", db: "myapp" }
  ]
});

// Initialize the application database
db = db.getSiblingDB('myapp');

// Create initial collections if needed
db.createCollection('users');
db.createCollection('sessions');
EOF

# Execute the MongoDB initialization script
mongosh admin /tmp/mongo-init.js

# Clean up the temporary file 
rm /tmp/mongo-init.js 