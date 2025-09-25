#!/bin/bash

# Task Manager Application Run Script
# This script starts both the backend server and frontend client

set -e  # Exit on any error

echo "🚀 Starting Task Manager Application..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_status "Node.js version: $(node --version)"
print_status "npm version: $(npm --version)"

# Check if PostgreSQL is running (optional check)
if command -v pg_isready &> /dev/null; then
    if pg_isready -q; then
        print_success "PostgreSQL is running"
    else
        print_warning "PostgreSQL might not be running. Make sure your database is accessible."
    fi
else
    print_warning "pg_isready not found. Skipping PostgreSQL check."
fi

# Install root dependencies if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing root dependencies..."
    npm install
fi

# Install server dependencies if needed
if [ ! -d "server/node_modules" ]; then
    print_status "Installing server dependencies..."
    cd server
    npm install
    cd ..
fi

# Install client dependencies if needed
if [ ! -d "client/node_modules" ]; then
    print_status "Installing client dependencies..."
    cd client
    npm install
    cd ..
fi

print_success "All dependencies are installed!"

# Load environment variables
if [ -f "config.env" ]; then
    print_status "Loading environment variables from config.env..."
    export $(cat config.env | grep -v '^#' | xargs)
else
    print_warning "config.env not found. Using default configuration."
fi

# Function to cleanup background processes
cleanup() {
    print_status "Shutting down services..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    if [ ! -z "$CLIENT_PID" ]; then
        kill $CLIENT_PID 2>/dev/null || true
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start the backend server
print_status "Starting backend server on port ${PORT:-3001}..."
cd server
node lab2.server.js &
SERVER_PID=$!
cd ..

# Wait a moment for server to start
sleep 2

# Check if server started successfully
if kill -0 $SERVER_PID 2>/dev/null; then
    print_success "Backend server started successfully (PID: $SERVER_PID)"
else
    print_error "Failed to start backend server"
    exit 1
fi

# Start the frontend client
print_status "Starting frontend client..."
cd client
npm run dev &
CLIENT_PID=$!
cd ..

# Wait a moment for client to start
sleep 3

# Check if client started successfully
if kill -0 $CLIENT_PID 2>/dev/null; then
    print_success "Frontend client started successfully (PID: $CLIENT_PID)"
else
    print_error "Failed to start frontend client"
    cleanup
    exit 1
fi

print_success "🎉 Task Manager Application is running!"
echo ""
echo "📱 Frontend: http://localhost:5173 (Vite dev server)"
echo "🔧 Backend API: http://localhost:${PORT:-3001}"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user interrupt
wait
