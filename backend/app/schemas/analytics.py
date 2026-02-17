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


class SummaryCompare(BaseModel):
    today_total: int
    yesterday_total: int
    change_pct: float | None  # None if yesterday_total == 0


class TrafficCountOut(BaseModel):
    id: int
    camera_id: int
    vehicle_type: str
    count: int
    timestamp: datetime | None = None

    model_config = {"from_attributes": True}
