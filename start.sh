#!/bin/bash

# Task Manager Startup Script
echo "🚀 Starting Task Manager with PostgreSQL..."

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"

# Start PostgreSQL service
echo "📊 Starting PostgreSQL service..."
brew services start postgresql@14

# Wait a moment for PostgreSQL to start
sleep 2

# Check if database exists, create if not
echo "🗄️  Checking database..."
if ! psql -d task_manager -c "SELECT 1;" > /dev/null 2>&1; then
    echo "📝 Creating database and tables..."
    psql -d postgres -c "CREATE DATABASE task_manager;" 2>/dev/null || true
    psql -d task_manager -f setup-db.sql
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the application
echo "🌟 Starting Task Manager application..."
echo "🌐 Open http://localhost:3000 in your browser"
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

npm start
