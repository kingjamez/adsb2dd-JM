#!/usr/bin/env bash
# install.sh - Install adsb2dd as a systemd service
# Usage: sudo ./install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Install npm dependencies
if [ ! -d "$SCRIPT_DIR/src/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR/src" && npm install
fi

# Install and enable systemd service
echo "Installing systemd service..."
cp "$SCRIPT_DIR/adsb2dd.service" /etc/systemd/system/adsb2dd.service
systemctl daemon-reload
systemctl enable adsb2dd
systemctl restart adsb2dd

echo "adsb2dd service installed and started."
echo "  Status:  sudo systemctl status adsb2dd"
echo "  Logs:    journalctl -u adsb2dd -f"
echo "  Stop:    sudo systemctl stop adsb2dd"
echo "  Start:   sudo systemctl start adsb2dd"
