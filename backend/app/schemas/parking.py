from datetime import datetime

from pydantic import BaseModel


class ParkingLotCreate(BaseModel):
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    total_spaces: int
    initial_occupied: int = 0
    status: str = "active"
    stream_url: str | None = None


class ParkingLotUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    total_spaces: int | None = None
    initial_occupied: int | None = None
    status: str | None = None
    stream_url: str | None = None


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
