#!/usr/bin/env bash
# start.sh - Run the blah2 data recorder
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR" && npm install
fi

echo "Starting blah2-recorder..."
cd "$SCRIPT_DIR" && node recorder.js "$@"
