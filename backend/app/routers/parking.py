import asyncio
import json
from datetime import datetime, timedelta

import cv2
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from geoalchemy2.shape import from_shape
from pydantic import BaseModel
from shapely.geometry import Point
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.parking import OccupancySnapshot, ParkingLot, ParkingSpace
from ..schemas.parking import (
    OccupancyStatus,
    OccupancyTrend,
    ParkingLotCreate,
    ParkingLotOut,
    ParkingLotUpdate,
    ParkingMonitorStatus,
    ParkingSpaceCreate,
    ParkingSpaceOut,
    SpaceMonitorStatus,
)
from ..services.parking_monitor import (
    get_parking_monitor_status,
    parking_monitors,
    start_parking_monitor,
    stop_parking_monitor,
)
from ..services.space_monitor import (
    _resolve_url,
    _open_capture,
    get_space_monitor_status,
    space_monitors,
    start_space_monitor,
    stop_space_monitor,
)

router = APIRouter(prefix="/api/parking", tags=["parking"])


# ──────────────────────────────────────────────
# Occupancy helpers
# ──────────────────────────────────────────────

def _compute_occupancy(lot: ParkingLot, db: Session) -> OccupancyStatus:
    # Priority 1: space monitor (polygon-based)
    sm = space_monitors.get(lot.id)
    space_live = sm is not None and sm.get("status") == "running"

    if space_live:
        occupied = sm["occupied_count"]
        line_in = line_out = 0
        is_live = True
    else:
        # Priority 2: gate monitor (line counting)
        gm = parking_monitors.get(lot.id)
        gate_live = gm is not None and gm.get("status") == "running"

        if gate_live:
            occupied = gm["occupied_spaces"]
            line_in = gm["line_in"]
            line_out = gm["line_out"]
            is_live = True
        else:
            # Priority 3: latest snapshot
            snap = (
                db.query(OccupancySnapshot)
                .filter(OccupancySnapshot.parking_lot_id == lot.id)
                .order_by(OccupancySnapshot.timestamp.desc())
                .first()
            )
            occupied = snap.occupied_spaces if snap else lot.initial_occupied
            line_in = line_out = 0
            is_live = False

    occupied = max(0, min(occupied, lot.total_spaces))
    available = max(0, lot.total_spaces - occupied)
    pct = (occupied / lot.total_spaces * 100) if lot.total_spaces > 0 else 0.0

    if pct <= 50:
        label, color = "Tersedia", "#22c55e"
    elif pct <= 80:
        label, color = "Sibuk", "#f59e0b"
    elif pct <= 95:
        label, color = "Hampir Penuh", "#f97316"
    else:
        label, color = "Penuh", "#ef4444"

    return OccupancyStatus(
        lot_id=lot.id,
        name=lot.name,
        address=lot.address,
        latitude=lot.latitude,
        longitude=lot.longitude,
        total_spaces=lot.total_spaces,
        occupied_spaces=occupied,
        available_spaces=available,
        occupancy_pct=round(pct, 1),
        status_label=label,
        status_color=color,
        stream_url=lot.stream_url,
        overhead_stream_url=lot.overhead_stream_url,
        is_live=is_live,
        line_in=line_in,
        line_out=line_out,
    )


# ──────────────────────────────────────────────
# Parking Lot CRUD
# ──────────────────────────────────────────────

