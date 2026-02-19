"""
Independent space detection monitor — uses overhead camera to detect occupied/free slots.
Keys: lot_id (int).  Does NOT conflict with gate monitor or traffic monitor.
Polygons are stored in natural-image pixel coordinates (matched to frame resolution).
"""
import logging
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from ..config import settings
from .detector import VehicleDetector
from .live_monitor import (
    FRAME_QUEUE_TIMEOUT,
    MAX_RECONNECT_ATTEMPTS,
    RECONNECT_DELAY_BASE,
    RECONNECT_DELAY_MAX,
    STREAM_DEAD_TIMEOUT,
    FrameReader,
    _get_stream_url,
    _open_capture,
)

logger = logging.getLogger(__name__)

# Independent dict — keyed by lot_id, no overlap with parking_monitors or active_monitors
space_monitors: dict[int, dict] = {}

# Overlay colours (BGR)
_COL_FREE = (0, 200, 0)   # green
_COL_OCC  = (0, 0, 220)   # red


def _resolve_url(url: str) -> str:
    """Use yt-dlp only for YouTube URLs; return other URLs (RTSP, HTTP) as-is."""
    if "youtube" in url or "youtu.be" in url:
        return _get_stream_url(url)
    return url


def _point_in_polygon(point: tuple[float, float], polygon: list[list[float]]) -> bool:
    pts = np.array(polygon, dtype=np.int32)
    return cv2.pointPolygonTest(pts, point, False) >= 0


