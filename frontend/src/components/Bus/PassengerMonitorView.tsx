import { useEffect, useRef, useState } from "react";
import {
  BusMonitorStatus,
  YoloModel,
  getBusMonitorStatus,
  getModels,
  startBusMonitor,
  stopBusMonitor,
} from "../../services/api";

interface Props {
  busId: number;
  streamUrl: string | null;
  capacity: number;
}

export default function PassengerMonitorView({ busId, streamUrl, capacity }: Props) {
  const [status, setStatus] = useState<BusMonitorStatus | null>(null);
  const [models, setModels] = useState<YoloModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);

  const isRunning = status?.status === "running" || status?.status === "starting";

  useEffect(() => {
    getModels().then((r) => {
      // Filter models unsuitable for person detection:
      // - VisDrone: trained on aerial vehicle/pedestrian footage, poor at bus door angles
      // - yolo26: custom vehicle-optimised model, poor person detection (tested empirically)
      const personModels = r.data.filter((m: YoloModel) =>
        !m.id.toLowerCase().includes("visdrone") &&
        !m.id.toLowerCase().includes("yolo26")
      );
      setModels(personModels);
      // Prefer standard COCO models known to work well for person detection
      const PREFERRED = ["yolov8n.pt", "yolo11n.pt", "yolov8s.pt", "yolo11s.pt"];
      const preferred = personModels.find((m: YoloModel) =>
        m.available && PREFERRED.some((p) => m.id.endsWith(p))
      );
      const first = preferred ?? personModels.find((m: YoloModel) => m.available) ?? personModels[0];
      if (first) setSelectedModel(first.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => { if (imgRef.current) imgRef.current.src = ""; };
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!active) return;
      try {
        const res = await getBusMonitorStatus(busId);
        if (active) setStatus(res.data);
      } catch {
        if (active) setStatus(null);
      }
    };
    check();
    const iv = setInterval(check, isRunning ? 2000 : 5000);
    return () => { active = false; clearInterval(iv); };
  }, [busId, isRunning]);

  const handleStart = async () => {
    setLoading(true);
    setError("");
    try {
      await startBusMonitor(busId, selectedModel || undefined);
      const res = await getBusMonitorStatus(busId);
      setStatus(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopBusMonitor(busId);
      setStatus((prev) => prev ? { ...prev, status: "stopped" } : null);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const onboard = status?.passenger_count ?? 0;
  const available = Math.max(0, capacity - onboard);
  const pct = capacity > 0 ? Math.round((onboard / capacity) * 100) : 0;

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-200">Passenger Counter</h3>
        {status && status.status !== "idle" && (
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            status.status === "running" ? "bg-emerald-500/20 text-emerald-400"
            : status.status === "error" ? "bg-red-500/20 text-red-400"
            : "bg-slate-700 text-slate-400"
          }`}>
            {status.status}
          </span>
        )}
      </div>

      {!streamUrl ? (
        <p className="text-sm text-slate-500">
          Belum ada Stream URL kamera pintu. Set via tombol <strong className="text-slate-300">Edit</strong>.
        </p>
      ) : !isRunning ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-400 bg-slate-900/50 rounded px-3 py-2 border border-slate-700 break-all">
            {streamUrl}
          </div>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-card-dark border border-slate-700 text-white rounded px-3 py-2 w-full text-sm focus:border-primary focus:outline-none"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.available ? "" : "[Tidak tersedia] "}{m.name} — {m.description}
              </option>
            ))}
          </select>
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? "Memulai..." : "Start Passenger Counter"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleStop}
          disabled={loading}
          className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? "Menghentikan..." : "Stop Monitor"}
        </button>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {isRunning && (
        <div className="space-y-3">
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={`/api/bus/monitor/feed/${busId}`}
              alt="Passenger monitor feed"
              className="w-full max-h-80 object-contain"
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-emerald-400">{status?.line_in ?? 0}</div>
              <div className="text-xs text-slate-500 mt-0.5">Naik</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-red-400">{status?.line_out ?? 0}</div>
              <div className="text-xs text-slate-500 mt-0.5">Turun</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-amber-400">{onboard}</div>
              <div className="text-xs text-slate-500 mt-0.5">Onboard</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-slate-300">{available}</div>
              <div className="text-xs text-slate-500 mt-0.5">Kosong</div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{available} kursi tersedia</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: pct <= 50 ? "#22c55e" : pct <= 80 ? "#f59e0b" : pct <= 95 ? "#f97316" : "#ef4444",
                }}
              />
            </div>
          </div>

          {status?.last_update && (
            <p className="text-xs text-slate-500">
              Update: {new Date(status.last_update).toLocaleTimeString("id-ID")}
            </p>
          )}
          {status?.error && <p className="text-red-400 text-xs">Error: {status.error}</p>}
        </div>
      )}
    </div>
  );
}
