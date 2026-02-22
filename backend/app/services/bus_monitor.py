"""
Bus passenger monitor — independent from parking and traffic monitors.
Counts passengers boarding (line_in) and alighting (line_out) via a
door-facing camera. Keys: bus_id (int).
"""
import asyncio
import logging
import math
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
    _ffprobe_stream,
    _get_stream_url,
    _open_capture,
)
from .tracker import VehicleTracker

logger = logging.getLogger(__name__)

bus_monitors: dict[int, dict] = {}

SNAPSHOT_INTERVAL = 300  # Save PassengerSnapshot every 5 minutes


def _draw_bus_frame(frame, tracked: list[dict],
                    x1_px: int, y1_px: int, x2_px: int, y2_px: int,
                    line_in: int, line_out: int,
                    passenger_count: int, capacity: int) -> None:
    """Draw bboxes, arbitrary counting line, and in/out direction arrows (in-place)."""
    # Bounding boxes + tracker IDs
    for det in tracked:
        bx1, by1, bx2, by2 = [int(v) for v in det["bbox"]]
        cv2.rectangle(frame, (bx1, by1), (bx2, by2), (0, 200, 220), 2)
        tid = det.get("tracker_id", -1)
        if tid >= 0:
            cv2.putText(frame, f"#{tid}", (bx1, by2 + 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 220), 1)

    # Counting line
    cv2.line(frame, (x1_px, y1_px), (x2_px, y2_px), (0, 255, 255), 2)

    # Perpendicular direction arrows
    # Left-normal of (dx,dy) in screen coords (Y-down) = (dy, -dx) / len → "in/NAIK" side
    dx, dy = x2_px - x1_px, y2_px - y1_px
    length = math.hypot(dx, dy)
    if length > 10:
        nx, ny = dy / length, -dx / length          # left-normal (in/NAIK)
        mx, my = (x1_px + x2_px) // 2, (y1_px + y2_px) // 2
        ARROW = 40
        in_x = int(mx + nx * ARROW)
        in_y = int(my + ny * ARROW)
        out_x = int(mx - nx * ARROW)
        out_y = int(my - ny * ARROW)
        cv2.arrowedLine(frame, (mx, my), (in_x, in_y), (0, 210, 60), 2, tipLength=0.35)
        cv2.putText(frame, "NAIK", (in_x + 4, in_y + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 210, 60), 1)
        cv2.arrowedLine(frame, (mx, my), (out_x, out_y), (60, 60, 230), 2, tipLength=0.35)
        cv2.putText(frame, "TURUN", (out_x + 4, out_y + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (60, 60, 230), 1)

    # Status bar
    cv2.putText(
        frame,
        f"NAIK: {line_in}  TURUN: {line_out}  ONBOARD: {passenger_count}/{capacity}",
        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 200), 2,
    )


def _resolve_url(url: str) -> str:
    """Use yt-dlp for YouTube URLs; return RTSP/HTTP URLs as-is."""
    if "youtube" in url or "youtu.be" in url:
        return _get_stream_url(url)
    return url


def _monitor_loop(bus_id: int, capacity: int,
                  stream_origin: str, stream_url: str, model_name: str | None,
                  line_x1: float, line_y1: float, line_x2: float, line_y2: float):
    monitor = bus_monitors.get(bus_id)
    if not monitor:
        return
    try:
        _monitor_loop_inner(bus_id, capacity, stream_origin, stream_url, model_name, monitor,
                            line_x1, line_y1, line_x2, line_y2)
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
                        stream_origin: str, stream_url: str, model_name: str | None, monitor: dict,
                        line_x1: float, line_y1: float, line_x2: float, line_y2: float):
    reader, frame_height = _make_reader(stream_url, bus_id)
    if reader is None:
        monitor["status"] = "error"
        monitor["error"] = "Cannot open stream"
        logger.error(f"Bus {bus_id}: Cannot open stream")
        return

    if model_name and not os.path.exists(model_name):
        logger.warning(f"Bus {bus_id}: Model '{model_name}' not found, using default ({settings.yolo_model})")
        model_name = None
    BUS_CONFIDENCE = 0.15
    detector = PersonDetector(model_name, confidence=BUS_CONFIDENCE)
    tracker = VehicleTracker(
        frame_height,
        lost_track_buffer=90,
        minimum_matching_threshold=0.7,
    )

    if monitor.get("status") == "stopping":
        logger.info(f"Bus {bus_id}: Stop requested before monitor started")
        reader.stop()
        return
    monitor["status"] = "running"

    # Line zone is built on the first frame (need actual frame_width for pixel coords).
    line_zone_ready = False
    x1_px = y1_px = x2_px = y2_px = 0

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

            # Build line zone on first frame using actual pixel dimensions
            if not line_zone_ready:
                fh, fw = frame.shape[:2]
                x1_px = int(fw * line_x1)
                y1_px = max(int(fh * line_y1), 1)
                x2_px = int(fw * line_x2)
                y2_px = max(int(fh * line_y2), 1)
                monitor["_line_pts"] = (x1_px, y1_px, x2_px, y2_px)
                tracker.line_zone = sv.LineZone(
                    start=sv.Point(x1_px, y1_px),
                    end=sv.Point(x2_px, y2_px),
                    triggering_anchors=[sv.Position.BOTTOM_CENTER],
                )
                line_zone_ready = True
                logger.warning(
                    f"Bus {bus_id}: Passenger monitor started (model={model_name or settings.yolo_model}, "
                    f"conf={BUS_CONFIDENCE}, frame={fh}x{fw}, "
                    f"line=({x1_px},{y1_px})→({x2_px},{y2_px}), anchor=BOTTOM_CENTER)"
                )

            # Cache raw JPEG every ~30 frames for /monitor/frame endpoint
            if frame_idx % 30 == 1:
                _, raw_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                monitor["_raw_frame"] = raw_buf.tobytes()

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

            prev_in = monitor.get("line_in", 0)
            prev_out = monitor.get("line_out", 0)
            if line_in != prev_in or line_out != prev_out:
                logger.info(f"Bus {bus_id}: Crossing — in={line_in} out={line_out} (frame {frame_idx})")

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

            _draw_bus_frame(frame, tracked, x1_px, y1_px, x2_px, y2_px,
                            line_in, line_out, passenger_count, capacity)

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
                             stream_origin: str, model_name: str | None = None,
                             line_x1: float = 0.0, line_y1: float = 0.25,
                             line_x2: float = 1.0, line_y2: float = 0.25) -> dict:
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
        "line_x1": line_x1,
        "line_y1": line_y1,
        "line_x2": line_x2,
        "line_y2": line_y2,
        "_annotated_frame": None,
        "_raw_frame": None,
        "_line_pts": (0, 0, 0, 0),
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    bus_monitors[bus_id] = monitor

    thread = threading.Thread(
        target=_monitor_loop,
        args=(bus_id, capacity, stream_origin, stream_url, model_name,
              line_x1, line_y1, line_x2, line_y2),
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
