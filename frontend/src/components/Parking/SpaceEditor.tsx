import { useCallback, useEffect, useRef, useState } from "react";
import {
  ParkingSpace,
  createParkingSpace,
  deleteParkingSpace,
  getParkingSpaces,
} from "../../services/api";

interface Props {
  lotId: number;
  overheadStreamUrl: string | null;
}

export default function SpaceEditor({ lotId, overheadStreamUrl }: Props) {
  const [spaces, setSpaces] = useState<ParkingSpace[]>([]);
  const [drawing, setDrawing] = useState<number[][]>([]);  // current polygon in progress
  const [label, setLabel] = useState("");
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const loadSpaces = useCallback(async () => {
    try {
      const res = await getParkingSpaces(lotId);
      setSpaces(res.data);
    } catch { /**/ }
  }, [lotId]);

  useEffect(() => { loadSpaces(); }, [loadSpaces]);

  const loadFrame = async () => {
    if (!overheadStreamUrl) return;
    setLoadingFrame(true);
    setError("");
    setImgLoaded(false);
    // Add cache-buster
    setImgSrc(`/api/parking/space-monitor/frame/${lotId}?t=${Date.now()}`);
  };

  const handleImgLoad = () => {
    setImgLoaded(true);
    setLoadingFrame(false);
    redraw();
  };

  const handleImgError = () => {
    setLoadingFrame(false);
    setError("Gagal mengambil frame dari stream. Pastikan Overhead Stream URL sudah benar.");
  };

  // Redraw canvas overlay whenever spaces or drawing changes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;

    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scaleX = img.clientWidth / (img.naturalWidth || img.clientWidth);
    const scaleY = img.clientHeight / (img.naturalHeight || img.clientHeight);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved spaces
    for (const sp of spaces) {
      if (sp.polygon.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(sp.polygon[0][0] * scaleX, sp.polygon[0][1] * scaleY);
      for (let i = 1; i < sp.polygon.length; i++) {
        ctx.lineTo(sp.polygon[i][0] * scaleX, sp.polygon[i][1] * scaleY);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(34, 197, 94, 0.25)";
      ctx.fill();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const cx = sp.polygon.reduce((s, p) => s + p[0], 0) / sp.polygon.length * scaleX;
      const cy = sp.polygon.reduce((s, p) => s + p[1], 0) / sp.polygon.length * scaleY;
      ctx.font = "bold 13px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeText(sp.label, cx, cy);
      ctx.fillText(sp.label, cx, cy);
    }

    // Draw in-progress polygon
    if (drawing.length > 0) {
      ctx.beginPath();
      ctx.moveTo(drawing[0][0] * scaleX, drawing[0][1] * scaleY);
      for (let i = 1; i < drawing.length; i++) {
        ctx.lineTo(drawing[i][0] * scaleX, drawing[i][1] * scaleY);
      }
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertex dots
      for (const pt of drawing) {
        ctx.beginPath();
        ctx.arc(pt[0] * scaleX, pt[1] * scaleY, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
      }
    }
  }, [spaces, drawing, imgLoaded]);

  useEffect(() => { redraw(); }, [redraw]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;

    // Convert to natural image coordinates
    const scaleX = (img.naturalWidth || img.clientWidth) / img.clientWidth;
    const scaleY = (img.naturalHeight || img.clientHeight) / img.clientHeight;
    const natX = displayX * scaleX;
    const natY = displayY * scaleY;

    setDrawing((prev) => [...prev, [natX, natY]]);
  };

  const handleDoubleClick = () => {
    // Double-click closes the polygon (remove the last point that was added by the click event first)
    if (drawing.length >= 3) {
      // polygon complete — don't auto-save, let user name it and click "Simpan"
    }
  };

  const cancelDrawing = () => {
    setDrawing([]);
    setLabel("");
  };

  const undoPoint = () => {
    setDrawing((prev) => prev.slice(0, -1));
  };

  const saveSpace = async () => {
    if (drawing.length < 3) {
      setError("Minimal 3 titik untuk membentuk polygon");
      return;
    }
    if (!label.trim()) {
      setError("Label slot wajib diisi (contoh: A1)");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createParkingSpace(lotId, { label: label.trim(), polygon: drawing });
      setDrawing([]);
      setLabel("");
      await loadSpaces();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (spaceId: number) => {
    try {
      await deleteParkingSpace(lotId, spaceId);
      await loadSpaces();
    } catch { /**/ }
  };

  if (!overheadStreamUrl) {
    return (
      <p className="text-sm text-slate-500">
        Belum ada Overhead Stream URL. Set via tombol <strong className="text-slate-300">Edit</strong> di halaman ini.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={loadFrame}
          disabled={loadingFrame}
          className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded text-sm hover:bg-slate-600 disabled:opacity-50 transition-colors"
        >
          {loadingFrame ? "Mengambil frame..." : imgSrc ? "Refresh Frame" : "Ambil Frame dari Kamera"}
        </button>
        {spaces.length > 0 && (
          <span className="text-xs text-slate-500">{spaces.length} slot terdaftar</span>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Image + canvas overlay */}
      {imgSrc && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Klik pada gambar untuk menambah titik polygon. Minimal 3 titik, lalu isi label dan simpan.
          </p>
          <div className="relative select-none rounded-lg overflow-hidden border border-slate-700 bg-black">
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Overhead parking frame"
              className="w-full max-h-96 object-contain"
              onLoad={handleImgLoad}
              onError={handleImgError}
              draggable={false}
            />
            {imgLoaded && (
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onDoubleClick={handleDoubleClick}
                className="absolute inset-0 cursor-crosshair"
                style={{ width: imgRef.current?.clientWidth, height: imgRef.current?.clientHeight }}
              />
            )}
          </div>

          {/* Drawing controls */}
          {drawing.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center p-3 bg-slate-900/60 rounded border border-amber-500/30">
              <span className="text-amber-400 text-xs font-medium">{drawing.length} titik</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label slot (contoh: A1)"
                className="bg-card-dark border border-slate-600 text-white rounded px-2 py-1 text-sm focus:border-amber-400 focus:outline-none w-36"
              />
              <button
                onClick={saveSpace}
                disabled={saving || drawing.length < 3 || !label.trim()}
                className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Menyimpan..." : "Simpan Slot"}
              </button>
              <button
                onClick={undoPoint}
                className="px-3 py-1 bg-slate-700 text-slate-300 rounded text-sm hover:bg-slate-600 transition-colors"
              >
                Undo Titik
              </button>
              <button
                onClick={cancelDrawing}
                className="px-3 py-1 bg-red-900/40 text-red-400 rounded text-sm hover:bg-red-900/60 transition-colors"
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}

      {/* Saved spaces list */}
      {spaces.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Slot Terdaftar</h4>
          <div className="flex flex-wrap gap-2">
            {spaces.map((sp) => (
              <div
                key={sp.id}
                className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                <span className="text-slate-200">{sp.label}</span>
                <span className="text-slate-500 text-xs">({sp.polygon.length} titik)</span>
                <button
                  onClick={() => handleDelete(sp.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors ml-1"
                  title="Hapus slot"
                >
                  <span className="material-symbols-outlined text-sm leading-none">close</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
