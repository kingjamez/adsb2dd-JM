#!/usr/bin/env bash
# start.sh - Run adsb2dd without Docker
# Usage: ./start.sh [port]
# Default port: 3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"

# Use first argument as port, or fall back to env var, or default 3000
export PORT="${1:-${PORT:-3000}}"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js 16+ first."
    echo "  https://nodejs.org/"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "$SRC_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$SRC_DIR" && npm install
fi

echo "Starting adsb2dd on port $PORT..."
cd "$SRC_DIR" && node server.js
