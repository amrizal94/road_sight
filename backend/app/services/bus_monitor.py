"""
Bus passenger monitor — independent from parking and traffic monitors.
Counts passengers boarding (line_in) and alighting (line_out) via a
door-facing camera. Keys: bus_id (int).
"""
import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import cv2

from ..config import settings
from ..database import SessionLocal
from ..models.bus import PassengerSnapshot
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

bus_monitors: dict[int, dict] = {}

SNAPSHOT_INTERVAL = 300  # Save PassengerSnapshot every 5 minutes


def _resolve_url(url: str) -> str:
    """Use yt-dlp for YouTube URLs; return RTSP/HTTP URLs as-is."""
    if "youtube" in url or "youtu.be" in url:
        return _get_stream_url(url)
    return url


def _monitor_loop(bus_id: int, capacity: int,
                  stream_origin: str, stream_url: str, model_name: str | None):
    monitor = bus_monitors.get(bus_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open stream"
        logger.error(f"Bus {bus_id}: Cannot open stream")
        return

    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    detector = VehicleDetector(model_name)
    tracker = VehicleTracker(frame_height)

    if monitor.get("status") == "stopping":
        logger.info(f"Bus {bus_id}: Stop requested before monitor started")
        return
    monitor["status"] = "running"
    monitor["_line_y"] = frame_height // 2
    logger.info(f"Bus {bus_id}: Passenger monitor started (model={model_name or settings.yolo_model})")

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
                logger.warning(f"Bus {bus_id}: Reconnecting ({reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}), waiting {delay}s...")
                time.sleep(delay)

                if monitor.get("status") != "running":
                    break

                try:
                    stream_url = _resolve_url(stream_origin)
                except Exception as e:
                    logger.error(f"Bus {bus_id}: URL resolve failed: {e}")
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

            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)
            raw_dets = detector.detect(small)
            for d in raw_dets:
                d["bbox"] = [v / scale for v in d["bbox"]]

            tracked = tracker.update(raw_dets)
            now = datetime.now(tz)
            line_in, line_out = tracker.get_line_counts()
            passenger_count = max(0, line_in - line_out)

            monitor["frame_count"] = frame_idx
            monitor["line_in"] = line_in
            monitor["line_out"] = line_out
            monitor["passenger_count"] = passenger_count
            monitor["last_update"] = now.isoformat()

            if (now - last_snapshot).total_seconds() >= SNAPSHOT_INTERVAL:
                db.add(PassengerSnapshot(
                    bus_id=bus_id,
                    passenger_count=passenger_count,
                    timestamp=now,
                ))
                db.commit()
                last_snapshot = now
                logger.info(f"Bus {bus_id}: Snapshot saved — onboard={passenger_count}")

            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            _draw_detections(frame, tracked, monitor["_line_y"])
            cv2.putText(
                frame,
                f"NAIK: {line_in}  TURUN: {line_out}  ONBOARD: {passenger_count}/{capacity}",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 200), 2,
            )

            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            monitor["_annotated_frame"] = buf.tobytes()
            monitor["_frame_seq"] = monitor.get("_frame_seq", 0) + 1
            event = monitor.get("_frame_event")
            if event:
                event.set()

    except Exception as e:
        logger.error(f"Bus {bus_id}: Error — {e}")
        monitor["status"] = "error"
        monitor["error"] = str(e)
    finally:
        reader.stop()
        db.close()
        if monitor.get("status") == "running":
            monitor["status"] = "stopped"
        logger.info(f"Bus {bus_id}: Passenger monitor stopped")


async def start_bus_monitor(bus_id: int, capacity: int,
                             stream_origin: str, model_name: str | None = None) -> dict:
    if bus_id in bus_monitors and bus_monitors[bus_id]["status"] in ("running", "starting"):
        return {"error": "Already monitoring this bus"}

    stream_url = _resolve_url(stream_origin)

    monitor = {
        "bus_id": bus_id,
        "stream_url": stream_origin,
        "model_name": model_name or settings.yolo_model,
        "status": "starting",
        "frame_count": 0,
        "line_in": 0,
        "line_out": 0,
        "passenger_count": 0,
        "last_update": None,
        "error": None,
        "_annotated_frame": None,
        "_line_y": 0,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    bus_monitors[bus_id] = monitor

    thread = threading.Thread(
        target=_monitor_loop,
        args=(bus_id, capacity, stream_origin, stream_url, model_name),
        daemon=True,
    )
    thread.start()
    monitor["_thread"] = thread

    return {"bus_id": bus_id, "status": "starting"}


def stop_bus_monitor(bus_id: int) -> dict:
    monitor = bus_monitors.get(bus_id)
    if not monitor:
        return {"error": "No active monitor for this bus"}

    monitor["status"] = "stopping"

    def _cleanup():
        thread = monitor.get("_thread")
        if thread and thread.is_alive():
            thread.join(timeout=20)
        bus_monitors.pop(bus_id, None)

    threading.Thread(target=_cleanup, daemon=True).start()
    return {"bus_id": bus_id, "status": "stopping"}


def get_bus_monitor_status(bus_id: int) -> dict | None:
    monitor = bus_monitors.get(bus_id)
    if not monitor:
        return None
    return {
        "bus_id": monitor["bus_id"],
        "stream_url": monitor.get("stream_url"),
        "status": monitor["status"],
        "line_in": monitor["line_in"],
        "line_out": monitor["line_out"],
        "passenger_count": monitor["passenger_count"],
        "last_update": monitor["last_update"],
        "error": monitor.get("error"),
    }


def stop_all_bus_monitors():
    for bus_id in list(bus_monitors.keys()):
        monitor = bus_monitors.get(bus_id)
        if monitor:
            monitor["status"] = "stopping"
    for bus_id in list(bus_monitors.keys()):
        monitor = bus_monitors.get(bus_id)
        if monitor:
            thread = monitor.get("_thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)
    bus_monitors.clear()
    logger.info("All bus monitors stopped")
