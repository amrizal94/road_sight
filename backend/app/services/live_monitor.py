import subprocess
import threading
import logging
import time
from collections import defaultdict
from datetime import datetime
from queue import Queue, Empty, Full
from zoneinfo import ZoneInfo

import cv2
import numpy as np

from ..config import settings
from ..database import SessionLocal
from ..models.detection import DetectionEvent
from ..models.traffic_count import TrafficCount
from .detector import VehicleDetector, VEHICLE_CLASSES
from .tracker import VehicleTracker

logger = logging.getLogger(__name__)

# Active monitors: camera_id -> monitor info
active_monitors: dict[int, dict] = {}

# Colors for bounding boxes (BGR)
BBOX_COLORS = {
    "car": (255, 144, 30),
    "motorcycle": (0, 165, 255),
    "bus": (0, 200, 0),
    "truck": (0, 0, 255),
    "bicycle": (255, 0, 200),
}

MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_DELAY_BASE = 3  # seconds (doubles each attempt: 3, 6, 12, 24, ...)
RECONNECT_DELAY_MAX = 60  # cap at 60 seconds
FRAME_QUEUE_TIMEOUT = 1  # seconds to wait for a frame (short to avoid display freeze)
STREAM_DEAD_TIMEOUT = 10  # seconds of no frames before attempting reconnect


