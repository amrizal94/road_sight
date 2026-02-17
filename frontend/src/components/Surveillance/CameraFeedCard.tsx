import { useNavigate } from "react-router-dom";
import { Camera, LiveStatus } from "../../services/api";

interface Props {
  camera: Camera;
  liveStatus?: LiveStatus;
}

export default function CameraFeedCard({ camera, liveStatus }: Props) {
  const navigate = useNavigate();
  const isLive = liveStatus?.status === "running";
  const totalDetections = liveStatus?.detections_total ?? 0;

  const now = new Date();
  const timestampStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")} ${now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

  return (
    <div
      onClick={() => navigate(`/cameras/${camera.id}`)}
      className="bg-card-dark border border-slate-800 rounded-lg overflow-hidden hover:border-slate-600 transition-all cursor-pointer group"
    >
      {/* Video area */}
      <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
        {isLive ? (
          <img
            src={`/api/stream/live/feed/${camera.id}`}
            alt={camera.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-5xl text-slate-700">
              videocam_off
            </span>
            <span className="text-xs text-slate-600">No Active Feed</span>
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-3 left-3">
          {isLive ? (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold bg-red-600 text-white shadow-lg">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              LIVE
            </span>
          ) : (
            <span className="px-2 py-1 rounded text-xs font-medium bg-slate-800/80 text-slate-400">
              OFFLINE
            </span>
          )}
        </div>

        {/* Detection count badge */}
        {isLive && totalDetections > 0 && (
          <div className="absolute top-3 right-3">
            <span className="px-2 py-1 rounded text-xs font-medium bg-primary/80 text-white">
              {totalDetections} detections
            </span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="material-symbols-outlined text-3xl text-white opacity-0 group-hover:opacity-80 transition-opacity">
            open_in_new
          </span>
        </div>
      </div>

      {/* Timestamp bar */}
      <div className="bg-black/90 px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 tabular-nums font-mono">
          <span className="material-symbols-outlined text-xs text-slate-500">schedule</span>
          {isLive && liveStatus?.last_update
            ? (() => {
                const d = new Date(liveStatus.last_update);
                return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
              })()
            : timestampStr}
        </div>
        {isLive && (
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <span className="material-symbols-outlined text-xs">speed</span>
            {liveStatus?.frame_count ?? 0}f
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">
            {camera.name}
          </div>
          <div className="text-xs text-muted">
            {camera.latitude.toFixed(4)}, {camera.longitude.toFixed(4)}
          </div>
        </div>
      </div>
    </div>
  );
}
