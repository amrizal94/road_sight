import asyncio
import json
import subprocess
import time
from datetime import datetime, timedelta

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.bus import Bus, BusSeat, PassengerSnapshot
from ..schemas.bus import (
    BusCreate,
    BusMonitorStatus,
    BusOut,
    BusSeatCreate,
    BusSeatOut,
    BusStatus,
    BusUpdate,
    PassengerTrend,
    SeatMonitorStatus,
)
from ..services.bus_monitor import (
    bus_monitors,
    get_bus_monitor_status,
    start_bus_monitor,
    stop_bus_monitor,
)
from ..services.bus_seat_monitor import (
    _resolve_url,
    _open_capture,
    bus_seat_monitors,
    get_bus_seat_monitor_status,
    recapture_seat_reference,
    start_bus_seat_monitor,
    stop_bus_seat_monitor,
)

router = APIRouter(prefix="/api/bus", tags=["bus"])


# ──────────────────────────────────────────────
# Bus status helpers
# ──────────────────────────────────────────────

def _compute_bus_status(bus: Bus, db: Session) -> BusStatus:
    # Priority 1: seat monitor (live polygon-based)
    sm = bus_seat_monitors.get(bus.id)
    seat_live = sm is not None and sm.get("status") == "running"

    # Priority 2: passenger monitor (line counting)
    gm = bus_monitors.get(bus.id)
    gate_live = gm is not None and gm.get("status") == "running"

    if seat_live:
        onboard = sm["occupied_count"]
        capacity = sm.get("total_count") or bus.capacity
        line_in = line_out = 0
        is_live = True
    elif gate_live:
        onboard = gm["passenger_count"]
        capacity = bus.capacity
        line_in = gm["line_in"]
        line_out = gm["line_out"]
        is_live = True
    else:
        snap = (
            db.query(PassengerSnapshot)
            .filter(PassengerSnapshot.bus_id == bus.id)
            .order_by(PassengerSnapshot.timestamp.desc())
            .first()
        )
        onboard = snap.passenger_count if snap else 0
        capacity = bus.capacity
        line_in = line_out = 0
        is_live = False

    capacity = max(capacity, 1)
    onboard = max(0, min(onboard, capacity))
    available = max(0, capacity - onboard)
    pct = (onboard / capacity * 100) if capacity > 0 else 0.0

    if pct <= 50:
        label, color = "Tersedia", "#22c55e"
    elif pct <= 80:
        label, color = "Sibuk", "#f59e0b"
    elif pct <= 95:
        label, color = "Hampir Penuh", "#f97316"
    else:
        label, color = "Penuh", "#ef4444"

    return BusStatus(
        bus_id=bus.id,
        name=bus.name,
        number=bus.number,
        route=bus.route,
        capacity=capacity,
        onboard=onboard,
        available=available,
        occupancy_pct=round(pct, 1),
        status_label=label,
        status_color=color,
        stream_url=bus.stream_url,
        overhead_stream_url=bus.overhead_stream_url,
        is_live=is_live,
        line_in=line_in,
        line_out=line_out,
    )


# ──────────────────────────────────────────────
# Bus CRUD
# ──────────────────────────────────────────────

@router.post("/buses", response_model=BusOut)
def create_bus(payload: BusCreate, db: Session = Depends(get_db)):
    bus = Bus(**payload.model_dump())
    db.add(bus)
    db.commit()
    db.refresh(bus)
    return bus


@router.get("/buses", response_model=list[BusOut])
def list_buses(db: Session = Depends(get_db)):
    return db.query(Bus).all()


