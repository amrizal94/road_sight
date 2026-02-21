"""
Parking space detection monitor using background subtraction.
Each parking space is a polygon drawn on an overhead frame.
A space is "occupied" when its pixel difference from the reference
(empty-lot) frame exceeds a threshold.

Keys: lot_id (int) — independent from gate monitor and traffic monitor.
"""
import logging
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from ..config import settings
from .slot_classifier import get_slot_classifier, load_slot_classifier
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

space_monitors: dict[int, dict] = {}

# Overlay colours (BGR)
_COL_FREE = (0, 200, 0)   # green
_COL_OCC  = (0, 0, 220)   # red

# ── CNN classifier thresholds ────────────────────────────────────────────────
CNN_HIGH = 0.75   # conf > CNN_HIGH  → occupied (confident)
CNN_LOW  = 0.25   # conf < CNN_LOW   → free (confident)
# 0.25 ≤ conf ≤ 0.75 → uncertain, fall through to next layer

# ── Background subtraction (requires empty reference frame) ──────────────────
BG_DIFF_THRESHOLD = 35    # mean absolute pixel difference
MIN_OCCUPIED_RATIO = 0.15  # at least 15% of slot pixels must differ

# ── Texture analysis (Laplacian variance — no reference needed) ───────────────
# Cars have high edge complexity; empty slots are uniform concrete/asphalt.
# Tune this value: raise if too many false positives, lower if misses cars.
TEXTURE_THRESHOLD = 150.0

# ── Frame-skip: run detection every N frames, render MJPEG every frame ────────
# CNN is expensive (~200-700ms/frame on CPU). Skipping 4/5 detection frames
# keeps MJPEG smooth while still updating slot states ~4-6x per second.
# Raise DETECT_EVERY_N on slow hardware; lower it on fast hardware.
DETECT_EVERY_N = 5


def _resolve_url(url: str) -> str:
    """Use yt-dlp for YouTube URLs; return RTSP/HTTP URLs as-is."""
    if "youtube" in url or "youtu.be" in url:
        return _get_stream_url(url)
    return url


def _build_polygon_mask(polygon: list[list[float]], shape: tuple[int, int]) -> np.ndarray:
    """Binary mask (uint8) for the given polygon on a frame of given (h, w)."""
    mask = np.zeros(shape[:2], dtype=np.uint8)
    pts = np.array(polygon, dtype=np.int32)
    cv2.fillPoly(mask, [pts], 255)
    return mask


def _check_occupied_bg(frame_gray: np.ndarray,
                       ref_gray: np.ndarray,
                       mask: np.ndarray) -> bool:
    """
    Background subtraction: compare current frame to empty-lot reference.
    More accurate but requires a reference frame captured when lot is empty.
    """
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
    """
    Texture / Laplacian variance method — no reference frame needed.
    Cars have high edge complexity; empty asphalt/concrete is uniform.
    Works well for overhead parking videos (YouTube, RTSP, etc.).
    """
    pixel_count = int(np.sum(mask > 0))
    if pixel_count == 0:
        return False

    # Laplacian = second derivative → high value = lots of edges/texture
    lap = cv2.Laplacian(frame_gray, cv2.CV_64F)
    lap_sq = lap ** 2
    # Only within the slot polygon
    variance = float(np.sum(lap_sq[mask > 0])) / pixel_count
    return variance > TEXTURE_THRESHOLD


