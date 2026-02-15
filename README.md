# Road Sight

Real-time vehicle detection and traffic monitoring platform using YouTube CCTV live streams, YOLO AI, and GIS visualization.

## Features

- **Live Monitoring** - Real-time vehicle detection from YouTube CCTV live streams
- **YOLO Detection** - Supports YOLO26, YOLO11, YOLOv8 models (switchable via UI)
- **Vehicle Tracking** - ByteTrack-based tracking with line counting (in/out)
- **Dashboard** - Traffic charts with interval filters (5M/15M/30M/1H), date filters, auto-refresh
- **GIS Map** - Leaflet map with camera markers, heatmap, fly-to-camera
- **Responsive** - Mobile-friendly with hamburger nav, card layouts
- **WebSocket** - Real-time detection feed via WebSocket
- **Background Processing** - Detection continues when no viewers (optimized)

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL + PostGIS, Ultralytics (YOLO), OpenCV, yt-dlp
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Recharts, Leaflet
- **Infra**: Docker (PostgreSQL), PM2 (process manager)

## Quick Start

### 1. Database (PostgreSQL + PostGIS)
```bash
docker-compose up -d
```

### 2. Backend
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. yt-dlp Setup (YouTube access)
```bash
# Install JS runtime for YouTube extraction
# Requires Node.js installed

# If YouTube blocks requests, use cookies:
# Export cookies.txt from browser and place in backend/cookies.txt
# Set YTDLP_COOKIES_FILE=cookies.txt in .env
```

## Production (PM2)

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Start all services
pm2 start ecosystem.config.js

# Monitor
pm2 status
pm2 logs
```

## Environment Variables

Create `.env` in project root or `backend/`:

```env
POSTGRES_USER=road_sight
POSTGRES_PASSWORD=road_sight_secret
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=road_sight
YTDLP_COOKIES_FILE=cookies.txt
YTDLP_COOKIES_BROWSER=firefox
```

## API Endpoints

### Cameras
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/cameras` | Create camera |
| GET | `/api/cameras` | List cameras |
| GET | `/api/cameras/:id` | Camera detail |
| PUT | `/api/cameras/:id` | Update camera |
| DELETE | `/api/cameras/:id` | Delete camera + related data |

### Live Monitoring
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stream/live/start` | Start live monitoring |
| POST | `/api/stream/live/stop/:id` | Stop monitoring |
| GET | `/api/stream/live/status/:id` | Monitor status |
| GET | `/api/stream/live/all` | All monitors status |
| GET | `/api/stream/live/feed/:id` | MJPEG stream (AI annotated) |
| GET | `/api/stream/live/feed-raw/:id` | MJPEG stream (raw) |
| GET | `/api/stream/models` | Available YOLO models |

### Video Processing
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stream/process` | Upload & process video |
| POST | `/api/stream/process-url` | Process from YouTube URL |
| GET | `/api/stream/status/:job_id` | Processing status |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary` | Vehicle counts summary |
| GET | `/api/analytics/hourly/:id` | Hourly traffic (today) |
| GET | `/api/analytics/traffic/:id` | Traffic with interval/date filter |
| GET | `/api/analytics/heatmap` | GIS heatmap data |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/detections` | Query detection events |
| WS | `/ws/live` | Real-time WebSocket updates |
