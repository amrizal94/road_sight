from geoalchemy2 import Geometry
from sqlalchemy import Column, DateTime, Float, Integer, String, func

from ..database import Base


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location = Column(Geometry("POINT", srid=4326))
    status = Column(String, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
