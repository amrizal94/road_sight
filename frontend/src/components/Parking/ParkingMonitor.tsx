import { useEffect, useRef, useState } from "react";
import {
  ParkingMonitorStatus,
  getModels,
  getParkingMonitorStatus,
  startParkingMonitor,
  stopParkingMonitor,
  YoloModel,
} from "../../services/api";

interface Props {
  lotId: number;
  streamUrl: string | null;
  totalSpaces: number;
}

export default function ParkingMonitor({ lotId, streamUrl, totalSpaces }: Props) {
  const [status, setStatus] = useState<ParkingMonitorStatus | null>(null);
  const [models, setModels] = useState<YoloModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);

  const isRunning = status?.status === "running" || status?.status === "starting";

  useEffect(() => {
    getModels().then((r) => {
      setModels(r.data);
      if (r.data.length > 0) setSelectedModel(r.data[0].id);
    }).catch(() => {});
  }, []);

  // Cleanup MJPEG on unmount
  useEffect(() => {
    return () => { if (imgRef.current) imgRef.current.src = ""; };
  }, []);

  // Poll monitor status
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!active) return;
      try {
        const res = await getParkingMonitorStatus(lotId);
        if (active) setStatus(res.data);
      } catch {
        if (active) setStatus(null);
      }
    };
    check();
    const iv = setInterval(check, isRunning ? 2000 : 5000);
    return () => { active = false; clearInterval(iv); };
  }, [lotId, isRunning]);

  const handleStart = async () => {
    setLoading(true);
    setError("");
    try {
      await startParkingMonitor(lotId, selectedModel || undefined);
      const res = await getParkingMonitorStatus(lotId);
      setStatus(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopParkingMonitor(lotId);
      // Immediately reflect stopped state — don't wait for next poll
      setStatus((prev) => prev ? { ...prev, status: "stopped" } : null);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const occupied = status?.occupied_spaces ?? 0;
  const available = Math.max(0, totalSpaces - occupied);
  const pct = totalSpaces > 0 ? Math.round((occupied / totalSpaces) * 100) : 0;

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-200">Live Monitor Parkir</h3>
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
          Belum ada Stream URL. Set via tombol <strong className="text-slate-300">Edit</strong> di halaman ini.
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
              <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
            ))}
          </select>
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? "Memulai..." : "Start Monitor Parkir"}
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

      {/* MJPEG Feed */}
      {isRunning && (
        <div className="space-y-3">
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={`/api/parking/monitor/feed/${lotId}`}
              alt="Live parking feed"
              className="w-full max-h-80 object-contain"
            />
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-emerald-400">{status?.line_in ?? 0}</div>
              <div className="text-xs text-slate-500 mt-0.5">Masuk</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-red-400">{status?.line_out ?? 0}</div>
              <div className="text-xs text-slate-500 mt-0.5">Keluar</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-amber-400">{occupied}</div>
              <div className="text-xs text-slate-500 mt-0.5">Terisi</div>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{available} tersedia</span>
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

          {status?.error && (
            <p className="text-red-400 text-xs">Error: {status.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
