FROM node:18-slim

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy app source
COPY . .

# Set NODE_ENV to production
ENV NODE_ENV=production

# Expose application port
EXPOSE 3000

# Run the application
CMD ["node", "src/server.js"] 