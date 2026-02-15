from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from ..database import Base


class TrafficCount(Base):
    __tablename__ = "traffic_counts"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False)
    vehicle_type = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
