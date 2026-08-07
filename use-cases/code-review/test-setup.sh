#!/bin/bash
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SCRIPT_DIR}/microservices-demo"

echo "Setting up test use case for code-review..."

# Remove existing directory if present for a clean setup
if [ -d "$TARGET_DIR" ]; then
    echo "Removing existing directory: $TARGET_DIR"
    rm -rf "$TARGET_DIR"
fi

# Shallow clone repository to fetch local files
echo "Cloning https://github.com/GoogleCloudPlatform/microservices-demo.git..."
git clone --depth 1 https://github.com/GoogleCloudPlatform/microservices-demo.git "$TARGET_DIR"

# Remove git tracking
echo "Removing Git tracking (.git)..."
rm -rf "$TARGET_DIR/.git"

echo "Setup completed and ready to run the test case."
