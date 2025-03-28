#!/bin/bash

# Create backup directory if it doesn't exist
mkdir -p ~/mongodb_backup

# Generate timestamp for the backup file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE=~/mongodb_backup/mongodb_backup_${TIMESTAMP}.gz

echo "Creating backup at: $BACKUP_FILE"

# Create backup using mongodump
docker compose -f docker-compose.prod.secure.yml exec mongodb mongodump \
  --username admin \
  --password=${MONGO_ADMIN_PASSWORD} \
  --authenticationDatabase admin \
  --archive=/tmp/backup.archive \
# --excludeCollection=app.users

# Copy the backup file from container to host
docker cp "$(docker-compose -f docker-compose.prod.secure.yml ps -q mongodb):/tmp/backup.archive" "$BACKUP_FILE"

# Clean up temporary file in container
docker-compose -f docker-compose.prod.secure.yml exec -T mongodb bash -c "rm /tmp/backup.archive"

echo "Backup completed successfully" 