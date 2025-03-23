#!/bin/bash

# Find the latest backup file
LATEST_BACKUP=$(ls -t ~/mongodb_backup/*.gz | head -n 1)
echo "Using backup file: $LATEST_BACKUP"

# Copy the backup file to the MongoDB data directory
echo "Copying backup to mounted volume..."
docker-compose -f docker-compose.prod.secure.yml exec -T mongodb bash -c "mkdir -p /tmp"
docker cp "$LATEST_BACKUP" "$(docker-compose -f docker-compose.prod.secure.yml ps -q mongodb):/tmp/backup.archive"

# Restore using docker-compose exec with environment variables
echo "Restoring backup..."
docker-compose -f docker-compose.prod.secure.yml exec mongodb mongorestore \
  --username admin \
  --password=${MONGO_ADMIN_PASSWORD} \
  --authenticationDatabase admin \
  --archive=/tmp/backup.archive \
  --drop \
  --verbose

echo "Backup restoration completed"