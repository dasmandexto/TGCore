#!/bin/bash
set -e

echo "=============================================="
echo "  Telegram Voice AI - One Command Start (WSL) "
echo "=============================================="

cd "$(dirname "$0")"

echo "[1/3] Setting up Python Environment for AI Server..."
cd ai_server
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi
source venv/bin/activate
echo "Installing python requirements..."
pip install -r ../requirements.txt -q
cd ..

echo "[2/3] Setting up Node.js Environment..."
if [ -d "node_modules" ] && [ "$(stat -c %U node_modules)" = "root" ]; then
    echo "Fixing node_modules permissions... (requires sudo)"
    sudo chown -R "$USER":"$USER" node_modules package-lock.json || true
fi

if [ ! -d "node_modules" ] || ! ls ~/.cache/ms-playwright >/dev/null 2>&1 ; then
    echo "Running npm setup... (might ask for sudo password)"
    npm run setup
fi

echo "[3/3] Starting Servers..."

cd ai_server
source venv/bin/activate
python3 app.py &
AI_PID="$!"
cd ..

npm start &
UI_PID="$!"

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$AI_PID" "$UI_PID" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "=============================================="
echo "✅ All services started!"
echo "👉 Open your browser at: http://localhost:3000"
echo "🛑 Press Ctrl+C to stop both servers."
echo "=============================================="

wait