def _draw_spaces(frame: np.ndarray, spaces: list[dict]) -> None:
    """Draw semi-transparent polygon overlays and labels on frame (in-place)."""
    overlay = frame.copy()
    for sp in spaces:
        pts = np.array(sp["polygon"], dtype=np.int32)
        color = _COL_OCC if sp["occupied"] else _COL_FREE
        cv2.fillPoly(overlay, [pts], color)
    cv2.addWeighted(overlay, 0.35, frame, 0.65, 0, frame)

    for sp in spaces:
        pts = np.array(sp["polygon"], dtype=np.int32)
        color = _COL_OCC if sp["occupied"] else _COL_FREE
        cv2.polylines(frame, [pts], True, color, 2)
        cx = int(np.mean(pts[:, 0]))
        cy = int(np.mean(pts[:, 1]))
        label = sp["label"]
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(frame, (cx - tw // 2 - 3, cy - th - 5), (cx + tw // 2 + 3, cy + 3), (0, 0, 0), -1)
        cv2.putText(frame, label, (cx - tw // 2, cy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)


def _space_monitor_loop(lot_id: int, spaces_data: list[dict],
                        overhead_url: str, stream_url: str, model_name: str | None):
    monitor = space_monitors.get(lot_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open overhead stream"
        logger.error(f"Space monitor lot {lot_id}: Cannot open stream")
        return

    detector = VehicleDetector(model_name)

    # Guard: stop may have been requested while model was loading
    if monitor.get("status") == "stopping":
        cap.release()
        return
    monitor["status"] = "running"
    logger.info(f"Space monitor lot {lot_id}: started — {len(spaces_data)} spaces, model={model_name or settings.yolo_model}")

    # Build mutable space state list
    space_states = [
        {
            "space_id": sp["space_id"],
            "label": sp["label"],
            "polygon": sp["polygon"],
            "occupied": False,
        }
        for sp in spaces_data
    ]
    monitor["spaces"] = _export_spaces(space_states)

    reader = FrameReader(cap)
    last_frame_time = time.time()
    reconnect_attempts = 0

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
                logger.warning(f"Space monitor lot {lot_id}: Reconnecting ({reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}), waiting {delay}s...")
                time.sleep(delay)

                if monitor.get("status") != "running":
                    break

                try:
                    stream_url = _resolve_url(overhead_url)
                except Exception as e:
                    logger.error(f"Space monitor lot {lot_id}: URL resolve failed: {e}")
                    continue

                cap = _open_capture(stream_url)
                if not cap.isOpened():
                    continue
                reader = FrameReader(cap)
                last_frame_time = time.time()
                continue

            last_frame_time = time.time()
            reconnect_attempts = 0

            # --- Detect vehicles ---
            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)
            raw_dets = detector.detect(small)

            # Scale detections back to original frame size
            boxes = []
            for d in raw_dets:
                x1, y1, x2, y2 = [v / scale for v in d["bbox"]]
                boxes.append((x1, y1, x2, y2))

            # --- Check each space ---
            for sp in space_states:
                poly = sp["polygon"]
                occupied = False
                for (x1, y1, x2, y2) in boxes:
                    # Use bottom-center of bounding box as anchor point
                    bx = (x1 + x2) / 2.0
                    by = y2
                    if _point_in_polygon((bx, by), poly):
                        occupied = True
                        break
                sp["occupied"] = occupied

            occ = sum(1 for sp in space_states if sp["occupied"])
            free = len(space_states) - occ

            monitor["occupied_count"] = occ
            monitor["free_count"] = free
            monitor["total_count"] = len(space_states)
            monitor["last_update"] = datetime.now().isoformat()
            monitor["spaces"] = _export_spaces(space_states)

            # --- Render MJPEG frame only if viewers are connected ---
            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            _draw_spaces(frame, space_states)
            cv2.putText(frame, f"OCC: {occ}/{len(space_states)}  FREE: {free}",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            monitor["_annotated_frame"] = buf.tobytes()
            monitor["_frame_seq"] = monitor.get("_frame_seq", 0) + 1
            event = monitor.get("_frame_event")
            if event:
                event.set()

    except Exception as e:
        logger.error(f"Space monitor lot {lot_id}: Error — {e}")
        monitor["status"] = "error"
        monitor["error"] = str(e)
    finally:
        reader.stop()
        if monitor.get("status") == "running":
            monitor["status"] = "stopped"
        logger.info(f"Space monitor lot {lot_id}: stopped")


def _export_spaces(space_states: list[dict]) -> list[dict]:
    return [
        {
            "space_id": sp["space_id"],
            "label": sp["label"],
            "occupied": sp["occupied"],
            "polygon": sp["polygon"],
        }
        for sp in space_states
    ]


async def start_space_monitor(lot_id: int, spaces_data: list[dict],
                               overhead_url: str, model_name: str | None = None) -> dict:
    if lot_id in space_monitors and space_monitors[lot_id]["status"] in ("running", "starting"):
        return {"error": "Already monitoring spaces for this parking lot"}

    stream_url = _resolve_url(overhead_url)

    total = len(spaces_data)
    monitor = {
        "lot_id": lot_id,
        "status": "starting",
        "occupied_count": 0,
        "free_count": total,
        "total_count": total,
        "spaces": [],
        "last_update": None,
        "error": None,
        "_annotated_frame": None,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    space_monitors[lot_id] = monitor

    thread = threading.Thread(
        target=_space_monitor_loop,
        args=(lot_id, spaces_data, overhead_url, stream_url, model_name),
        daemon=True,
    )
    thread.start()
    monitor["_thread"] = thread

    return {"lot_id": lot_id, "status": "starting"}


def stop_space_monitor(lot_id: int) -> dict:
    monitor = space_monitors.get(lot_id)
    if not monitor:
        return {"error": "No active space monitor for this parking lot"}

    monitor["status"] = "stopping"

    def _cleanup():
        thread = monitor.get("_thread")
        if thread and thread.is_alive():
            thread.join(timeout=20)
        space_monitors.pop(lot_id, None)

    threading.Thread(target=_cleanup, daemon=True).start()
    return {"lot_id": lot_id, "status": "stopping"}


def get_space_monitor_status(lot_id: int) -> dict | None:
    monitor = space_monitors.get(lot_id)
    if not monitor:
        return None
    return {
        "lot_id": monitor["lot_id"],
        "status": monitor["status"],
        "occupied_count": monitor["occupied_count"],
        "free_count": monitor["free_count"],
        "total_count": monitor["total_count"],
        "spaces": monitor.get("spaces", []),
        "last_update": monitor.get("last_update"),
        "error": monitor.get("error"),
    }


def stop_all_space_monitors():
    for lot_id in list(space_monitors.keys()):
        monitor = space_monitors.get(lot_id)
        if monitor:
            monitor["status"] = "stopping"
    for lot_id in list(space_monitors.keys()):
        monitor = space_monitors.get(lot_id)
        if monitor:
            thread = monitor.get("_thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)
    space_monitors.clear()
    logger.info("All space monitors stopped")
