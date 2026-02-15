from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import extract, func, text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.camera import Camera
from ..models.detection import DetectionEvent
from ..models.traffic_count import TrafficCount
from ..schemas.analytics import HeatmapPoint, HourlyCount, TimeIntervalCount, VehicleSummary

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary", response_model=list[VehicleSummary])
def get_summary(db: Session = Depends(get_db)):
    # Count directly from DetectionEvent for real-time accuracy
    rows = (
        db.query(
            DetectionEvent.vehicle_type,
            func.count(DetectionEvent.id).label("total_count"),
        )
        .group_by(DetectionEvent.vehicle_type)
        .all()
    )
    return [VehicleSummary(vehicle_type=r[0], total_count=int(r[1])) for r in rows]


@router.get("/hourly/{camera_id}", response_model=list[HourlyCount])
def get_hourly(camera_id: int, db: Session = Depends(get_db)):
    tz = settings.timezone
    local_hour = extract(
        "hour",
        func.timezone(tz, DetectionEvent.timestamp)
    ).label("hour")

    # Only show today's data
    local_now = datetime.now(ZoneInfo(tz))
    today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    rows = (
        db.query(
            local_hour,
            DetectionEvent.vehicle_type,
            func.count(DetectionEvent.id).label("count"),
        )
        .filter(DetectionEvent.camera_id == camera_id)
        .filter(DetectionEvent.timestamp >= today_start)
        .group_by(local_hour, DetectionEvent.vehicle_type)
        .order_by(local_hour)
        .all()
    )
    return [HourlyCount(hour=int(r[0]), vehicle_type=r[1], count=int(r[2])) for r in rows]


INTERVAL_MINUTES = {"5m": 5, "15m": 15, "30m": 30, "1h": 60}


@router.get("/traffic/{camera_id}", response_model=list[TimeIntervalCount])
def get_traffic(
    camera_id: int,
    interval: str = Query("1h", pattern="^(5m|15m|30m|1h)$"),
    date_filter: str = Query("today", pattern="^(today|24h|all)$"),
    db: Session = Depends(get_db),
):
    tz = settings.timezone
    minutes = INTERVAL_MINUTES[interval]

    # Date filter — calculate in Python with correct timezone
    local_now = datetime.now(ZoneInfo(tz))
    if date_filter == "today":
        cutoff = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif date_filter == "24h":
        cutoff = local_now - timedelta(hours=24)
    else:
        cutoff = None

    # Time bucket: floor local timestamp to interval
    # Use original TIMESTAMPTZ for epoch math (avoids naive timezone issues)
    if minutes == 60:
        local_ts = func.timezone(tz, DetectionEvent.timestamp)
        bucket = func.date_trunc("hour", local_ts)
    else:
        # Floor to N-minute intervals using epoch on the original TIMESTAMPTZ
        epoch = extract("epoch", DetectionEvent.timestamp)
        interval_secs = minutes * 60
        floored_epoch = func.floor(epoch / interval_secs) * interval_secs
        # to_timestamp returns TIMESTAMPTZ, then convert to local naive for display
        bucket = func.timezone(tz, func.to_timestamp(floored_epoch))

    bucket = bucket.label("bucket")

    q = (
        db.query(
            bucket,
            DetectionEvent.vehicle_type,
            func.count(DetectionEvent.id).label("count"),
        )
        .filter(DetectionEvent.camera_id == camera_id)
    )

    if cutoff is not None:
        q = q.filter(DetectionEvent.timestamp >= cutoff)

    rows = (
        q.group_by(bucket, DetectionEvent.vehicle_type)
        .order_by(bucket)
        .all()
    )

    results = []
    for r in rows:
        bucket_val = r[0]
        if minutes == 60:
            label = bucket_val.strftime("%H:%M")
        else:
            end = bucket_val + timedelta(minutes=minutes)
            label = f"{bucket_val.strftime('%H:%M')}-{end.strftime('%H:%M')}"
        results.append(TimeIntervalCount(
            time_label=label,
            vehicle_type=r[1],
            count=int(r[2]),
        ))

    return results


@router.get("/heatmap", response_model=list[HeatmapPoint])
def get_heatmap(db: Session = Depends(get_db)):
    # Count directly from DetectionEvent for real-time accuracy
    rows = (
        db.query(
            Camera.id,
            Camera.latitude,
            Camera.longitude,
            func.coalesce(func.count(DetectionEvent.id), 0).label("total_count"),
        )
        .outerjoin(DetectionEvent, Camera.id == DetectionEvent.camera_id)
        .group_by(Camera.id, Camera.latitude, Camera.longitude)
        .all()
    )
    return [
        HeatmapPoint(
            camera_id=r[0],
            latitude=r[1],
            longitude=r[2],
            total_count=int(r[3]),
        )
        for r in rows
    ]
