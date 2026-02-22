import { useEffect, useRef, useState, useCallback } from "react";
import {
  getLiveStatus,
  getModels,
  LiveStatus,
  startLiveMonitor,
  stopLiveMonitor,
  YoloModel,
} from "../../services/api";

interface Props {
  cameraId: number;
}

interface WsDetection {
  type: string;
  camera_id: number;
  timestamp: string;
  detections: { vehicle_type: string; confidence: number }[];
  totals: Record<string, number>;
  line_in: number;
  line_out: number;
}

const VEHICLE_ICONS: Record<string, string> = {
  car: "directions_car",
  motorcycle: "two_wheeler",
  bus: "directions_bus",
  truck: "local_shipping",
  bicycle: "pedal_bike",
};

export default function LiveMonitor({ cameraId }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recentDetections, setRecentDetections] = useState<WsDetection[]>([]);
  const [feedMode, setFeedMode] = useState<"ai" | "raw">("ai");
  const [models, setModels] = useState<YoloModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const isRunning = status?.status === "running" || status?.status === "starting";

  // Load available models
  useEffect(() => {
    getModels().then((res) => {
      setModels(res.data);
      if (!selectedModel) {
        // Prefer standard COCO models for vehicle detection at traffic cameras.
        // yolo26 models are listed after COCO as a secondary option.
        const PREFERRED = ["yolov8n.pt", "yolo11n.pt", "yolov8s.pt", "yolo11s.pt", "yolo26n.pt"];
        const preferred = res.data.find((m: YoloModel) =>
          m.available && PREFERRED.some((p) => m.id.endsWith(p))
        );
        const first = preferred ?? res.data.find((m: YoloModel) => m.available) ?? res.data[0];
        if (first) setSelectedModel(first.id);
      }
    }).catch(() => {});
  }, []);

  // Cleanup MJPEG stream on unmount
  useEffect(() => {
    return () => {
      if (imgRef.current) {
        imgRef.current.src = "";
      }
    };
  }, []);

  // Poll live status
  useEffect(() => {
    let active = true;

    const checkStatus = async () => {
      if (!active) return;
      try {
        const res = await getLiveStatus(cameraId);
        if (active) setStatus(res.data);
      } catch {
        if (active) setStatus(null);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, isRunning ? 2000 : 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [cameraId, isRunning]);

  // WebSocket ONLY when monitor is running
  useEffect(() => {
    if (!isRunning) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/live`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data: WsDetection = JSON.parse(event.data);
        if (data.camera_id === cameraId && data.type === "live_detection") {
          setRecentDetections((prev) => [data, ...prev].slice(0, 10));
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [cameraId, isRunning]);

  const handleStart = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    try {
      await startLiveMonitor(cameraId, url, selectedModel || undefined);
      const res = await getLiveStatus(cameraId);
      setStatus(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopLiveMonitor(cameraId);
      setRecentDetections([]);
      setStatus(null);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setLoading(false);
  };

  const feedUrl =
    feedMode === "ai"
      ? `/api/stream/live/feed/${cameraId}`
      : `/api/stream/live/feed-raw/${cameraId}`;

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-3 md:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base md:text-lg font-semibold text-slate-200">Live Monitoring</h3>
        {status && status.status !== "idle" && (
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              status.status === "running"
                ? "bg-emerald-500/20 text-emerald-400"
                : status.status === "error"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-slate-700 text-slate-400"
            }`}
          >
            {status.status}
          </span>
        )}
      </div>

      {/* Controls */}
      {!isRunning ? (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="YouTube Live URL (https://youtube.com/watch?v=...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 w-full text-sm placeholder-slate-500 focus:border-primary focus:outline-none"
          />
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 w-full text-sm focus:border-primary focus:outline-none"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.available ? "" : "[Tidak tersedia] "}{m.name} — {m.description}
              </option>
            ))}
          </select>
          <button
            onClick={handleStart}
            disabled={loading || !url.trim()}
            className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? "Starting..." : "Start Live Monitor"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleStop}
          disabled={loading}
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? "Stopping..." : "Stop Monitoring"}
        </button>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Video feeds */}
      {isRunning && (
        <div className="space-y-3">
          {/* Feed mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setFeedMode("ai")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                feedMode === "ai"
                  ? "bg-primary text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              AI Detection
            </button>
            <button
              onClick={() => setFeedMode("raw")}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                feedMode === "raw"
                  ? "bg-primary text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              Raw Feed
            </button>
          </div>

          {/* MJPEG stream */}
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={feedUrl}
              alt={`Live feed - ${feedMode}`}
              className="w-full max-h-60 sm:max-h-80 md:max-h-[480px] object-contain"
            />
          </div>
        </div>
      )}

      {/* Live Stats */}
      {status && isRunning && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {Object.entries(status.vehicle_counts).map(([type, count]) => (
              <div key={type} className="bg-slate-900/50 rounded p-2 text-center border border-slate-800">
                <span className="material-symbols-outlined text-lg md:text-xl text-slate-300">
                  {VEHICLE_ICONS[type] ?? "directions_car"}
                </span>
                <div className="text-base md:text-lg font-bold text-white">{count}</div>
                <div className="text-xs text-muted capitalize">{type}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs md:text-sm text-slate-400">
            <span>Model: <strong className="text-slate-200">{status.model_name}</strong></span>
            <span>Frames: {status.frame_count}</span>
            <span>Total: {status.detections_total}</span>
            <span>In: {status.line_in} | Out: {status.line_out}</span>
          </div>

          {status.last_update && (
            <p className="text-xs text-slate-500">
              Last update:{" "}
              {new Date(status.last_update).toLocaleTimeString("id-ID")}
            </p>
          )}
        </div>
      )}

      {/* Real-time detection feed */}
      {recentDetections.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-400 mb-2">
            Real-time Feed
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {recentDetections.map((det, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs bg-slate-900/50 rounded px-2 py-1 border border-slate-800/50"
              >
                <span className="text-slate-500">
                  {new Date(det.timestamp).toLocaleTimeString("id-ID")}
                </span>
                {det.detections.map((d, j) => (
                  <span key={j} className="capitalize text-slate-300">
                    <span className="material-symbols-outlined text-sm align-middle mr-0.5">
                      {VEHICLE_ICONS[d.vehicle_type] ?? "directions_car"}
                    </span>
                    {d.vehicle_type} ({(d.confidence * 100).toFixed(0)}%)
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
