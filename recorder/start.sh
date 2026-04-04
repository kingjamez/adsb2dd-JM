#!/bin/bash
# blah2-recorder start script
# Auto-installs Node.js if not present

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for Node.js, install if missing
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "Node.js $(node --version) installed."
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting blah2-recorder..."
exec node recorder.js "$@"
