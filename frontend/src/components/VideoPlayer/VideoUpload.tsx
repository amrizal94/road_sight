import { useEffect, useRef, useState } from "react";
import { getJobStatus, processUrl, processVideo } from "../../services/api";

interface Props {
  cameraId: number;
}

export default function VideoUpload({ cameraId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(30);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);

  const handleFileUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setStatus("uploading...");
    const res = await processVideo(cameraId, file);
    setJobId(res.data.job_id);
    setStatus("queued");
  };

  const handleUrlProcess = async () => {
    if (!url.trim()) return;
    setStatus("capturing stream...");
    try {
      const res = await processUrl(cameraId, url, duration);
      setJobId(res.data.job_id);
      setStatus("queued");
    } catch (e: any) {
      setStatus(`error: ${e.response?.data?.detail || e.message}`);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const res = await getJobStatus(jobId);
      setStatus(res.data.status);
      setProgress(res.data.progress ?? 0);
      if (res.data.status === "completed" || res.data.status === "error") {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <div className="bg-white rounded-lg shadow p-3 md:p-4 space-y-4">
      <h3 className="text-base md:text-lg font-semibold">Process Video</h3>

      {/* File Upload */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Upload file .mp4</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
          <input type="file" accept="video/*" ref={fileRef} className="text-sm" />
          <button
            onClick={handleFileUpload}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm w-full sm:w-auto"
          >
            Upload
          </button>
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm text-gray-500 mb-1">
          Or capture from YouTube / live stream URL
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="border rounded px-3 py-2 flex-1 text-sm w-full"
          />
          <div className="flex gap-2">
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="border rounded px-3 py-2 w-20 text-sm"
              min={10}
              max={120}
              title="Duration (seconds)"
            />
            <button
              onClick={handleUrlProcess}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm whitespace-nowrap flex-1 sm:flex-none"
            >
              Capture
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Duration: {duration}s dari live stream
        </p>
      </div>

      {status && (
        <div className="border-t pt-3">
          <span className="capitalize font-medium text-sm">{status}</span>
          {progress > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
