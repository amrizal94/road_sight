"""
Bus seat detection monitor — detects occupied/free seats via an overhead
interior camera. One polygon per seat (drawn in Seat Editor).
Keys: bus_id (int) — independent from bus_monitors.
"""
import logging
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from .slot_classifier import get_slot_classifier, load_slot_classifier
from ..config import settings
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

bus_seat_monitors: dict[int, dict] = {}

_COL_FREE = (0, 200, 0)
_COL_OCC  = (0, 0, 220)

CNN_HIGH = 0.75
CNN_LOW  = 0.25
BG_DIFF_THRESHOLD = 35
MIN_OCCUPIED_RATIO = 0.15
TEXTURE_THRESHOLD = 150.0
DETECT_EVERY_N = 5


def _resolve_url(url: str) -> str:
    if "youtube" in url or "youtu.be" in url:
        return _get_stream_url(url)
    return url


def _build_polygon_mask(polygon: list[list[float]], shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape[:2], dtype=np.uint8)
    pts = np.array(polygon, dtype=np.int32)
    cv2.fillPoly(mask, [pts], 255)
    return mask


def _check_occupied_bg(frame_gray: np.ndarray, ref_gray: np.ndarray,
                       mask: np.ndarray) -> bool:
    diff = cv2.absdiff(frame_gray, ref_gray)
    diff_masked = cv2.bitwise_and(diff, diff, mask=mask)
    pixel_count = int(np.sum(mask > 0))
    if pixel_count == 0:
        return False
    mean_diff = float(np.sum(diff_masked)) / pixel_count
    hot_pixels = int(np.sum(
        (diff_masked > BG_DIFF_THRESHOLD // 2).astype(np.uint8) & (mask > 0)
    ))
    hot_ratio = hot_pixels / pixel_count
    return mean_diff > BG_DIFF_THRESHOLD and hot_ratio > MIN_OCCUPIED_RATIO


def _check_occupied_texture(frame_gray: np.ndarray, mask: np.ndarray) -> bool:
    pixel_count = int(np.sum(mask > 0))
    if pixel_count == 0:
        return False
    lap = cv2.Laplacian(frame_gray, cv2.CV_64F)
    lap_sq = lap ** 2
    variance = float(np.sum(lap_sq[mask > 0])) / pixel_count
    return variance > TEXTURE_THRESHOLD


def _crop_seat(frame: np.ndarray, polygon: list[list[float]]) -> np.ndarray:
    pts = np.array(polygon, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(pts)
    fh, fw = frame.shape[:2]
    cx = x + w // 2
    cy = y + h // 2
    half = max(w, h) // 2 + 8
    x1 = max(0, cx - half)
    y1 = max(0, cy - half)
    x2 = min(fw, cx + half)
    y2 = min(fh, cy + half)
    return frame[y1:y2, x1:x2]


def _detect_seat(frame: np.ndarray, frame_gray: np.ndarray,
                 ref_gray: np.ndarray | None, seat: dict) -> bool:
    mask = seat["_mask"]

    classifier = get_slot_classifier()
    if classifier is not None:
        crop = _crop_seat(frame, seat["polygon"])
        if crop.size > 0:
            conf = classifier.predict(crop)
            if conf > CNN_HIGH:
                return True
            if conf < CNN_LOW:
                return False

    if ref_gray is not None and mask is not None:
        return _check_occupied_bg(frame_gray, ref_gray, mask)

    if mask is not None:
        return _check_occupied_texture(frame_gray, mask)

    return False


def _draw_seats(frame: np.ndarray, seats: list[dict]) -> None:
    overlay = frame.copy()
    for seat in seats:
        pts = np.array(seat["polygon"], dtype=np.int32)
        color = _COL_OCC if seat["occupied"] else _COL_FREE
        cv2.fillPoly(overlay, [pts], color)
    cv2.addWeighted(overlay, 0.35, frame, 0.65, 0, frame)

    for seat in seats:
        pts = np.array(seat["polygon"], dtype=np.int32)
        color = _COL_OCC if seat["occupied"] else _COL_FREE
        cv2.polylines(frame, [pts], True, color, 2)
        cx = int(np.mean(pts[:, 0]))
        cy = int(np.mean(pts[:, 1]))
        label = seat["label"]
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(frame, (cx - tw // 2 - 3, cy - th - 5),
                      (cx + tw // 2 + 3, cy + 3), (0, 0, 0), -1)
        cv2.putText(frame, label, (cx - tw // 2, cy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)


def _seat_monitor_loop(bus_id: int, seats_data: list[dict],
                       overhead_url: str, stream_url: str):
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open overhead stream"
        logger.error(f"Seat monitor bus {bus_id}: Cannot open stream")
        return

    if monitor.get("status") == "stopping":
        cap.release()
        return

    monitor["status"] = "running"
    cnn_active = get_slot_classifier() is not None
    logger.info(
        f"Seat monitor bus {bus_id}: started — {len(seats_data)} seats "
        f"({'CNN+fallback' if cnn_active else 'background/texture'})"
    )

    seat_states: list[dict] = []
    for s in seats_data:
        seat_states.append({
            "seat_id": s["seat_id"],
            "label": s["label"],
            "polygon": s["polygon"],
            "occupied": False,
            "_mask": None,
        })
    monitor["seats"] = _export_seats(seat_states)

    reader = FrameReader(cap)
    last_frame_time = time.time()
    reconnect_attempts = 0
    reference_gray: np.ndarray | None = None
    frame_count = 0

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
                logger.warning(f"Seat monitor bus {bus_id}: Reconnect {reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}, wait {delay}s")
                time.sleep(delay)
                if monitor.get("status") != "running":
                    break

                try:
                    stream_url = _resolve_url(overhead_url)
                except Exception as e:
                    logger.error(f"Seat monitor bus {bus_id}: URL resolve failed: {e}")
                    continue
                cap = _open_capture(stream_url)
                if not cap.isOpened():
                    continue
                reader = FrameReader(cap)
                last_frame_time = time.time()
                reference_gray = None
                continue

            last_frame_time = time.time()
            reconnect_attempts = 0
            frame_count += 1

            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, None, fx=scale, fy=scale)
                h, w = frame.shape[:2]

            frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            frame_gray = cv2.GaussianBlur(frame_gray, (5, 5), 0)

            if seat_states[0]["_mask"] is None:
                for seat in seat_states:
                    seat["_mask"] = _build_polygon_mask(seat["polygon"], frame.shape)

            if monitor.get("_capture_reference"):
                monitor["_capture_reference"] = False
                reference_gray = frame_gray.copy()
                monitor["has_reference"] = True
                monitor["reference_captured_at"] = datetime.now().isoformat()
                logger.info(f"Seat monitor bus {bus_id}: reference frame captured")
                continue

            run_detection = (frame_count % DETECT_EVERY_N == 0)
            if run_detection:
                has_cnn = get_slot_classifier() is not None
                has_ref = reference_gray is not None
                if has_cnn:
                    monitor["detection_mode"] = "cnn+background" if has_ref else "cnn"
                else:
                    monitor["detection_mode"] = "background" if has_ref else "texture"

                for seat in seat_states:
                    if seat["_mask"] is None:
                        continue
                    seat["occupied"] = _detect_seat(frame, frame_gray, reference_gray, seat)

                occ = sum(1 for s in seat_states if s["occupied"])
                free = len(seat_states) - occ

                monitor["occupied_count"] = occ
                monitor["free_count"] = free
                monitor["total_count"] = len(seat_states)
                monitor["last_update"] = datetime.now().isoformat()
                monitor["seats"] = _export_seats(seat_states)

            _, raw_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            monitor["_raw_frame"] = raw_buf.tobytes()

            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            vis = frame.copy()
            _draw_seats(vis, seat_states)
            _occ = monitor["occupied_count"]
            _free = monitor["free_count"]
            cv2.putText(vis, f"TERISI: {_occ}/{len(seat_states)}  KOSONG: {_free}",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            if monitor.get("has_reference"):
                cv2.putText(vis, "REF OK", (10, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

            _, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 55])
            monitor["_annotated_frame"] = buf.tobytes()
            monitor["_frame_seq"] = monitor.get("_frame_seq", 0) + 1
            event = monitor.get("_frame_event")
            if event:
                event.set()

    except Exception as e:
        logger.error(f"Seat monitor bus {bus_id}: Error — {e}")
        monitor["status"] = "error"
        monitor["error"] = str(e)
    finally:
        reader.stop()
        if monitor.get("status") == "running":
            monitor["status"] = "stopped"
        logger.info(f"Seat monitor bus {bus_id}: stopped")


def _export_seats(seat_states: list[dict]) -> list[dict]:
    return [
        {"seat_id": s["seat_id"], "label": s["label"],
         "occupied": s["occupied"], "polygon": s["polygon"]}
        for s in seat_states
    ]


async def start_bus_seat_monitor(bus_id: int, seats_data: list[dict],
                                  overhead_url: str) -> dict:
    if bus_id in bus_seat_monitors and bus_seat_monitors[bus_id]["status"] in ("running", "starting"):
        return {"error": "Already monitoring seats for this bus"}

    if get_slot_classifier() is None:
        load_slot_classifier(settings.parking_cnn_model)

    stream_url = _resolve_url(overhead_url)
    total = len(seats_data)

    monitor = {
        "bus_id": bus_id,
        "status": "starting",
        "occupied_count": 0,
        "free_count": total,
        "total_count": total,
        "seats": [],
        "last_update": None,
        "error": None,
        "has_reference": False,
        "reference_captured_at": None,
        "_capture_reference": False,
        "_annotated_frame": None,
        "_raw_frame": None,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    bus_seat_monitors[bus_id] = monitor

    thread = threading.Thread(
        target=_seat_monitor_loop,
        args=(bus_id, seats_data, overhead_url, stream_url),
        daemon=True,
    )
    thread.start()
    monitor["_thread"] = thread

    return {"bus_id": bus_id, "status": "starting"}


def stop_bus_seat_monitor(bus_id: int) -> dict:
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor:
        return {"error": "No active seat monitor for this bus"}
    monitor["status"] = "stopping"

    def _cleanup():
        thread = monitor.get("_thread")
        if thread and thread.is_alive():
            thread.join(timeout=20)
        bus_seat_monitors.pop(bus_id, None)

    threading.Thread(target=_cleanup, daemon=True).start()
    return {"bus_id": bus_id, "status": "stopping"}


def recapture_seat_reference(bus_id: int) -> dict:
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor or monitor["status"] != "running":
        return {"error": "No running seat monitor for this bus"}
    monitor["_capture_reference"] = True
    return {"bus_id": bus_id, "message": "Reference frame will be re-captured on next frame"}


def get_bus_seat_monitor_status(bus_id: int) -> dict | None:
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor:
        return None
    return {
        "bus_id": monitor["bus_id"],
        "status": monitor["status"],
        "occupied_count": monitor["occupied_count"],
        "free_count": monitor["free_count"],
        "total_count": monitor["total_count"],
        "seats": monitor.get("seats", []),
        "last_update": monitor.get("last_update"),
        "has_reference": monitor.get("has_reference", False),
        "reference_captured_at": monitor.get("reference_captured_at"),
        "detection_mode": monitor.get("detection_mode", "texture"),
        "error": monitor.get("error"),
    }


def stop_all_bus_seat_monitors():
    for bus_id in list(bus_seat_monitors.keys()):
        monitor = bus_seat_monitors.get(bus_id)
        if monitor:
            monitor["status"] = "stopping"
    for bus_id in list(bus_seat_monitors.keys()):
        monitor = bus_seat_monitors.get(bus_id)
        if monitor:
            thread = monitor.get("_thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)
    bus_seat_monitors.clear()
    logger.info("All bus seat monitors stopped")
