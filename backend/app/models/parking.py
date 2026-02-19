from geoalchemy2 import Geometry
from sqlalchemy import Column, DateTime, Float, Integer, String, func

from ..database import Base


class ParkingLot(Base):
    __tablename__ = "parking_lots"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location = Column(Geometry("POINT", srid=4326))
    total_spaces = Column(Integer, nullable=False, default=0)
    initial_occupied = Column(Integer, nullable=False, default=0)
    status = Column(String, default="active")
    stream_url = Column(String, nullable=True)  # Direct stream/YouTube URL for parking camera
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OccupancySnapshot(Base):
    __tablename__ = "occupancy_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    parking_lot_id = Column(Integer, nullable=False)
    occupied_spaces = Column(Integer, nullable=False, default=0)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
