import { useEffect, useState } from "react";
import CameraFeedCard from "../components/Surveillance/CameraFeedCard";
import AddCameraCard from "../components/Surveillance/AddCameraCard";
import {
  Camera,
  getCameras,
  getAllLiveMonitors,
  LiveStatus,
} from "../services/api";

type GridLayout = "2x2" | "3x3";

export default function SurveillancePage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [liveMonitors, setLiveMonitors] = useState<LiveStatus[]>([]);
  const [grid, setGrid] = useState<GridLayout>("2x2");
  const [search, setSearch] = useState("");

  useEffect(() => {
    getCameras().then((r) => setCameras(r.data)).catch(() => {});
  }, []);

  // Poll live monitor statuses every 5s
  useEffect(() => {
    const fetchLive = () => {
      getAllLiveMonitors()
        .then((r) => setLiveMonitors(r.data))
        .catch(() => {});
    };
    fetchLive();
    const iv = setInterval(fetchLive, 5000);
    return () => clearInterval(iv);
  }, []);

  const filteredCameras = cameras.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const gridCols =
    grid === "2x2"
      ? "grid-cols-1 sm:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  const getLiveStatus = (cameraId: number) =>
    liveMonitors.find((m) => m.camera_id === cameraId);

  const liveCount = liveMonitors.filter((m) => m.status === "running").length;
  const alertCount = liveMonitors.filter((m) => m.status === "error").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-white">Surveillance</h2>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 sm:flex-none">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg">
              search
            </span>
            <input
              type="text"
              placeholder="Search cameras..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-card-dark-alt border border-slate-700 text-white rounded-lg pl-9 pr-3 py-1.5 text-sm w-full sm:w-56 placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>

          {/* Grid toggle */}
          <div className="flex rounded-lg border border-slate-700 overflow-hidden shrink-0">
            <button
              onClick={() => setGrid("2x2")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                grid === "2x2"
                  ? "bg-primary text-white"
                  : "bg-card-dark text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="material-symbols-outlined text-sm">grid_view</span>
            </button>
            <button
              onClick={() => setGrid("3x3")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                grid === "3x3"
                  ? "bg-primary text-white"
                  : "bg-card-dark text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="material-symbols-outlined text-sm">apps</span>
            </button>
          </div>
        </div>
      </div>

      {/* Camera status summary */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">
          <span className="font-semibold text-white">{cameras.length}</span> cameras
        </span>
        <span className="text-emerald-400">
          <span className="font-semibold">{liveCount}</span> live
        </span>
      </div>

      {/* Camera Grid */}
      <div className={`grid ${gridCols} gap-4`}>
        {filteredCameras.map((cam) => (
          <CameraFeedCard
            key={cam.id}
            camera={cam}
            liveStatus={getLiveStatus(cam.id)}
          />
        ))}
        <AddCameraCard />
      </div>

      {/* Bottom Status Bar */}
      <div className="bg-card-dark border border-slate-800 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Cloud Sync */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="material-symbols-outlined text-lg text-blue-400">cloud_sync</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-300">Cloud Sync</span>
              <span className="text-[10px] text-slate-500">98%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: "98%" }} />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-8 bg-slate-700" />

        {/* Quick Stats */}
        <div className="flex items-center gap-5 text-xs shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-amber-400">warning</span>
            <span className="text-slate-400">ALERTS</span>
            <span className="font-semibold text-white tabular-nums">{alertCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-red-400">error</span>
            <span className="text-slate-400">ERRORS</span>
            <span className="font-semibold text-white tabular-nums">0</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-emerald-400">speed</span>
            <span className="text-slate-400">LATENCY</span>
            <span className="font-semibold text-white tabular-nums">24ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
