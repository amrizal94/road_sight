import json
from datetime import datetime

from pydantic import BaseModel, field_validator


class ParkingLotCreate(BaseModel):
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    total_spaces: int
    initial_occupied: int = 0
    status: str = "active"
    stream_url: str | None = None
    overhead_stream_url: str | None = None


class ParkingLotUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_spaces: int | None = None
    initial_occupied: int | None = None
    status: str | None = None
    stream_url: str | None = None
    overhead_stream_url: str | None = None


class ParkingLotOut(BaseModel):
    id: int
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    total_spaces: int
    initial_occupied: int
    status: str
    stream_url: str | None = None
    overhead_stream_url: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class OccupancyStatus(BaseModel):
    lot_id: int
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    total_spaces: int
    occupied_spaces: int
    available_spaces: int
    occupancy_pct: float
    status_label: str
    status_color: str
    stream_url: str | None = None
    overhead_stream_url: str | None = None
    is_live: bool
    line_in: int = 0
    line_out: int = 0


class OccupancyTrend(BaseModel):
    timestamp: datetime
    occupied_spaces: int

    model_config = {"from_attributes": True}


class ParkingMonitorStatus(BaseModel):
    lot_id: int
    stream_url: str | None
    status: str          # starting | running | stopping | stopped | error
    line_in: int
    line_out: int
    occupied_spaces: int
    last_update: str | None
    error: str | None = None


# --- Space Detection ---

class ParkingSpaceCreate(BaseModel):
    label: str
    polygon: list[list[float]]  # [[x, y], ...] in natural image pixels


class ParkingSpaceOut(BaseModel):
    id: int
    parking_lot_id: int
    label: str
    polygon: list[list[float]]

    model_config = {"from_attributes": True}

    @field_validator("polygon", mode="before")
    @classmethod
    def parse_polygon(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v


class SpaceStatus(BaseModel):
    space_id: int
    label: str
    occupied: bool
    polygon: list[list[float]]


class SpaceMonitorStatus(BaseModel):
    lot_id: int
    status: str   # starting | running | stopping | stopped | error
    occupied_count: int
    free_count: int
    total_count: int
    spaces: list[SpaceStatus]
    last_update: str | None
    has_reference: bool = False
    reference_captured_at: str | None = None
    detection_mode: str = "texture"   # "texture" | "background"
    error: str | None = None
