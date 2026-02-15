from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.detection import DetectionEvent
from ..schemas.detection import DetectionOut

router = APIRouter(prefix="/api/detections", tags=["detections"])


@router.get("", response_model=list[DetectionOut])
def list_detections(
    camera_id: int | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    limit: int = Query(100, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(DetectionEvent)
    if camera_id is not None:
        q = q.filter(DetectionEvent.camera_id == camera_id)
    if start:
        q = q.filter(DetectionEvent.timestamp >= start)
    if end:
        q = q.filter(DetectionEvent.timestamp <= end)
    return q.order_by(DetectionEvent.timestamp.desc()).limit(limit).all()
