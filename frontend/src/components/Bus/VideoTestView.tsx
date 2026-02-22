import { useEffect, useRef, useState } from "react";
import {
  BusVideoTestStatus,
  LinePts,
  deleteBusTest,
  getBusTestFeedUrl,
  getBusTestStatus,
  uploadBusTestVideo,
} from "../../services/api";

interface Props {
  busId: number;
  capacity: number;
  linePts: LinePts;
  modelName: string;
}

export default function VideoTestView({ busId, capacity, linePts, modelName }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<BusVideoTestStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Poll status while processing
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await getBusTestStatus(jobId);
        setTestStatus(res.data);
        if (res.data.status === "completed" || res.data.status === "error") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {
        // job gone
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 500);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [jobId]);

  // Cleanup MJPEG img on unmount to avoid browser keeping connection open
  useEffect(() => {
    return () => {
      if (imgRef.current) imgRef.current.src = "";
    };
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    setTestStatus(null);
    setJobId(null);
    try {
      const res = await uploadBusTestVideo(busId, file, modelName, linePts);
      setJobId(res.data.job_id);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || "Upload gagal");
    }
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    // Reset input so the same file can be picked again
    e.target.value = "";
  };

  const handleReset = async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (imgRef.current) imgRef.current.src = "";
    if (jobId) {
      try { await deleteBusTest(jobId); } catch { /**/ }
    }
    setJobId(null);
    setTestStatus(null);
    setError("");
  };

  const isProcessing = testStatus?.status === "processing";
  const isCompleted = testStatus?.status === "completed";
  const isError = testStatus?.status === "error";

  return (
    <div className="space-y-3">
      {/* Idle / file picker */}
      {!jobId && !uploading && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 bg-slate-900/40 border border-slate-700 rounded px-3 py-2">
            Model: <span className="text-slate-300">{modelName || "default"}</span>
            {" · "}
            {Math.abs(linePts.y2 - linePts.y1) < 0.02
              ? <>Garis: <span className="text-amber-400">{Math.round(linePts.y1 * 100)}% dari atas</span></>
              : <span className="text-amber-400">Garis kustom</span>
            }
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border border-dashed border-slate-600 hover:border-slate-400 text-slate-400 hover:text-slate-200 rounded px-4 py-3 text-sm transition-colors text-center"
          >
            Pilih file MP4 untuk diuji...
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Uploading spinner */}
      {uploading && (
        <div className="text-sm text-slate-400 text-center py-3">
          <span className="inline-block animate-spin mr-2">⏳</span>
          Mengupload...
        </div>
      )}

      {/* Processing */}
      {jobId && isProcessing && (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Memproses {testStatus?.frame_count ?? 0}/{testStatus?.total_frames ?? "?"} frame...
          </div>
          {/* Progress bar */}
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-300"
              style={{ width: `${testStatus?.progress_pct ?? 0}%` }}
            />
          </div>
          {/* Live MJPEG feed */}
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={getBusTestFeedUrl(jobId)}
              alt="Video test feed"
              className="w-full max-h-72 object-contain"
            />
          </div>
        </div>
      )}

      {/* Completed */}
      {isCompleted && testStatus && (
        <div className="space-y-3">
          {/* Last annotated frame — keep MJPEG img pointing at feed (browser shows last frame) */}
          <div className="bg-black rounded-lg overflow-hidden border border-slate-800">
            <img
              ref={imgRef}
              src={getBusTestFeedUrl(jobId!)}
              alt="Video test result"
              className="w-full max-h-72 object-contain"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-emerald-400">{testStatus.line_in}</div>
              <div className="text-xs text-slate-500 mt-0.5">Naik</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-red-400">{testStatus.line_out}</div>
              <div className="text-xs text-slate-500 mt-0.5">Turun</div>
            </div>
            <div className="bg-slate-900/50 rounded p-3 text-center border border-slate-800">
              <div className="text-lg font-bold text-amber-400">{testStatus.passenger_count}</div>
              <div className="text-xs text-slate-500 mt-0.5">Onboard</div>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="w-full border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded px-4 py-2 text-sm transition-colors"
          >
            Test Ulang
          </button>
        </div>
      )}

      {/* Error */}
      {(isError || error) && (
        <div className="space-y-2">
          <p className="text-red-400 text-xs">
            {testStatus?.error || error}
          </p>
          <button
            onClick={handleReset}
            className="w-full border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded px-4 py-2 text-sm transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      )}
    </div>
  );
}
