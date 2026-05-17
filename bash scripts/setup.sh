#!/bin/bash
echo "=================================================="
echo "  NIM-Claude Proxy Setup"
echo "=================================================="

# Move to the root directory
cd "$(dirname "$0")/.."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is not installed or not in PATH."
    echo "Please install Python 3.8+ and try again."
    exit 1
fi

echo "[1/3] Installing required Python packages..."
pip3 install fastapi uvicorn requests
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies."
    exit 1
fi

echo "[2/3] Setting up environment configuration..."
if [ ! -f .env ]; then
    if [ -f .env.sample ]; then
        cp .env.sample .env
        echo "[OK] Created .env from .env.sample."
        echo "Please open the .env file in your project root and add your NVIDIA_API_KEY."
    else
        echo "[WARNING] .env.sample not found. Please manually create a .env file with your NVIDIA_API_KEY."
    fi
else
    echo "[OK] .env file already exists."
fi

echo ""
echo "[3/3] Setup Complete!"
echo ""
echo "You can now start the proxy server by running:"
echo "  bash scripts/start_proxy.sh"
echo ""
