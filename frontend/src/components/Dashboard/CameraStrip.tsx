import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, LiveStatus } from "../../services/api";

const SNAPSHOT_INTERVAL = 10_000; // refresh thumbnail every 10s

interface Props {
  cameras: Camera[];
  liveMonitors: LiveStatus[];
}

export default function CameraStrip({ cameras, liveMonitors }: Props) {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);

  // Refresh snapshot URLs periodically
  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), SNAPSHOT_INTERVAL);
    return () => window.clearInterval(iv);
  }, []);

  const getMonitorStatus = (cameraId: number) => {
    const m = liveMonitors.find((s) => s.camera_id === cameraId);
    return m?.status === "running" ? "live" : "idle";
  };

  if (cameras.length === 0) return null;

  return (
    <div className="shrink-0">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cameras.map((cam) => {
          const status = getMonitorStatus(cam.id);
          const isLive = status === "live";

          return (
            <button
              key={cam.id}
              onClick={() => navigate(`/cameras/${cam.id}`)}
              className="shrink-0 w-48 bg-card-dark border border-slate-800 rounded-lg overflow-hidden hover:border-slate-600 transition-colors group"
            >
              {/* Thumbnail area */}
              <div className="relative h-28 bg-slate-900 flex items-center justify-center">
                {isLive ? (
                  <img
                    // Snapshot endpoint: 1 JPEG frame, no persistent connection
                    src={`/api/stream/live/snapshot/${cam.id}?t=${tick}`}
                    alt={cam.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="material-symbols-outlined text-4xl text-slate-700">
                    videocam_off
                  </span>
                )}

                {/* Status badge */}
                <div className="absolute top-2 left-2">
                  {isLive ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-600 text-white">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                      </span>
                      LIVE
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-400">
                      IDLE
                    </span>
                  )}
                </div>
              </div>

              {/* Camera name */}
              <div className="px-3 py-2">
                <div className="text-xs font-medium text-slate-300 truncate group-hover:text-white transition-colors">
                  {cam.name}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
