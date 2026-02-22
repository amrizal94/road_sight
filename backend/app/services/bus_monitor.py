"""
Bus passenger monitor — independent from parking and traffic monitors.
Counts passengers boarding (line_in) and alighting (line_out) via a
door-facing camera. Keys: bus_id (int).
"""
import asyncio
import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import os

import cv2
import supervision as sv

from ..config import settings
from ..database import SessionLocal
from ..models.bus import PassengerSnapshot
from .detector import PersonDetector
from .live_monitor import (
    FRAME_QUEUE_TIMEOUT,
    MAX_RECONNECT_ATTEMPTS,
    RECONNECT_DELAY_BASE,
    RECONNECT_DELAY_MAX,
    STREAM_DEAD_TIMEOUT,
    FFmpegReader,
    FrameReader,
    _draw_detections,
    _ffprobe_stream,
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
    try:
        _monitor_loop_inner(bus_id, capacity, stream_origin, stream_url, model_name, monitor)
    except Exception as e:
        logger.error(f"Bus {bus_id}: UNHANDLED ERROR in monitor loop: {e}", exc_info=True)
        if monitor:
            monitor["status"] = "error"
            monitor["error"] = str(e)


def _make_reader(stream_url: str, bus_id: int) -> tuple["FrameReader | FFmpegReader", int]:
    """
    Return (reader, frame_height).
    - RTSP → cv2.VideoCapture + FrameReader (low-latency, buffered live stream)
    - HTTP/YouTube CDN → FFmpegReader (ffmpeg subprocess pipe, handles reconnect)
    """
    is_rtsp = stream_url.startswith("rtsp://")
    if is_rtsp:
        cap = _open_capture(stream_url)
        if not cap.isOpened():
            return None, 0
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if frame_height == 0:
            ret, tmp = cap.read()
            if ret:
                frame_height = tmp.shape[0]
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        return FrameReader(cap), frame_height
    else:
        # Use ffprobe to get dimensions, then start ffmpeg pipe reader.
        w, h, fps = _ffprobe_stream(stream_url)
        if h == 0:
            # ffprobe failed — try one frame via cv2 as fallback
            cap = _open_capture(stream_url)
            ret, tmp = cap.read()
            cap.release()
            if ret:
                h, w = tmp.shape[:2]
                fps = 25.0
            else:
                logger.error(f"Bus {bus_id}: Cannot probe stream dimensions")
                return None, 0
        reader = FFmpegReader(stream_url, width=w, height=h, fps=fps)
        return reader, h


def _monitor_loop_inner(bus_id: int, capacity: int,
                        stream_origin: str, stream_url: str, model_name: str | None, monitor: dict):
    reader, frame_height = _make_reader(stream_url, bus_id)
    if reader is None:
        monitor["status"] = "error"
        monitor["error"] = "Cannot open stream"
        logger.error(f"Bus {bus_id}: Cannot open stream")
        return

    if model_name and not os.path.exists(model_name):
        logger.warning(f"Bus {bus_id}: Model '{model_name}' not found, using default ({settings.yolo_model})")
        model_name = None
    # Use lower confidence than the global setting so detections are maintained
    # through the door-crossing zone where people are partially occluded / motion-blurred.
    BUS_CONFIDENCE = 0.15
    detector = PersonDetector(model_name, confidence=BUS_CONFIDENCE)
    tracker = VehicleTracker(frame_height)

    if monitor.get("status") == "stopping":
        logger.info(f"Bus {bus_id}: Stop requested before monitor started")
        reader.stop()
        return
    monitor["status"] = "running"
    # Line at 25% from top with TOP anchor.
    # Stationary passengers have bbox-top (head) at y≈0–20 → always above this line.
    # People walking through the door move their head (bbox-top) past this line → counted.
    # Using only TOP_LEFT/TOP_RIGHT avoids false triggers from large bboxes that
    # naturally span a mid-frame line even when the person is standing still.
    line_y = max(int(frame_height * 0.25), 1)
    monitor["_line_y"] = line_y
    tracker.line_y = line_y
    tracker.line_zone = sv.LineZone(
        start=sv.Point(0, line_y),
        end=sv.Point(10000, line_y),
        triggering_anchors=[sv.Position.TOP_LEFT, sv.Position.TOP_RIGHT],
    )
    logger.warning(f"Bus {bus_id}: Passenger monitor started (model={model_name or settings.yolo_model}, "
                   f"conf={BUS_CONFIDENCE}, frame={frame_height}, line_y={line_y}, anchor=TOP)")

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

                reader, _ = _make_reader(stream_url, bus_id)
                if reader is None:
                    continue
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

            if frame_idx == 1:
                logger.info(f"Bus {bus_id}: First frame received, size={frame.shape[:2]}")

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

    loop = asyncio.get_event_loop()
    try:
        stream_url = await loop.run_in_executor(None, _resolve_url, stream_origin)
    except Exception as e:
        raise RuntimeError(f"Gagal resolve stream URL: {e}") from e

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
