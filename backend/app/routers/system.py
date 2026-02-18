import time

import psutil
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/system", tags=["system"])

_start_time = time.time()


class SystemHealth(BaseModel):
    cpu_pct: float
    ram_pct: float
    ram_used_mb: int
    ram_total_mb: int
    uptime_seconds: int


@router.get("/health", response_model=SystemHealth)
def get_system_health():
    """Return real-time CPU, RAM usage and process uptime."""
    cpu = psutil.cpu_percent(interval=0.2)
    ram = psutil.virtual_memory()
    return SystemHealth(
        cpu_pct=round(cpu, 1),
        ram_pct=round(ram.percent, 1),
        ram_used_mb=ram.used // (1024 * 1024),
        ram_total_mb=ram.total // (1024 * 1024),
        uptime_seconds=int(time.time() - _start_time),
    )
