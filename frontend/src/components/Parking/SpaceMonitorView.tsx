import { useEffect, useRef, useState } from "react";
import {
  SpaceMonitorStatus,
  getSpaceMonitorStatus,
  recaptureSpaceReference,
  startSpaceMonitor,
  stopSpaceMonitor,
} from "../../services/api";

interface Props {
  lotId: number;
  totalSpaces: number;
  hasSpaces: boolean;
  overheadStreamUrl: string | null;
}

export default function SpaceMonitorView({ lotId, hasSpaces, overheadStreamUrl }: Props) {
  const [status, setStatus] = useState<SpaceMonitorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [recapturing, setRecapturing] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);

  const isRunning = status?.status === "running" || status?.status === "starting";

  useEffect(() => {
    return () => { if (imgRef.current) imgRef.current.src = ""; };
  }, []);

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
      await startSpaceMonitor(lotId);
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

  const handleRecapture = async () => {
    setRecapturing(true);
    try {
      await recaptureSpaceReference(lotId);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setRecapturing(false);
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
        Belum ada slot yang di-mapping. Gambar polygon dulu di tab{" "}
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
      {/* Header + status badge */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-300">Space Detection Monitor</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Mode:{" "}
            {status?.detection_mode === "cnn"
              ? "CNN Classifier (MobileNetV3 — paling akurat)"
              : status?.detection_mode === "cnn+background"
              ? "CNN + Background Subtraction (hybrid)"
              : status?.detection_mode === "background"
              ? "Background Subtraction (akurat, butuh referensi kosong)"
              : "Texture Analysis (langsung jalan, tanpa referensi)"}
          </p>
        </div>
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

      {/* Start / Stop */}
      {!isRunning ? (
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? "Memulai..." : "Start Space Detection"}
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleStop}
            disabled={loading}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? "Menghentikan..." : "Stop"}
          </button>
          <button
            onClick={handleRecapture}
            disabled={recapturing}
            className="flex-1 bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700 text-sm disabled:opacity-50 transition-colors"
            title="Ambil ulang frame referensi (gunakan saat slot sedang kosong)"
          >
            {recapturing ? "Mengambil..." : "Set Referensi Baru"}
          </button>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Reference status */}
      {isRunning && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded text-xs border ${
          status?.has_reference
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-amber-500/10 border-amber-500/30 text-amber-400"
        }`}>
          <span className="material-symbols-outlined text-sm">
            {status?.has_reference ? "check_circle" : "hourglass_empty"}
          </span>
          {status?.has_reference
            ? `Referensi OK — diambil ${status.reference_captured_at
                ? new Date(status.reference_captured_at).toLocaleTimeString("id-ID")
                : ""}`
            : "Mengambil frame referensi..."}
        </div>
      )}

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

          {/* Per-slot status */}
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
          {status?.error && <p className="text-red-400 text-xs">Error: {status.error}</p>}
        </div>
      )}
    </div>
  );
}
