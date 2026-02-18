#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Road Sight — Deployment Script
# Jalankan: bash deploy.sh
# ──────────────────────────────────────────────────────────────────────────────
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIST="$PROJECT_DIR/frontend/dist"

echo "==> [1/5] Pull latest code from git..."
git -C "$PROJECT_DIR" pull origin main

echo "==> [2/5] Build frontend..."
cd "$PROJECT_DIR/frontend"
npm install --silent
npm run build
echo "    Frontend built → $FRONTEND_DIST"

echo "==> [3/5] Build & restart backend container..."
cd "$PROJECT_DIR"
docker compose up -d --build backend

echo "==> [4/5] Ensure database container is running..."
docker compose up -d db

echo "==> [5/5] Reload Nginx..."
nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true

echo ""
echo "✓ Deployment complete!"
echo "  Frontend : $FRONTEND_DIST"
echo "  Backend  : http://127.0.0.1:${BACKEND_PORT:-8001}"
echo ""
echo "  Logs     : docker compose logs -f backend"
