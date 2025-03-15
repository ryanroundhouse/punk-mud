#!/bin/bash

# Simple test runner for punk-mud

# Default to all tests if no argument is provided
TEST_PATH=${1:-"test"}

# Run tests with coverage if --coverage flag is provided
if [[ $* == *--coverage* ]]; then
    echo "Running tests with coverage..."
    npm test -- --coverage $TEST_PATH
else
    echo "Running tests for $TEST_PATH..."
    npm test -- $TEST_PATH
fi

# Check if tests passed
if [ $? -eq 0 ]; then
    echo "Tests passed successfully! 🎉"
else
    echo "Tests failed. 😢"
    exit 1
fi 