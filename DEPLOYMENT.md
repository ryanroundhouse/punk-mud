# Production Deployment Guide

This document provides instructions for deploying the Express MongoDB application to a Linux production server.

## Prerequisites

- Linux server with Docker and Docker Compose installed
- Git access to the application repository
- Basic knowledge of Docker and Linux administration

## Deployment Options

This repository includes two deployment options:

1. **Basic Deployment** (`docker-compose.prod.yml`): Simple setup without authentication
2. **Secure Deployment** (`docker-compose.prod.secure.yml`): Enhanced security with authentication for MongoDB and Redis

## Basic Deployment

### 1. Clone the Repository

```bash
git clone <repository-url>
cd <repository-directory>
```

### 2. Create Environment File

```bash
cp .env.production.example .env.production
# Edit the file and set your production values
nano .env.production
```

### 3. Build and Start Services

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
```

## Secure Deployment (Recommended)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd <repository-directory>
```

### 2. Create Environment File with Strong Passwords

```bash
cp .env.production.example .env.production
# Edit the file and set your production values with strong passwords
nano .env.production
```

### 3. Build and Start Services

```bash
docker-compose -f docker-compose.prod.secure.yml --env-file .env.production up -d
```

## SSL Certificate Setup

For HTTPS with Let's Encrypt:

```bash
# Install certbot
apt update
apt install certbot

# Obtain certificate (stop Nginx first if it's running on port 80)
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates to Nginx directory
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/certs/
```

## Deployment Verification

Check if all services are running:

```bash
docker-compose -f docker-compose.prod.yml ps
# or for secure deployment
docker-compose -f docker-compose.prod.secure.yml ps
```

View logs:

```bash
docker-compose -f docker-compose.prod.yml logs -f app
# or for secure deployment
docker-compose -f docker-compose.prod.secure.yml logs -f app
```

## Updating the Application

### 1. Pull Latest Changes

```bash
git pull origin main
```

### 2. Rebuild and Restart

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# or for secure deployment
docker-compose -f docker-compose.prod.secure.yml --env-file .env.production up -d --build
```

## Backup and Restore

### Backup MongoDB Data

```bash
# For basic deployment
docker exec -it $(docker-compose -f docker-compose.prod.yml ps -q mongodb) mongodump --out /data/db/backup

# For secure deployment
docker exec -it $(docker-compose -f docker-compose.prod.secure.yml ps -q mongodb) mongodump --username admin --password $MONGO_ADMIN_PASSWORD --authenticationDatabase admin --out /data/db/backup
```

### Restore MongoDB Data

```bash
# For basic deployment
docker exec -it $(docker-compose -f docker-compose.prod.yml ps -q mongodb) mongorestore /data/db/backup

# For secure deployment
docker exec -it $(docker-compose -f docker-compose.prod.secure.yml ps -q mongodb) mongorestore --username admin --password $MONGO_ADMIN_PASSWORD --authenticationDatabase admin /data/db/backup
```

## Scaling and Production Considerations

### Using External Databases

For production environments with high traffic, consider using managed database services:

1. **MongoDB Atlas**: Update the `MONGODB_URI` environment variable to point to your Atlas cluster
2. **Redis Cloud**: Update the `REDIS_URL` environment variable to point to your Redis Cloud instance

### SSL/TLS Configuration

For secure HTTPS connections, we recommend using a reverse proxy like Nginx:

1. Install Nginx on your host server
2. Configure SSL with Let's Encrypt
3. Set up Nginx to proxy requests to your Docker Compose services

## Troubleshooting

### Services Not Starting

Check the logs:

```bash
docker-compose -f docker-compose.prod.yml logs
```

### Database Connection Issues

Verify the environment variables:

```bash
docker-compose -f docker-compose.prod.yml config
```

## Security Best Practices

1. Use the secure deployment option with authentication
2. Regularly update Docker images and dependencies
3. Set up a firewall and only expose necessary ports
4. Configure regular backups
5. Implement monitoring and alerting 