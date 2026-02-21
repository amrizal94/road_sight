import asyncio
import json
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .database import Base, engine
from .routers import analytics, cameras, detections, parking, stream, system
from .routers import bus as bus_router
from .services.live_monitor import active_monitors, stop_all_monitors
from .services.parking_monitor import stop_all_parking_monitors
from .services.space_monitor import stop_all_space_monitors
from .services.bus_monitor import stop_all_bus_monitors
from .services.bus_seat_monitor import stop_all_bus_seat_monitors

logger = logging.getLogger(__name__)

os.environ["TZ"] = settings.timezone

app = FastAPI(title="Road Sight API", version="0.1.0")


@app.on_event("startup")
def on_startup():
    try:
        Base.metadata.create_all(bind=engine)
        # Idempotent column migrations
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS stream_url VARCHAR"
            ))
            conn.execute(text(
                "ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS overhead_stream_url VARCHAR"
            ))
            conn.commit()
        logger.info(f"Database OK. Timezone: {settings.timezone}")
    except Exception as e:
        logger.warning(f"Database not ready: {e}. Start PostgreSQL and restart.")


@app.on_event("shutdown")
def on_shutdown():
    logger.info("Shutting down — stopping all live monitors...")
    stop_all_monitors()
    stop_all_parking_monitors()
    stop_all_space_monitors()
    stop_all_bus_monitors()
    stop_all_bus_seat_monitors()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cameras.router)
app.include_router(detections.router)
app.include_router(analytics.router)
app.include_router(stream.router)
app.include_router(system.router)
app.include_router(parking.router)
app.include_router(bus_router.router)

ws_clients: list[WebSocket] = []


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await ws.accept()
    ws_clients.append(ws)
    try:
        while True:
            # Push queued messages from live monitors
            for cam_id, monitor in list(active_monitors.items()):
                queue = monitor.get("_ws_queue", [])
                while queue:
                    msg = queue.pop(0)
                    txt = json.dumps(msg)
                    for client in list(ws_clients):
                        try:
                            await client.send_text(txt)
                        except Exception:
                            if client in ws_clients:
                                ws_clients.remove(client)
            await asyncio.sleep(0.5)
    except Exception:
        # Handle all disconnect types (WebSocketDisconnect, ConnectionReset, etc.)
        pass
    finally:
        if ws in ws_clients:
            ws_clients.remove(ws)


@app.get("/")
def root():
    return {"message": "Road Sight API is running"}
