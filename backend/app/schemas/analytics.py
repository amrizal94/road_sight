from datetime import datetime

from pydantic import BaseModel


class VehicleSummary(BaseModel):
    vehicle_type: str
    total_count: int


class HourlyCount(BaseModel):
    hour: int
    vehicle_type: str
    count: int


class TimeIntervalCount(BaseModel):
    time_label: str      # "14:00", "14:00-14:05", etc
    vehicle_type: str
    count: int


class HeatmapPoint(BaseModel):
    camera_id: int
    latitude: float
    longitude: float
    total_count: int


class TrafficCountOut(BaseModel):
    id: int
    camera_id: int
    vehicle_type: str
    count: int
    timestamp: datetime | None = None

    model_config = {"from_attributes": True}
