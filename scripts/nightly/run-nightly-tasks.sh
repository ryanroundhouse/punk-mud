#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

# Change to the project root directory
cd "$PROJECT_ROOT"

# Log start time
echo "Starting nightly tasks at $(date)"

# Run the energy restoration script
echo "Running energy restoration..."
node scripts/nightly/restoreEnergy.js

# Add more nightly tasks here as needed
# echo "Running another task..."
# node scripts/nightly/anotherTask.js

# Log completion
echo "Nightly tasks completed at $(date)" 