def _draw_detections(frame: np.ndarray, tracked: list[dict], line_y: int) -> None:
    """Draw bounding boxes, labels, and counting line on frame (in-place)."""
    h, w = frame.shape[:2]
    cv2.line(frame, (0, line_y), (w, line_y), (0, 255, 255), 2)
    cv2.putText(frame, "Counting Line", (10, line_y - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

    for det in tracked:
        x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
        vtype = det["vehicle_type"]
        conf = det["confidence"]
        color = BBOX_COLORS.get(vtype, (128, 128, 128))

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        label = f"{vtype} {conf:.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        tid = det.get("tracker_id", -1)
        if tid >= 0:
            cv2.putText(frame, f"#{tid}", (x1, y2 + 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)


def _get_stream_url(youtube_url: str) -> str:
    cmd = ["yt-dlp", "-g", "-f", "b", "--js-runtimes", "node", "--remote-components", "ejs:github"]
    if settings.ytdlp_cookies_file:
        cmd.extend(["--cookies", settings.ytdlp_cookies_file])
    else:
        cmd.extend(["--cookies-from-browser", settings.ytdlp_cookies_browser])
    cmd.append(youtube_url)
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp error: {result.stderr.strip()}")
    return result.stdout.strip().split("\n")[0]


def _open_capture(stream_url: str) -> cv2.VideoCapture:
    """Open VideoCapture with optimized settings for live streams."""
    import os
    os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "error"

    cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


class FrameReader:
    """Dedicated frame reader thread - prevents cv2.read() from blocking the main loop."""

    def __init__(self, cap: cv2.VideoCapture):
        self._cap = cap
        self._queue: Queue = Queue(maxsize=8)  # Buffer for stream stalls
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        consecutive_failures = 0
        while not self._stopped.is_set():
            try:
                ret, frame = self._cap.read()
                if not ret:
                    consecutive_failures += 1
                    if consecutive_failures > 30:
                        # Stream truly dead after many failures
                        try:
                            self._queue.put(None, timeout=1)
                        except Full:
                            pass
                        break
                    time.sleep(0.05)
                    continue
                consecutive_failures = 0
                # Drop old frames if queue is full (keep latest)
                if self._queue.full():
                    try:
                        self._queue.get_nowait()
                    except Empty:
                        pass
                self._queue.put(frame, timeout=1)
            except Exception:
                try:
                    self._queue.put(None, timeout=1)
                except Full:
                    pass
                break

    def read(self, timeout: float = FRAME_QUEUE_TIMEOUT):
        """Read a frame with timeout. Returns frame or None on failure/timeout."""
        try:
            frame = self._queue.get(timeout=timeout)
            return frame  # None means stream failed
        except Empty:
            return None  # Timeout

    def stop(self):
        self._stopped.set()
        self._cap.release()


def _monitor_loop(camera_id: int, youtube_url: str, stream_url: str, ws_callback,
                   model_name: str | None = None):
    """Single-loop design: read frame → YOLO detect → draw → publish.
    Every frame is processed. FPS = YOLO speed. No frame skipping."""
    monitor = active_monitors.get(camera_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open stream"
        logger.error(f"Camera {camera_id}: Cannot open stream")
        return

    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    detector = VehicleDetector(model_name)
    tracker = VehicleTracker(frame_height)

    monitor["status"] = "running"
    monitor["_line_y"] = frame_height // 2
    logger.info(f"Camera {camera_id}: Live monitoring started (model={model_name or settings.yolo_model})")

    reader = FrameReader(cap)
    frame_idx = 0
    last_frame_time = time.time()
    reconnect_attempts = 0
    db = SessionLocal()
    tz = ZoneInfo(settings.timezone)
    batch_counts: dict[str, int] = defaultdict(int)
    last_save = datetime.now(tz)

    try:
        while monitor.get("status") == "running":
            frame = reader.read(timeout=FRAME_QUEUE_TIMEOUT)

            if frame is None:
                if time.time() - last_frame_time < STREAM_DEAD_TIMEOUT:
                    continue

                reader.stop()
                reconnect_attempts += 1

                if reconnect_attempts > MAX_RECONNECT_ATTEMPTS:
                    logger.error(f"Camera {camera_id}: Max reconnect attempts reached")
                    monitor["status"] = "error"
                    monitor["error"] = "Stream disconnected after max retries"
                    break

                # Exponential backoff: 3, 6, 12, 24, 48, 60, 60, ...
                delay = min(RECONNECT_DELAY_BASE * (2 ** (reconnect_attempts - 1)), RECONNECT_DELAY_MAX)
                logger.warning(
                    f"Camera {camera_id}: Stream dead, reconnecting "
                    f"({reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}), "
                    f"waiting {delay}s..."
                )
                time.sleep(delay)

                if monitor.get("status") != "running":
                    break

                try:
                    stream_url = _get_stream_url(youtube_url)
                except Exception as e:
                    logger.error(f"Camera {camera_id}: yt-dlp failed: {e}")
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

            # === EVERY FRAME: detect → track → count ===
            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)
            raw_dets = detector.detect(small)
            for d in raw_dets:
                d["bbox"] = [v / scale for v in d["bbox"]]

            tracked = tracker.update(raw_dets)
            now = datetime.now(tz)

            # Save detections to DB
            for det in tracked:
                db.add(DetectionEvent(
                    camera_id=camera_id,
                    vehicle_type=det["vehicle_type"],
                    confidence=det["confidence"],
                    timestamp=now,
                ))
                batch_counts[det["vehicle_type"]] += 1

            # Update live stats
            in_count, out_count = tracker.get_line_counts()
            monitor["frame_count"] = frame_idx
            monitor["detections_total"] = sum(batch_counts.values())
            monitor["vehicle_counts"] = dict(batch_counts)
            monitor["line_in"] = in_count
            monitor["line_out"] = out_count
            monitor["last_update"] = now.isoformat()

            # WebSocket message
            if tracked:
                ws_data = {
                    "type": "live_detection",
                    "camera_id": camera_id,
                    "timestamp": now.isoformat(),
                    "detections": [
                        {
                            "vehicle_type": d["vehicle_type"],
                            "confidence": round(d["confidence"], 3),
                        }
                        for d in tracked
                    ],
                    "totals": dict(batch_counts),
                    "line_in": in_count,
                    "line_out": out_count,
                }
                monitor["_ws_queue"].append(ws_data)

            # Save to DB every 10 seconds
            if (now - last_save).total_seconds() >= 10:
                db.commit()
                last_save = now

            # === DISPLAY: only when someone is watching ===
            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            if monitor.get("_raw_requested"):
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
                monitor["_raw_frame"] = buf.tobytes()

            _draw_detections(frame, tracked, monitor["_line_y"])

            y_offset = 30
            for vtype, cnt in batch_counts.items():
                color = BBOX_COLORS.get(vtype, (128, 128, 128))
                cv2.putText(frame, f"{vtype}: {cnt}", (10, y_offset),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
                y_offset += 25

            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            monitor["_annotated_frame"] = buf.tobytes()

            monitor["_frame_seq"] = monitor.get("_frame_seq", 0) + 1
            frame_event = monitor.get("_frame_event")
            if frame_event:
                frame_event.set()

    except Exception as e:
        logger.error(f"Camera {camera_id}: Error - {e}")
        monitor["status"] = "error"
        monitor["error"] = str(e)
    finally:
        reader.stop()
        now = datetime.now(tz)
        for vtype, count in batch_counts.items():
            db.add(TrafficCount(
                camera_id=camera_id,
                vehicle_type=vtype,
                count=count,
                timestamp=now,
            ))
        db.commit()
        db.close()

        if monitor.get("status") == "running":
            monitor["status"] = "stopped"
        logger.info(f"Camera {camera_id}: Live monitoring stopped")


async def start_monitor(camera_id: int, youtube_url: str, model_name: str | None = None) -> dict:
    if camera_id in active_monitors and active_monitors[camera_id]["status"] == "running":
        return {"error": "Already monitoring this camera"}

    stream_url = _get_stream_url(youtube_url)

    monitor = {
        "camera_id": camera_id,
        "youtube_url": youtube_url,
        "model_name": model_name or settings.yolo_model,
        "status": "starting",
        "frame_count": 0,
        "detections_total": 0,
        "vehicle_counts": {},
        "line_in": 0,
        "line_out": 0,
        "last_update": None,
        "_ws_queue": [],
        "_annotated_frame": None,
        "_raw_frame": None,
        "_line_y": 0,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_raw_requested": False,
        "_viewers": 0,
    }
    active_monitors[camera_id] = monitor

    thread = threading.Thread(
        target=_monitor_loop,
        args=(camera_id, youtube_url, stream_url, None, model_name),
        daemon=True,
    )
    thread.start()
    monitor["_thread"] = thread

    return {"camera_id": camera_id, "status": "starting"}


def stop_monitor(camera_id: int) -> dict:
    monitor = active_monitors.get(camera_id)
    if not monitor:
        return {"error": "No active monitor for this camera"}

    # Signal the monitor loop to stop (non-blocking)
    monitor["status"] = "stopping"

    # Clean up in background to avoid blocking API
    def _cleanup():
        thread = monitor.get("_thread")
        if thread and thread.is_alive():
            thread.join(timeout=20)
        active_monitors.pop(camera_id, None)
        logger.info(f"Camera {camera_id}: Cleaned up")

    threading.Thread(target=_cleanup, daemon=True).start()

    return {"camera_id": camera_id, "status": "stopping"}


def stop_all_monitors():
    """Stop all active monitors - used during app shutdown."""
    for camera_id in list(active_monitors.keys()):
        monitor = active_monitors.get(camera_id)
        if monitor:
            monitor["status"] = "stopping"
            logger.info(f"Stopping monitor for camera {camera_id}")

    for camera_id in list(active_monitors.keys()):
        monitor = active_monitors.get(camera_id)
        if monitor:
            thread = monitor.get("_thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)

    active_monitors.clear()
    logger.info("All monitors stopped")


def get_monitor_status(camera_id: int) -> dict | None:
    monitor = active_monitors.get(camera_id)
    if not monitor:
        return None
    return {
        "camera_id": monitor["camera_id"],
        "youtube_url": monitor.get("youtube_url"),
        "model_name": monitor.get("model_name", settings.yolo_model),
        "status": monitor["status"],
        "frame_count": monitor["frame_count"],
        "detections_total": monitor["detections_total"],
        "vehicle_counts": monitor["vehicle_counts"],
        "line_in": monitor["line_in"],
        "line_out": monitor["line_out"],
        "last_update": monitor["last_update"],
    }


def get_all_monitors() -> list[dict]:
    return [get_monitor_status(cid) for cid in active_monitors]
