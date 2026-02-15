# Road Sight

Platform monitoring lalu lintas terintegrasi (CCTV + AI + GIS).

## Quick Start

### 1. Database (PostgreSQL + PostGIS)
```bash
docker-compose up -d
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API running at http://localhost:8000

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Dashboard at http://localhost:5173

## Usage

1. Register a camera location via `POST /api/cameras`
2. Upload a video via `POST /api/stream/process?camera_id=1`
3. Check processing status via `GET /api/stream/status/{job_id}`
4. View results on the dashboard

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/cameras | Register camera |
| GET | /api/cameras | List cameras |
| GET | /api/cameras/:id | Camera detail |
| POST | /api/stream/process | Upload & process video |
| GET | /api/stream/status/:job_id | Processing status |
| GET | /api/detections | Query detections |
| GET | /api/analytics/summary | Vehicle counts summary |
| GET | /api/analytics/hourly/:camera_id | Hourly traffic |
| GET | /api/analytics/heatmap | GIS heatmap data |
| WS | /ws/live | Real-time updates |
