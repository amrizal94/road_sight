import asyncio
import os
import shutil
import subprocess

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.params import File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..services.detector import AVAILABLE_MODELS
from ..services.live_monitor import (
    active_monitors,
    get_all_monitors,
    get_monitor_status,
    start_monitor,
    stop_monitor,
)
from ..services.video_processor import jobs, start_processing

router = APIRouter(prefix="/api/stream", tags=["stream"])


# --- File upload processing ---

@router.post("/process")
async def process_video(
    camera_id: int = Query(...),
    file: UploadFile = File(...),
):
    os.makedirs(settings.upload_dir, exist_ok=True)
    file_path = os.path.join(settings.upload_dir, file.filename)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    job_id = await start_processing(file_path, camera_id)
    return {"job_id": job_id, "status": "queued"}


class URLProcessRequest(BaseModel):
    url: str
    camera_id: int
    duration: int = 30


@router.post("/process-url")
async def process_url(req: URLProcessRequest):
    os.makedirs(settings.upload_dir, exist_ok=True)
    output_path = os.path.join(settings.upload_dir, f"stream_{req.camera_id}.mp4")

    try:
        result = subprocess.run(
            ["yt-dlp", "-g", "-f", "best", req.url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=f"yt-dlp error: {result.stderr.strip()}")

        stream_url = result.stdout.strip().split("\n")[0]

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", stream_url,
                "-t", str(req.duration),
                "-c:v", "libx264",
                "-an",
                output_path,
            ],
            capture_output=True, timeout=req.duration + 30,
        )

        if not os.path.exists(output_path):
            raise HTTPException(status_code=500, detail="Failed to capture stream")

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Stream capture timed out")
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"Missing tool: {e.filename}. Install ffmpeg and yt-dlp.")

    job_id = await start_processing(output_path, req.camera_id)
    return {"job_id": job_id, "status": "queued", "captured_seconds": req.duration}


@router.get("/status/{job_id}")
def get_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# --- Live monitoring ---

class LiveMonitorRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    camera_id: int
    youtube_url: str
    model_name: str | None = None


@router.get("/models")
def list_models():
    return AVAILABLE_MODELS


@router.post("/live/start")
async def live_start(req: LiveMonitorRequest):
    try:
        result = await start_monitor(req.camera_id, req.youtube_url, req.model_name)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/live/stop/{camera_id}")
def live_stop(camera_id: int):
    result = stop_monitor(camera_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/live/status/{camera_id}")
def live_status(camera_id: int):
    status = get_monitor_status(camera_id)
    if not status:
        return {"camera_id": camera_id, "status": "idle"}
    return status


@router.get("/live/all")
def live_all():
    return get_all_monitors()


# --- MJPEG streams ---

async def _mjpeg_generator(camera_id: int, frame_key: str):
    """Yield MJPEG frames from live monitor (event-driven)."""
    monitor = active_monitors.get(camera_id)
    if not monitor:
        return

    # Track viewer count
    monitor["_viewers"] = monitor.get("_viewers", 0) + 1
    last_seq = -1
    loop = asyncio.get_event_loop()
    try:
        while True:
            monitor = active_monitors.get(camera_id)
            if not monitor or monitor["status"] not in ("running", "starting"):
                break

            # Wait for new frame signal instead of fixed sleep
            event = monitor.get("_frame_event")
            if event:
                await loop.run_in_executor(None, event.wait, 0.5)
                event.clear()
            else:
                await asyncio.sleep(0.05)

            # Skip if frame hasn't changed (stale)
            seq = monitor.get("_frame_seq", 0)
            if seq == last_seq:
                await asyncio.sleep(0.03)
                continue
            last_seq = seq

            frame_bytes = monitor.get(frame_key)
            if frame_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )
    finally:
        monitor = active_monitors.get(camera_id)
        if monitor:
            monitor["_viewers"] = max(0, monitor.get("_viewers", 1) - 1)
            if frame_key == "_raw_frame":
                monitor["_raw_requested"] = False


@router.get("/live/feed/{camera_id}")
async def live_feed_annotated(camera_id: int):
    """MJPEG stream with bounding boxes and detection overlay."""
    monitor = active_monitors.get(camera_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active monitor for this camera")
    return StreamingResponse(
        _mjpeg_generator(camera_id, "_annotated_frame"),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/live/feed-raw/{camera_id}")
async def live_feed_raw(camera_id: int):
    """MJPEG stream of raw video (no annotations)."""
    monitor = active_monitors.get(camera_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active monitor for this camera")
    # Signal monitor to encode raw frames
    monitor["_raw_requested"] = True
    return StreamingResponse(
        _mjpeg_generator(camera_id, "_raw_frame"),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