def _crop_slot(frame: np.ndarray, polygon: list[list[float]]) -> np.ndarray:
    """
    Square crop centered on the slot polygon centroid.
    Uses the longer side of the bounding rect as the square size,
    so the CNN always receives a near-square input regardless of
    how narrow/tall the drawn polygon is.
    """
    pts = np.array(polygon, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(pts)
    fh, fw = frame.shape[:2]

    cx = x + w // 2
    cy = y + h // 2
    half = max(w, h) // 2 + 8   # +8 px context padding

    x1 = max(0, cx - half)
    y1 = max(0, cy - half)
    x2 = min(fw, cx + half)
    y2 = min(fh, cy + half)
    return frame[y1:y2, x1:x2]


def _detect_slot(
    frame: np.ndarray,
    frame_gray: np.ndarray,
    ref_gray: np.ndarray | None,
    sp: dict,
) -> bool:
    """
    Hybrid 3-layer detection for a single slot.

    Layer 1 — CNN (MobileNetV3-Small):
        conf > CNN_HIGH  → occupied
        conf < CNN_LOW   → free
        uncertain        → fall through

    Layer 2 — Background subtraction (if reference available):
        Uses pixel diff against empty-lot reference frame.

    Layer 3 — Texture / Laplacian variance (always available):
        Last resort; no reference needed.
    """
    mask = sp["_mask"]

    # Layer 1: CNN classifier
    classifier = get_slot_classifier()
    if classifier is not None:
        crop = _crop_slot(frame, sp["polygon"])
        if crop.size > 0:
            conf = classifier.predict(crop)
            if conf > CNN_HIGH:
                return True
            if conf < CNN_LOW:
                return False
            # uncertain → fall through to next layer

    # Layer 2: Background subtraction
    if ref_gray is not None and mask is not None:
        return _check_occupied_bg(frame_gray, ref_gray, mask)

    # Layer 3: Texture analysis
    if mask is not None:
        return _check_occupied_texture(frame_gray, mask)

    return False


def _draw_spaces(frame: np.ndarray, spaces: list[dict]) -> None:
    """Semi-transparent polygon overlays + labels (in-place)."""
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
        cv2.rectangle(frame, (cx - tw // 2 - 3, cy - th - 5),
                      (cx + tw // 2 + 3, cy + 3), (0, 0, 0), -1)
        cv2.putText(frame, label, (cx - tw // 2, cy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)


def _space_monitor_loop(lot_id: int, spaces_data: list[dict],
                        overhead_url: str, stream_url: str):
    monitor = space_monitors.get(lot_id)
    if not monitor:
        return

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        monitor["status"] = "error"
        monitor["error"] = "Cannot open overhead stream"
        logger.error(f"Space monitor lot {lot_id}: Cannot open stream")
        return

    if monitor.get("status") == "stopping":
        cap.release()
        return

    monitor["status"] = "running"
    cnn_active = get_slot_classifier() is not None
    logger.info(
        f"Space monitor lot {lot_id}: started — {len(spaces_data)} spaces "
        f"({'CNN+fallback' if cnn_active else 'background/texture'})"
    )

    # Temporal smoothing: only flip status after CONFIRM_FRAMES consecutive detections
    CONFIRM_FRAMES = 3

    # Build mutable space state with polygon masks
    space_states: list[dict] = []
    for sp in spaces_data:
        space_states.append({
            "space_id": sp["space_id"],
            "label": sp["label"],
            "polygon": sp["polygon"],
            "occupied": False,
            "_mask": None,        # built on first frame
            "_pending": False,    # candidate new status
            "_streak": 0,         # consecutive frames with _pending result
        })
    monitor["spaces"] = _export_spaces(space_states)

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
                logger.warning(f"Space monitor lot {lot_id}: Reconnect {reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS}, wait {delay}s")
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
                reference_gray = None   # re-capture after reconnect
                continue

            last_frame_time = time.time()
            reconnect_attempts = 0
            frame_count += 1

            # Resize to standard width for consistent processing
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, None, fx=scale, fy=scale)
                h, w = frame.shape[:2]

            frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            frame_gray = cv2.GaussianBlur(frame_gray, (5, 5), 0)

            # Build polygon masks on first usable frame
            if space_states[0]["_mask"] is None:
                for sp in space_states:
                    sp["_mask"] = _build_polygon_mask(sp["polygon"], frame.shape)

            # Capture reference only when user explicitly requests it
            if monitor.get("_capture_reference"):
                monitor["_capture_reference"] = False
                reference_gray = frame_gray.copy()
                monitor["has_reference"] = True
                monitor["reference_captured_at"] = datetime.now().isoformat()
                logger.info(f"Space monitor lot {lot_id}: reference frame captured")
                continue  # skip detection on capture frame

            # --- Detection (throttled to every DETECT_EVERY_N frames) ---
            run_detection = (frame_count % DETECT_EVERY_N == 0)
            if run_detection:
                has_cnn = get_slot_classifier() is not None
                has_ref = reference_gray is not None
                if has_cnn:
                    monitor["detection_mode"] = "cnn+background" if has_ref else "cnn"
                else:
                    monitor["detection_mode"] = "background" if has_ref else "texture"
                for sp in space_states:
                    if sp["_mask"] is None:
                        continue
                    raw = _detect_slot(frame, frame_gray, reference_gray, sp)
                    if raw == sp["_pending"]:
                        sp["_streak"] += 1
                    else:
                        sp["_pending"] = raw
                        sp["_streak"] = 1
                    # Only commit status change after CONFIRM_FRAMES consistent frames
                    if sp["_streak"] >= CONFIRM_FRAMES:
                        sp["occupied"] = raw

                occ = sum(1 for sp in space_states if sp["occupied"])
                free = len(space_states) - occ

                monitor["occupied_count"] = occ
                monitor["free_count"] = free
                monitor["total_count"] = len(space_states)
                monitor["last_update"] = datetime.now().isoformat()
                monitor["spaces"] = _export_spaces(space_states)

            # Always save a clean (un-annotated) frame for SpaceEditor snapshotting
            _, raw_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            monitor["_raw_frame"] = raw_buf.tobytes()

            # --- Render MJPEG only if viewers connected ---
            has_viewers = monitor.get("_viewers", 0) > 0
            if not has_viewers:
                continue

            vis = frame.copy()
            _draw_spaces(vis, space_states)
            _occ = monitor["occupied_count"]
            _free = monitor["free_count"]
            cv2.putText(vis, f"OCC: {_occ}/{len(space_states)}  FREE: {_free}",
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
        {"space_id": sp["space_id"], "label": sp["label"],
         "occupied": sp["occupied"], "polygon": sp["polygon"]}
        for sp in space_states
    ]


async def start_space_monitor(lot_id: int, spaces_data: list[dict],
                               overhead_url: str, model_name: str | None = None) -> dict:
    if lot_id in space_monitors and space_monitors[lot_id]["status"] in ("running", "starting"):
        return {"error": "Already monitoring spaces for this parking lot"}

    # Try to load CNN classifier (no-op if already loaded or path not configured)
    if get_slot_classifier() is None:
        load_slot_classifier(settings.parking_cnn_model)

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
        "has_reference": False,
        "reference_captured_at": None,
        "_capture_reference": False,
        "_annotated_frame": None,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
        "_viewers": 0,
    }
    space_monitors[lot_id] = monitor

    thread = threading.Thread(
        target=_space_monitor_loop,
        args=(lot_id, spaces_data, overhead_url, stream_url),
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


def recapture_reference(lot_id: int) -> dict:
    """Signal the monitor to re-capture a new reference frame."""
    monitor = space_monitors.get(lot_id)
    if not monitor or monitor["status"] != "running":
        return {"error": "No running space monitor for this lot"}
    monitor["_capture_reference"] = True
    return {"lot_id": lot_id, "message": "Reference frame will be re-captured on next frame"}


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
        "has_reference": monitor.get("has_reference", False),
        "reference_captured_at": monitor.get("reference_captured_at"),
        "detection_mode": monitor.get("detection_mode", "texture"),
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
