"""
Independent parking monitor — completely separate from traffic live_monitor.
Keys: lot_id (int), not camera_id.
Does NOT save DetectionEvent / TrafficCount.
Saves OccupancySnapshot every SNAPSHOT_INTERVAL seconds.
"""
import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import cv2

from ..config import settings
from ..database import SessionLocal
from ..models.parking import OccupancySnapshot
from .detector import VehicleDetector
from .live_monitor import (
    FRAME_QUEUE_TIMEOUT,
    MAX_RECONNECT_ATTEMPTS,
    RECONNECT_DELAY_BASE,
    RECONNECT_DELAY_MAX,
    STREAM_DEAD_TIMEOUT,
    FrameReader,
    _draw_detections,
    _get_stream_url,
    _open_capture,
)
from .tracker import VehicleTracker

logger = logging.getLogger(__name__)

# Independent monitor dict — keyed by lot_id, no overlap with active_monitors
parking_monitors: dict[int, dict] = {}

SNAPSHOT_INTERVAL = 300  # Save OccupancySnapshot every 5 minutes


def _monitor_loop(lot_id: int, initial_occupied: int, total_spaces: int,
                  youtube_url: str, stream_url: str, model_name: str | None):
    monitor = parking_monitors.get(lot_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open stream"
        logger.error(f"Parking lot {lot_id}: Cannot open stream")
        return

    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    detector = VehicleDetector(model_name)
    tracker = VehicleTracker(frame_height)

    monitor["status"] = "running"
    monitor["_line_y"] = frame_height // 2
    logger.info(f"Parking lot {lot_id}: Monitor started (model={model_name or settings.yolo_model})")

    reader = FrameReader(cap)
    frame_idx = 0
    last_frame_time = time.time()
    reconnect_attempts = 0
    tz = ZoneInfo(settings.timezone)
    db = SessionLocal()
    last_snapshot = datetime.now(tz)

    try:
        while monitor.get("status") == "running":
            frame = reader.read(timeout=FRAME_QUEUE_TIMEOUT)

            if frame is None:
                if time.time() - last_frame_time < STREAM_DEAD_TIMEOUT:
                    continue

                reader.stop()
                reconnect_attempts += 1
                if reconnect_attempts > MAX_RECONNECT_ATTEMPTS:
                    monitor["status"] = "error"
                    monitor["error"] = "Stream disconnected after max retries"
                    break

                delay = min(RECONNECT_DELAY_BASE * (2 ** (reconnect_attempts - 1)), RECONNECT_DELAY_MAX)
                logger.warning(f"Parking lot {lot_id}: Reconnecting ({reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}), waiting {delay}s...")
                time.sleep(delay)

                if monitor.get("status") != "running":
                    break

                try:
                    stream_url = _get_stream_url(youtube_url)
                except Exception as e:
                    logger.error(f"Parking lot {lot_id}: yt-dlp failed: {e}")
                    continue

                cap = _open_capture(stream_url)
                if not cap.isOpened():
                    continue
                reader = FrameReader(cap)
                last_frame_time = time.time()
                continue

            last_frame_time = time.time()
            reconnect_attempts = 0
            frame_idx += 1

            # Detect + track
            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)
            raw_dets = detector.detect(small)
            for d in raw_dets:
                d["bbox"] = [v / scale for v in d["bbox"]]

            tracked = tracker.update(raw_dets)
            now = datetime.now(tz)

            line_in, line_out = tracker.get_line_counts()
            occupied = max(0, min(total_spaces, initial_occupied + line_in - line_out))

            monitor["frame_count"] = frame_idx
            monitor["line_in"] = line_in
            monitor["line_out"] = line_out
            monitor["occupied_spaces"] = occupied
            monitor["last_update"] = now.isoformat()

            # Save OccupancySnapshot periodically
            if (now - last_snapshot).total_seconds() >= SNAPSHOT_INTERVAL:
                db.add(OccupancySnapshot(
                    parking_lot_id=lot_id,
                    occupied_spaces=occupied,
                    timestamp=now,
                ))
                db.commit()
                last_snapshot = now
                logger.info(f"Parking lot {lot_id}: Snapshot saved — occupied={occupied}")

            # Render annotated frame for MJPEG feed
            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            _draw_detections(frame, tracked, monitor["_line_y"])

            # Overlay occupancy info
            cv2.putText(frame, f"IN: {line_in}  OUT: {line_out}  OCC: {occupied}/{total_spaces}",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 200), 2)

            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            monitor["_annotated_frame"] = buf.tobytes()
            monitor["_frame_seq"] = monitor.get("_frame_seq", 0) + 1
            event = monitor.get("_frame_event")
            if event:
                event.set()

    except Exception as e:
        logger.error(f"Parking lot {lot_id}: Error — {e}")
        monitor["status"] = "error"
        monitor["error"] = str(e)
    finally:
        reader.stop()
        db.close()
        if monitor.get("status") == "running":
            monitor["status"] = "stopped"
        logger.info(f"Parking lot {lot_id}: Monitor stopped")


async def start_parking_monitor(lot_id: int, initial_occupied: int, total_spaces: int,
                                 youtube_url: str, model_name: str | None = None) -> dict:
    if lot_id in parking_monitors and parking_monitors[lot_id]["status"] == "running":
        return {"error": "Already monitoring this parking lot"}

    stream_url = _get_stream_url(youtube_url)

    monitor = {
        "lot_id": lot_id,
        "stream_url": youtube_url,
        "model_name": model_name or settings.yolo_model,
        "status": "starting",
        "frame_count": 0,
        "line_in": 0,
        "line_out": 0,
        "occupied_spaces": initial_occupied,
        "last_update": None,
        "error": None,
        "_annotated_frame": None,
        "_line_y": 0,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    parking_monitors[lot_id] = monitor

    thread = threading.Thread(
        target=_monitor_loop,
        args=(lot_id, initial_occupied, total_spaces, youtube_url, stream_url, model_name),
        daemon=True,
    )
    thread.start()
    monitor["_thread"] = thread

    return {"lot_id": lot_id, "status": "starting"}


def stop_parking_monitor(lot_id: int) -> dict:
    monitor = parking_monitors.get(lot_id)
    if not monitor:
        return {"error": "No active monitor for this parking lot"}

    monitor["status"] = "stopping"

    def _cleanup():
        thread = monitor.get("_thread")
        if thread and thread.is_alive():
            thread.join(timeout=20)
        parking_monitors.pop(lot_id, None)

    threading.Thread(target=_cleanup, daemon=True).start()
    return {"lot_id": lot_id, "status": "stopping"}


def get_parking_monitor_status(lot_id: int) -> dict | None:
    monitor = parking_monitors.get(lot_id)
    if not monitor:
        return None
    return {
        "lot_id": monitor["lot_id"],
        "stream_url": monitor.get("stream_url"),
        "model_name": monitor.get("model_name"),
        "status": monitor["status"],
        "frame_count": monitor["frame_count"],
        "line_in": monitor["line_in"],
        "line_out": monitor["line_out"],
        "occupied_spaces": monitor["occupied_spaces"],
        "last_update": monitor["last_update"],
        "error": monitor.get("error"),
    }


def stop_all_parking_monitors():
    for lot_id in list(parking_monitors.keys()):
        monitor = parking_monitors.get(lot_id)
        if monitor:
            monitor["status"] = "stopping"
    for lot_id in list(parking_monitors.keys()):
        monitor = parking_monitors.get(lot_id)
        if monitor:
            thread = monitor.get("_thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)
    parking_monitors.clear()
    logger.info("All parking monitors stopped")
