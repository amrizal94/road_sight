from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.camera import Camera
from ..models.detection import DetectionEvent
from ..models.traffic_count import TrafficCount
from ..schemas.camera import CameraCreate, CameraOut, CameraUpdate

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.post("", response_model=CameraOut)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    cam = Camera(
        name=payload.name,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location=from_shape(Point(payload.longitude, payload.latitude), srid=4326),
        status=payload.status,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.get("", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    return db.query(Camera).all()


@router.get("/{camera_id}", response_model=CameraOut)
def get_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return cam


@router.put("/{camera_id}", response_model=CameraOut)
def update_camera(camera_id: int, payload: CameraUpdate, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if payload.name is not None:
        cam.name = payload.name
    if payload.latitude is not None:
        cam.latitude = payload.latitude
    if payload.longitude is not None:
        cam.longitude = payload.longitude
    if payload.latitude is not None or payload.longitude is not None:
        lat = payload.latitude if payload.latitude is not None else cam.latitude
        lng = payload.longitude if payload.longitude is not None else cam.longitude
        cam.location = from_shape(Point(lng, lat), srid=4326)
    if payload.status is not None:
        cam.status = payload.status

    db.commit()
    db.refresh(cam)
    return cam


@router.delete("/{camera_id}")
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Delete related data first
    db.query(DetectionEvent).filter(DetectionEvent.camera_id == camera_id).delete()
    db.query(TrafficCount).filter(TrafficCount.camera_id == camera_id).delete()
    db.delete(cam)
    db.commit()
    return {"detail": "Camera deleted"}
