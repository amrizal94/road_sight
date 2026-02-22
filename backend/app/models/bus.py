from sqlalchemy import Column, DateTime, Float, Integer, String, Text, func

from ..database import Base


class Bus(Base):
    __tablename__ = "buses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)               # e.g. "Bus Kota 01"
    number = Column(String, nullable=True)              # e.g. "B 1234 CD" (plat/nomor)
    capacity = Column(Integer, nullable=False, default=0)  # jumlah kursi total
    route = Column(String, nullable=True)               # e.g. "Blok M - Kota"
    stream_url = Column(String, nullable=True)          # Kamera pintu (passenger counting)
    overhead_stream_url = Column(String, nullable=True) # Kamera overhead interior (seat detection)
    line_y_pct = Column(Float, default=0.25, server_default="0.25")  # legacy, kept for compat
    line_x1 = Column(Float, default=0.0, server_default="0.0")
    line_y1 = Column(Float, default=0.25, server_default="0.25")
    line_x2 = Column(Float, default=1.0, server_default="1.0")
    line_y2 = Column(Float, default=0.25, server_default="0.25")
    status = Column(String, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BusSeat(Base):
    __tablename__ = "bus_seats"

    id = Column(Integer, primary_key=True, index=True)
    bus_id = Column(Integer, nullable=False, index=True)
    label = Column(String, nullable=False)   # e.g. "1A", "2B"
    polygon = Column(Text, nullable=False)   # JSON: [[x, y], ...]


class PassengerSnapshot(Base):
    __tablename__ = "passenger_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    bus_id = Column(Integer, nullable=False, index=True)
    passenger_count = Column(Integer, nullable=False, default=0)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
