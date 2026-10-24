#!/bin/bash
# Start script for Replit deployment

# Install backend dependencies
cd src/backend
uv sync

# Run database migrations
uv run alembic upgrade head

# Seed demo data if not already seeded
uv run python -m app.db.seed

# Start backend server in background
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# Go back to root and install frontend dependencies
cd ../..
npm install

# Build and serve frontend
npm run build
npm run preview -- --host 0.0.0.0 --port 5173
