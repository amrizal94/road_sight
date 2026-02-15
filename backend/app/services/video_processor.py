import asyncio
import uuid
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import cv2
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models.detection import DetectionEvent
from ..models.traffic_count import TrafficCount
from .detector import VehicleDetector
from .tracker import VehicleTracker

# In-memory job store
jobs: dict[str, dict] = {}


def _process_video(job_id: str, video_path: str, camera_id: int):
    db: Session = SessionLocal()
    try:
        jobs[job_id]["status"] = "processing"
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = "Cannot open video"
            return

        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

        detector = VehicleDetector()
        tracker = VehicleTracker(frame_height)

        frame_idx = 0
        # Process every Nth frame for speed
        process_every = max(1, int(fps // 5))
        vehicle_counts: dict[str, int] = defaultdict(int)

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % process_every == 0:
                raw_dets = detector.detect(frame)
                tracked = tracker.update(raw_dets)

                now = datetime.now(ZoneInfo(settings.timezone))
                for det in tracked:
                    db.add(DetectionEvent(
                        camera_id=camera_id,
                        vehicle_type=det["vehicle_type"],
                        confidence=det["confidence"],
                        timestamp=now,
                    ))
                    vehicle_counts[det["vehicle_type"]] += 1

                jobs[job_id]["frames_processed"] = frame_idx
                jobs[job_id]["progress"] = round(frame_idx / max(total_frames, 1) * 100, 1)

            frame_idx += 1

        cap.release()

        now = datetime.now(ZoneInfo(settings.timezone))
        for vtype, count in vehicle_counts.items():
            db.add(TrafficCount(
                camera_id=camera_id,
                vehicle_type=vtype,
                count=count,
                timestamp=now,
            ))
        db.commit()

        in_count, out_count = tracker.get_line_counts()
        jobs[job_id].update({
            "status": "completed",
            "progress": 100,
            "total_frames": total_frames,
            "vehicle_counts": dict(vehicle_counts),
            "line_in": in_count,
            "line_out": out_count,
        })
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
    finally:
        db.close()


async def start_processing(video_path: str, camera_id: int) -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "camera_id": camera_id,
        "status": "queued",
        "progress": 0,
        "frames_processed": 0,
    }
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _process_video, job_id, video_path, camera_id)
    return job_id