@router.get("/buses/{bus_id}", response_model=BusOut)
def get_bus(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    return bus


@router.put("/buses/{bus_id}", response_model=BusOut)
def update_bus(bus_id: int, payload: BusUpdate, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bus, field, value)
    db.commit()
    db.refresh(bus)
    return bus


@router.delete("/buses/{bus_id}")
def delete_bus(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    if bus_id in bus_monitors:
        stop_bus_monitor(bus_id)
    if bus_id in bus_seat_monitors:
        stop_bus_seat_monitor(bus_id)
    db.query(PassengerSnapshot).filter(PassengerSnapshot.bus_id == bus_id).delete()
    db.query(BusSeat).filter(BusSeat.bus_id == bus_id).delete()
    db.delete(bus)
    db.commit()
    return {"detail": "Bus deleted"}


# ──────────────────────────────────────────────
# Occupancy status & trends
# ──────────────────────────────────────────────

@router.get("/status", response_model=list[BusStatus])
def get_all_status(db: Session = Depends(get_db)):
    buses = db.query(Bus).all()
    return [_compute_bus_status(b, db) for b in buses]


@router.get("/status/{bus_id}", response_model=BusStatus)
def get_bus_status(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    return _compute_bus_status(bus, db)


@router.get("/trends/{bus_id}", response_model=list[PassengerTrend])
def get_trends(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    since = datetime.utcnow() - timedelta(hours=24)
    return (
        db.query(PassengerSnapshot)
        .filter(
            PassengerSnapshot.bus_id == bus_id,
            PassengerSnapshot.timestamp >= since,
        )
        .order_by(PassengerSnapshot.timestamp.asc())
        .all()
    )


# ──────────────────────────────────────────────
# Passenger Monitor (line crossing at door)
# ──────────────────────────────────────────────

class MonitorStartRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_name: str | None = None


@router.post("/monitor/start/{bus_id}")
async def monitor_start(bus_id: int, req: MonitorStartRequest = MonitorStartRequest(),
                        db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    if not bus.stream_url:
        raise HTTPException(status_code=400, detail="Bus ini belum punya Stream URL kamera pintu. Set via Edit.")
    try:
        result = await start_bus_monitor(bus_id, bus.capacity, bus.stream_url, req.model_name)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/monitor/stop/{bus_id}")
def monitor_stop(bus_id: int):
    result = stop_bus_monitor(bus_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/monitor/status/{bus_id}")
def monitor_status(bus_id: int):
    status = get_bus_monitor_status(bus_id)
    if not status:
        return {"bus_id": bus_id, "status": "idle", "line_in": 0, "line_out": 0,
                "passenger_count": 0, "last_update": None, "stream_url": None}
    return status


async def _bus_mjpeg_generator(bus_id: int):
    monitor = bus_monitors.get(bus_id)
    if not monitor:
        return
    monitor["_viewers"] = monitor.get("_viewers", 0) + 1
    last_seq = -1
    loop = asyncio.get_event_loop()
    try:
        while True:
            monitor = bus_monitors.get(bus_id)
            if not monitor or monitor["status"] not in ("running", "starting"):
                break
            event = monitor.get("_frame_event")
            if event:
                await loop.run_in_executor(None, event.wait, 0.5)
                event.clear()
            else:
                await asyncio.sleep(0.05)
            seq = monitor.get("_frame_seq", 0)
            if seq == last_seq:
                await asyncio.sleep(0.03)
                continue
            last_seq = seq
            frame_bytes = monitor.get("_annotated_frame")
            if frame_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )
    finally:
        monitor = bus_monitors.get(bus_id)
        if monitor:
            monitor["_viewers"] = max(0, monitor.get("_viewers", 1) - 1)


@router.get("/monitor/feed/{bus_id}")
async def monitor_feed(bus_id: int):
    monitor = bus_monitors.get(bus_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active passenger monitor")
    return StreamingResponse(
        _bus_mjpeg_generator(bus_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ──────────────────────────────────────────────
# Bus Seats CRUD
# ──────────────────────────────────────────────

@router.get("/seats/{bus_id}", response_model=list[BusSeatOut])
def list_seats(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    return db.query(BusSeat).filter(BusSeat.bus_id == bus_id).all()


@router.post("/seats/{bus_id}", response_model=BusSeatOut)
def create_seat(bus_id: int, payload: BusSeatCreate, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    seat = BusSeat(
        bus_id=bus_id,
        label=payload.label,
        polygon=json.dumps(payload.polygon),
    )
    db.add(seat)
    db.commit()
    db.refresh(seat)
    return seat


@router.delete("/seats/{bus_id}/{seat_id}")
def delete_seat(bus_id: int, seat_id: int, db: Session = Depends(get_db)):
    seat = db.query(BusSeat).filter(
        BusSeat.id == seat_id,
        BusSeat.bus_id == bus_id,
    ).first()
    if not seat:
        raise HTTPException(status_code=404, detail="Seat not found")
    db.delete(seat)
    db.commit()
    return {"detail": "Seat deleted"}


# ──────────────────────────────────────────────
# Seat Monitor
# ──────────────────────────────────────────────

@router.post("/seat-monitor/start/{bus_id}")
async def seat_monitor_start(bus_id: int, db: Session = Depends(get_db)):
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus:
        raise HTTPException(status_code=404, detail="Bus not found")
    if not bus.overhead_stream_url:
        raise HTTPException(status_code=400, detail="Bus ini belum punya Overhead Stream URL. Set via Edit.")

    seats = db.query(BusSeat).filter(BusSeat.bus_id == bus_id).all()
    if not seats:
        raise HTTPException(status_code=400, detail="Belum ada kursi yang di-mapping. Gambar kursi dulu di Seat Editor.")

    seats_data = [
        {"seat_id": s.id, "label": s.label, "polygon": json.loads(s.polygon)}
        for s in seats
    ]
    try:
        result = await start_bus_seat_monitor(bus_id, seats_data, bus.overhead_stream_url)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/seat-monitor/stop/{bus_id}")
def seat_monitor_stop(bus_id: int):
    result = stop_bus_seat_monitor(bus_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/seat-monitor/recapture/{bus_id}")
def seat_monitor_recapture(bus_id: int):
    result = recapture_seat_reference(bus_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/seat-monitor/status/{bus_id}", response_model=SeatMonitorStatus)
def seat_monitor_status(bus_id: int):
    status = get_bus_seat_monitor_status(bus_id)
    if not status:
        return SeatMonitorStatus(
            bus_id=bus_id, status="idle",
            occupied_count=0, free_count=0, total_count=0,
            seats=[], last_update=None,
        )
    return status


async def _seat_mjpeg_generator(bus_id: int):
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor:
        return
    monitor["_viewers"] = monitor.get("_viewers", 0) + 1
    last_seq = -1
    loop = asyncio.get_event_loop()
    try:
        while True:
            monitor = bus_seat_monitors.get(bus_id)
            if not monitor or monitor["status"] not in ("running", "starting"):
                break
            event = monitor.get("_frame_event")
            if event:
                await loop.run_in_executor(None, event.wait, 0.5)
                event.clear()
            else:
                await asyncio.sleep(0.05)
            seq = monitor.get("_frame_seq", 0)
            if seq == last_seq:
                await asyncio.sleep(0.03)
                continue
            last_seq = seq
            frame_bytes = monitor.get("_annotated_frame")
            if frame_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + frame_bytes
                    + b"\r\n"
                )
    finally:
        monitor = bus_seat_monitors.get(bus_id)
        if monitor:
            monitor["_viewers"] = max(0, monitor.get("_viewers", 1) - 1)


@router.get("/seat-monitor/feed/{bus_id}")
async def seat_monitor_feed(bus_id: int):
    monitor = bus_seat_monitors.get(bus_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active seat monitor")
    return StreamingResponse(
        _seat_mjpeg_generator(bus_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/seat-monitor/frame/{bus_id}")
def seat_monitor_frame(bus_id: int, db: Session = Depends(get_db)):
    """Single JPEG frame from overhead stream — for Seat Editor background."""
    bus = db.query(Bus).filter(Bus.id == bus_id).first()
    if not bus or not bus.overhead_stream_url:
        raise HTTPException(status_code=404, detail="No overhead stream URL configured")

    monitor = bus_seat_monitors.get(bus_id)
    if monitor and monitor.get("status") in ("running", "starting"):
        deadline = time.time() + 5.0
        while time.time() < deadline:
            if monitor.get("_raw_frame"):
                return Response(
                    content=monitor["_raw_frame"],
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-store, no-cache"},
                )
            time.sleep(0.1)
        raise HTTPException(status_code=503, detail="Monitor sedang starting, coba lagi.")

    try:
        stream_url = _resolve_url(bus.overhead_stream_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal resolve stream URL: {e}")

    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-i", stream_url,
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
            capture_output=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=400, detail="Timeout saat ambil frame dari stream")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="ffmpeg tidak ditemukan di server")

    if proc.returncode != 0 or not proc.stdout:
        raise HTTPException(status_code=400, detail="Gagal ambil frame dari overhead stream. Cek URL.")

    nparr = np.frombuffer(proc.stdout, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Gagal decode frame dari stream")

    h, w = frame.shape[:2]
    if w > 1280:
        scale = 1280 / w
        frame = cv2.resize(frame, None, fx=scale, fy=scale)

    _, buf = cv2.imencode(".jpg", frame)
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, no-cache"},
    )
