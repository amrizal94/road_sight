from datetime import datetime

from pydantic import BaseModel


class CameraCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    status: str = "active"


class CameraUpdate(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str | None = None


class CameraOut(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    status: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