@router.post("/lots", response_model=ParkingLotOut)
def create_lot(payload: ParkingLotCreate, db: Session = Depends(get_db)):
    lot = ParkingLot(
        name=payload.name,
        address=payload.address,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location=from_shape(Point(payload.longitude, payload.latitude), srid=4326),
        total_spaces=payload.total_spaces,
        initial_occupied=payload.initial_occupied,
        status=payload.status,
        stream_url=payload.stream_url,
        overhead_stream_url=payload.overhead_stream_url,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


@router.get("/lots", response_model=list[ParkingLotOut])
def list_lots(db: Session = Depends(get_db)):
    return db.query(ParkingLot).all()


@router.get("/lots/{lot_id}", response_model=ParkingLotOut)
def get_lot(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    return lot


@router.put("/lots/{lot_id}", response_model=ParkingLotOut)
def update_lot(lot_id: int, payload: ParkingLotUpdate, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")

    if payload.name is not None:
        lot.name = payload.name
    if payload.address is not None:
        lot.address = payload.address
    if payload.latitude is not None:
        lot.latitude = payload.latitude
    if payload.longitude is not None:
        lot.longitude = payload.longitude
    if payload.latitude is not None or payload.longitude is not None:
        lat = payload.latitude if payload.latitude is not None else lot.latitude
        lng = payload.longitude if payload.longitude is not None else lot.longitude
        lot.location = from_shape(Point(lng, lat), srid=4326)
    if payload.total_spaces is not None:
        lot.total_spaces = payload.total_spaces
    if payload.initial_occupied is not None:
        lot.initial_occupied = payload.initial_occupied
    if payload.status is not None:
        lot.status = payload.status
    if "stream_url" in payload.model_fields_set:
        lot.stream_url = payload.stream_url
    if "overhead_stream_url" in payload.model_fields_set:
        lot.overhead_stream_url = payload.overhead_stream_url

    db.commit()
    db.refresh(lot)
    return lot


@router.delete("/lots/{lot_id}")
def delete_lot(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    # Stop any running monitors
    if lot_id in parking_monitors:
        stop_parking_monitor(lot_id)
    if lot_id in space_monitors:
        stop_space_monitor(lot_id)
    db.query(OccupancySnapshot).filter(OccupancySnapshot.parking_lot_id == lot_id).delete()
    db.query(ParkingSpace).filter(ParkingSpace.parking_lot_id == lot_id).delete()
    db.delete(lot)
    db.commit()
    return {"detail": "Parking lot deleted"}


# ──────────────────────────────────────────────
# Occupancy status & trends
# ──────────────────────────────────────────────

@router.get("/status", response_model=list[OccupancyStatus])
def get_all_status(db: Session = Depends(get_db)):
    lots = db.query(ParkingLot).all()
    return [_compute_occupancy(lot, db) for lot in lots]


@router.get("/status/{lot_id}", response_model=OccupancyStatus)
def get_lot_status(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    return _compute_occupancy(lot, db)


@router.get("/trends/{lot_id}", response_model=list[OccupancyTrend])
def get_trends(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    since = datetime.utcnow() - timedelta(hours=24)
    return (
        db.query(OccupancySnapshot)
        .filter(
            OccupancySnapshot.parking_lot_id == lot_id,
            OccupancySnapshot.timestamp >= since,
        )
        .order_by(OccupancySnapshot.timestamp.asc())
        .all()
    )


# ──────────────────────────────────────────────
# Gate Monitor (line counting)
# ──────────────────────────────────────────────

class MonitorStartRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_name: str | None = None


@router.post("/monitor/start/{lot_id}")
async def monitor_start(lot_id: int, req: MonitorStartRequest = MonitorStartRequest(),
                        db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    if not lot.stream_url:
        raise HTTPException(status_code=400, detail="Lot ini tidak punya stream URL. Set dulu via Edit.")
    try:
        result = await start_parking_monitor(
            lot_id=lot.id,
            initial_occupied=lot.initial_occupied,
            total_spaces=lot.total_spaces,
            youtube_url=lot.stream_url,
            model_name=req.model_name,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/monitor/stop/{lot_id}")
def monitor_stop(lot_id: int):
    result = stop_parking_monitor(lot_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/monitor/status/{lot_id}")
def monitor_status(lot_id: int):
    status = get_parking_monitor_status(lot_id)
    if not status:
        return {"lot_id": lot_id, "status": "idle", "line_in": 0, "line_out": 0,
                "occupied_spaces": 0, "last_update": None, "stream_url": None}
    return status


async def _gate_mjpeg_generator(lot_id: int):
    monitor = parking_monitors.get(lot_id)
    if not monitor:
        return
    monitor["_viewers"] = monitor.get("_viewers", 0) + 1
    last_seq = -1
    loop = asyncio.get_event_loop()
    try:
        while True:
            monitor = parking_monitors.get(lot_id)
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
        monitor = parking_monitors.get(lot_id)
        if monitor:
            monitor["_viewers"] = max(0, monitor.get("_viewers", 1) - 1)


@router.get("/monitor/feed/{lot_id}")
async def monitor_feed(lot_id: int):
    monitor = parking_monitors.get(lot_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active gate monitor")
    return StreamingResponse(
        _gate_mjpeg_generator(lot_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/monitor/snapshot/{lot_id}")
async def monitor_snapshot(lot_id: int):
    monitor = parking_monitors.get(lot_id)
    if not monitor or not monitor.get("_annotated_frame"):
        raise HTTPException(status_code=404, detail="No frame available")
    return Response(
        content=monitor["_annotated_frame"],
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, no-cache"},
    )


# ──────────────────────────────────────────────
# Parking Spaces CRUD
# ──────────────────────────────────────────────

@router.get("/spaces/{lot_id}", response_model=list[ParkingSpaceOut])
def list_spaces(lot_id: int, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    return db.query(ParkingSpace).filter(ParkingSpace.parking_lot_id == lot_id).all()


@router.post("/spaces/{lot_id}", response_model=ParkingSpaceOut)
def create_space(lot_id: int, payload: ParkingSpaceCreate, db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    space = ParkingSpace(
        parking_lot_id=lot_id,
        label=payload.label,
        polygon=json.dumps(payload.polygon),
    )
    db.add(space)
    db.commit()
    db.refresh(space)
    return space


@router.delete("/spaces/{lot_id}/{space_id}")
def delete_space(lot_id: int, space_id: int, db: Session = Depends(get_db)):
    space = db.query(ParkingSpace).filter(
        ParkingSpace.id == space_id,
        ParkingSpace.parking_lot_id == lot_id,
    ).first()
    if not space:
        raise HTTPException(status_code=404, detail="Parking space not found")
    db.delete(space)
    db.commit()
    return {"detail": "Space deleted"}


# ──────────────────────────────────────────────
# Space Monitor
# ──────────────────────────────────────────────

class SpaceMonitorStartRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_name: str | None = None


@router.post("/space-monitor/start/{lot_id}")
async def space_monitor_start(lot_id: int,
                               req: SpaceMonitorStartRequest = SpaceMonitorStartRequest(),
                               db: Session = Depends(get_db)):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Parking lot not found")
    if not lot.overhead_stream_url:
        raise HTTPException(status_code=400, detail="Lot ini tidak punya Overhead Stream URL. Set dulu via Edit.")

    spaces = db.query(ParkingSpace).filter(ParkingSpace.parking_lot_id == lot_id).all()
    if not spaces:
        raise HTTPException(status_code=400, detail="Belum ada slot parkir yang di-mapping. Gambar slot dulu di Space Editor.")

    spaces_data = [
        {"space_id": sp.id, "label": sp.label, "polygon": json.loads(sp.polygon)}
        for sp in spaces
    ]
    try:
        result = await start_space_monitor(lot_id, spaces_data, lot.overhead_stream_url, req.model_name)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.post("/space-monitor/stop/{lot_id}")
def space_monitor_stop(lot_id: int):
    result = stop_space_monitor(lot_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/space-monitor/status/{lot_id}", response_model=SpaceMonitorStatus)
def space_monitor_status(lot_id: int):
    status = get_space_monitor_status(lot_id)
    if not status:
        return SpaceMonitorStatus(
            lot_id=lot_id, status="idle",
            occupied_count=0, free_count=0, total_count=0,
            spaces=[], last_update=None,
        )
    return status


async def _space_mjpeg_generator(lot_id: int):
    monitor = space_monitors.get(lot_id)
    if not monitor:
        return
    monitor["_viewers"] = monitor.get("_viewers", 0) + 1
    last_seq = -1
    loop = asyncio.get_event_loop()
    try:
        while True:
            monitor = space_monitors.get(lot_id)
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
        monitor = space_monitors.get(lot_id)
        if monitor:
            monitor["_viewers"] = max(0, monitor.get("_viewers", 1) - 1)


@router.get("/space-monitor/feed/{lot_id}")
async def space_monitor_feed(lot_id: int):
    monitor = space_monitors.get(lot_id)
    if not monitor or monitor["status"] not in ("running", "starting"):
        raise HTTPException(status_code=404, detail="No active space monitor")
    return StreamingResponse(
        _space_mjpeg_generator(lot_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/space-monitor/frame/{lot_id}")
def space_monitor_frame(lot_id: int, db: Session = Depends(get_db)):
    """Return a single JPEG frame from the overhead stream (for the Space Editor)."""
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot or not lot.overhead_stream_url:
        raise HTTPException(status_code=404, detail="No overhead stream URL configured")

    # If space monitor is running, return its latest annotated frame
    monitor = space_monitors.get(lot_id)
    if monitor and monitor.get("_annotated_frame"):
        return Response(
            content=monitor["_annotated_frame"],
            media_type="image/jpeg",
            headers={"Cache-Control": "no-store, no-cache"},
        )

    # Otherwise open the stream briefly and grab one raw frame
    try:
        stream_url = _resolve_url(lot.overhead_stream_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot resolve stream URL: {e}")

    cap = _open_capture(stream_url)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Cannot open overhead stream")

    frame = None
    try:
        for _ in range(60):
            ret, f = cap.read()
            if ret and f is not None:
                frame = f
                break
    finally:
        cap.release()

    if frame is None:
        raise HTTPException(status_code=500, detail="Could not capture frame from overhead stream")

    _, buf = cv2.imencode(".jpg", frame)
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, no-cache"},
    )
