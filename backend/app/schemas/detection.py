from datetime import datetime

from pydantic import BaseModel


class DetectionOut(BaseModel):
    id: int
    camera_id: int
    vehicle_type: str
    confidence: float
    timestamp: datetime | None = None

    model_config = {"from_attributes": True}
