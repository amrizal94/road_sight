"""
Bus video test service — process an uploaded MP4 file for passenger counting
accuracy testing. Results stored in-memory; no DB writes.
"""
import logging
import os
import threading
import time

import cv2
import supervision as sv

from ..config import settings
from .bus_monitor import _draw_bus_frame
from .detector import PersonDetector
from .tracker import VehicleTracker

logger = logging.getLogger(__name__)

bus_video_tests: dict[str, dict] = {}   # keyed by job_id (UUID)

_AUTO_EXPIRE_SECONDS = 30 * 60  # 30 minutes


def cleanup_old_tests() -> None:
    """Remove jobs older than 30 minutes and delete their video files."""
    now = time.time()
    for job_id in list(bus_video_tests.keys()):
        test = bus_video_tests.get(job_id)
        if test and (now - test.get("created_at", now)) > _AUTO_EXPIRE_SECONDS:
            cleanup_test(job_id)


def cleanup_test(job_id: str) -> None:
    """Stop a job (if running), delete its file, and remove from dict."""
    test = bus_video_tests.pop(job_id, None)
    if not test:
        return
    if test.get("status") in ("processing",):
        test["status"] = "stopping"
    file_path = test.get("file_path", "")
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            logger.warning(f"VideoTest {job_id}: failed to delete file {file_path}: {e}")


def get_test_status(job_id: str) -> dict | None:
    test = bus_video_tests.get(job_id)
    if not test:
        return None
    return {
        "job_id": test["job_id"],
        "bus_id": test["bus_id"],
        "status": test["status"],
        "progress_pct": test["progress_pct"],
        "frame_count": test["frame_count"],
        "total_frames": test["total_frames"],
        "line_in": test["line_in"],
        "line_out": test["line_out"],
        "passenger_count": test["passenger_count"],
        "error": test.get("error"),
    }


def start_bus_video_test(job_id: str, bus_id: int, capacity: int, file_path: str,
                          model_name: str | None,
                          line_x1: float = 0.0, line_y1: float = 0.25,
                          line_x2: float = 1.0, line_y2: float = 0.25) -> None:
    test = {
        "job_id": job_id,
        "bus_id": bus_id,
        "status": "processing",
        "progress_pct": 0.0,
        "frame_count": 0,
        "total_frames": 0,
        "line_in": 0,
        "line_out": 0,
        "passenger_count": 0,
        "error": None,
        "file_path": file_path,
        "created_at": time.time(),
        "_annotated_frame": None,
        "_frame_event": threading.Event(),
        "_frame_seq": 0,
    }
    bus_video_tests[job_id] = test

    thread = threading.Thread(
        target=_test_loop,
        args=(job_id, bus_id, capacity, file_path, model_name,
              line_x1, line_y1, line_x2, line_y2),
        daemon=True,
    )
    thread.start()


def _test_loop(job_id: str, bus_id: int, capacity: int, file_path: str,
               model_name: str | None,
               line_x1: float, line_y1: float, line_x2: float, line_y2: float) -> None:
    test = bus_video_tests.get(job_id)
    if not test:
        return
    try:
        _test_loop_inner(job_id, bus_id, capacity, file_path, model_name,
                         line_x1, line_y1, line_x2, line_y2, test)
    except Exception as e:
        logger.error(f"VideoTest {job_id}: UNHANDLED ERROR: {e}", exc_info=True)
        if test:
            test["status"] = "error"
            test["error"] = str(e)


def _test_loop_inner(job_id: str, bus_id: int, capacity: int, file_path: str,
                     model_name: str | None,
                     line_x1: float, line_y1: float, line_x2: float, line_y2: float,
                     test: dict) -> None:
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        test["status"] = "error"
        test["error"] = "Gagal membuka file video"
        return

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    test["total_frames"] = max(total_frames, 1)

    if model_name and not os.path.exists(model_name):
        logger.warning(f"VideoTest {job_id}: Model '{model_name}' not found, using default")
        model_name = None

    detector = PersonDetector(model_name, confidence=0.15)
    tracker = VehicleTracker(
        frame_height,
        lost_track_buffer=90,
        minimum_matching_threshold=0.7,
    )

    # Build line zone from normalized coords → pixel coords
    x1_px = int(frame_width * line_x1)
    y1_px = max(int(frame_height * line_y1), 1)
    x2_px = int(frame_width * line_x2)
    y2_px = max(int(frame_height * line_y2), 1)
    tracker.line_zone = sv.LineZone(
        start=sv.Point(x1_px, y1_px),
        end=sv.Point(x2_px, y2_px),
        triggering_anchors=[sv.Position.BOTTOM_CENTER],
    )

    logger.info(
        f"VideoTest {job_id}: started (bus={bus_id}, model={model_name or settings.yolo_model}, "
        f"frame={frame_height}x{frame_width}, "
        f"line=({x1_px},{y1_px})→({x2_px},{y2_px}), total_frames={total_frames})"
    )

    frame_idx = 0
    try:
        while cap.isOpened():
            if test.get("status") == "stopping":
                break

            ret, frame = cap.read()
            if not ret:
                break   # Video finished

            frame_idx += 1

            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)
            raw_dets = detector.detect(small)
            for d in raw_dets:
                d["bbox"] = [v / scale for v in d["bbox"]]

            tracked = tracker.update(raw_dets)
            line_in, line_out = tracker.get_line_counts()
            passenger_count = max(0, line_in - line_out)

            if line_in != test["line_in"] or line_out != test["line_out"]:
                logger.info(f"VideoTest {job_id}: crossing — in={line_in} out={line_out} (frame {frame_idx})")

            test["frame_count"] = frame_idx
            test["line_in"] = line_in
            test["line_out"] = line_out
            test["passenger_count"] = passenger_count
            test["progress_pct"] = (frame_idx / test["total_frames"]) * 100.0

            # Annotate frame + encode JPEG for MJPEG feed
            _draw_bus_frame(frame, tracked, x1_px, y1_px, x2_px, y2_px,
                            line_in, line_out, passenger_count, capacity)
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
            test["_annotated_frame"] = buf.tobytes()
            test["_frame_seq"] = test.get("_frame_seq", 0) + 1
            event = test.get("_frame_event")
            if event:
                event.set()

    finally:
        cap.release()

    if test.get("status") not in ("stopping", "error"):
        test["status"] = "completed"
        test["progress_pct"] = 100.0
    logger.info(
        f"VideoTest {job_id}: finished — frames={frame_idx}, in={test['line_in']}, out={test['line_out']}"
    )
