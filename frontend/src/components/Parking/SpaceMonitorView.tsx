import { useEffect, useRef, useState } from "react";
import {
  SpaceMonitorStatus,
  YoloModel,
  getModels,
  getSpaceMonitorStatus,
  startSpaceMonitor,
  stopSpaceMonitor,
} from "../../services/api";

interface Props {
  lotId: number;
  totalSpaces: number;
  hasSpaces: boolean;   // whether any polygon spaces are defined
  overheadStreamUrl: string | null;
}

export default function SpaceMonitorView({ lotId, totalSpaces, hasSpaces, overheadStreamUrl }: Props) {
  const [status, setStatus] = useState<SpaceMonitorStatus | null>(null);
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

  // Poll status
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!active) return;
      try {
        const res = await getSpaceMonitorStatus(lotId);
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
      await startSpaceMonitor(lotId, selectedModel || undefined);
      const res = await getSpaceMonitorStatus(lotId);
      setStatus(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopSpaceMonitor(lotId);
      setStatus((prev) => prev ? { ...prev, status: "stopped" } : null);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  if (!overheadStreamUrl) {
    return (
      <p className="text-sm text-slate-500">
        Belum ada Overhead Stream URL. Set via tombol <strong className="text-slate-300">Edit</strong>.
      </p>
    );
  }

  if (!hasSpaces) {
    return (
      <p className="text-sm text-slate-500">
        Belum ada slot parkir yang di-mapping. Gambar polygon slot terlebih dahulu di tab{" "}
        <strong className="text-slate-300">Space Editor</strong>.
      </p>
    );
  }

  const occ = status?.occupied_count ?? 0;
  const free = status?.free_count ?? 0;
  const total = status?.total_count ?? 0;
  const pct = total > 0 ? Math.round((occ / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Status badge + controls */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-300">Space Detection Monitor</h4>
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

      {!isRunning ? (
        <div className="space-y-2">
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
            className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? "Memulai..." : "Start Space Detection"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleStop}
          disabled={loading}
          className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? "Menghentikan..." : "Stop Space Detection"}
        </button>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {isRunning && (
        <div className="space-y-3">
          {/* MJPEG feed */}
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={`/api/parking/space-monitor/feed/${lotId}`}
              alt="Space detection feed"
              className="w-full max-h-80 object-contain"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-red-400">{occ}</div>
              <div className="text-xs text-slate-500 mt-0.5">Terisi</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-emerald-400">{free}</div>
              <div className="text-xs text-slate-500 mt-0.5">Kosong</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-slate-300">{total}</div>
              <div className="text-xs text-slate-500 mt-0.5">Total Slot</div>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{free} kosong</span>
              <span>{pct}% terisi</span>
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

          {/* Per-space status grid */}
          {status?.spaces && status.spaces.length > 0 && (
            <div>
              <h5 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Status Per Slot</h5>
              <div className="flex flex-wrap gap-1.5">
                {status.spaces.map((sp) => (
                  <div
                    key={sp.space_id}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      sp.occupied
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    }`}
                  >
                    {sp.label}
                  </div>
                ))}
              </div>
            </div>
          )}

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
