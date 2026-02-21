import json
from datetime import datetime

from pydantic import BaseModel, field_validator


class BusCreate(BaseModel):
    name: str
    number: str | None = None
    capacity: int
    route: str | None = None
    stream_url: str | None = None
    overhead_stream_url: str | None = None
    status: str = "active"


class BusUpdate(BaseModel):
    name: str | None = None
    number: str | None = None
    capacity: int | None = None
    route: str | None = None
    stream_url: str | None = None
    overhead_stream_url: str | None = None
    status: str | None = None


class BusOut(BaseModel):
    id: int
    name: str
    number: str | None = None
    capacity: int
    route: str | None = None
    stream_url: str | None = None
    overhead_stream_url: str | None = None
    status: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class BusStatus(BaseModel):
    bus_id: int
    name: str
    number: str | None
    route: str | None
    capacity: int
    onboard: int
    available: int
    occupancy_pct: float
    status_label: str
    status_color: str
    stream_url: str | None
    overhead_stream_url: str | None
    is_live: bool
    line_in: int = 0
    line_out: int = 0


class BusMonitorStatus(BaseModel):
    bus_id: int
    stream_url: str | None
    status: str
    line_in: int
    line_out: int
    passenger_count: int
    last_update: str | None
    error: str | None = None


class PassengerTrend(BaseModel):
    timestamp: datetime
    passenger_count: int

    model_config = {"from_attributes": True}


# --- Seat detection ---

class BusSeatCreate(BaseModel):
    label: str
    polygon: list[list[float]]


class BusSeatOut(BaseModel):
    id: int
    bus_id: int
    label: str
    polygon: list[list[float]]

    model_config = {"from_attributes": True}

    @field_validator("polygon", mode="before")
    @classmethod
    def parse_polygon(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v


class SeatStatus(BaseModel):
    seat_id: int
    label: str
    occupied: bool
    polygon: list[list[float]]


class SeatMonitorStatus(BaseModel):
    bus_id: int
    status: str
    occupied_count: int
    free_count: int
    total_count: int
    seats: list[SeatStatus]
    last_update: str | None
    has_reference: bool = False
    reference_captured_at: str | None = None
    detection_mode: str = "texture"
    error: str | None = None
