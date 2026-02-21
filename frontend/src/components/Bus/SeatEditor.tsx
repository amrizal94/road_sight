import { useCallback, useEffect, useRef, useState } from "react";
import {
  BusSeat,
  createBusSeat,
  deleteBusSeat,
  getBusSeats,
} from "../../services/api";

interface Props {
  busId: number;
  overheadStreamUrl: string | null;
}

function getImageBounds(img: HTMLImageElement) {
  const cw = img.clientWidth;
  const ch = img.clientHeight;
  const nw = img.naturalWidth || cw;
  const nh = img.naturalHeight || ch;
  const containerAspect = cw / ch;
  const imageAspect = nw / nh;
  let rw: number, rh: number, ox: number, oy: number;
  if (imageAspect > containerAspect) {
    rw = cw; rh = cw / imageAspect; ox = 0; oy = (ch - rh) / 2;
  } else {
    rh = ch; rw = ch * imageAspect; ox = (cw - rw) / 2; oy = 0;
  }
  return { rw, rh, ox, oy };
}

function natToDisplay(x: number, y: number, img: HTMLImageElement) {
  const { rw, rh, ox, oy } = getImageBounds(img);
  return { dx: (x / img.naturalWidth) * rw + ox, dy: (y / img.naturalHeight) * rh + oy };
}

export default function SeatEditor({ busId, overheadStreamUrl }: Props) {
  const [seats, setSeats] = useState<BusSeat[]>([]);
  const [drawing, setDrawing] = useState<number[][]>([]);
  const [label, setLabel] = useState("");
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const loadSeats = useCallback(async () => {
    try {
      const res = await getBusSeats(busId);
      setSeats(res.data);
    } catch { /**/ }
  }, [busId]);

  useEffect(() => { loadSeats(); }, [loadSeats]);

  const loadFrame = () => {
    if (!overheadStreamUrl) return;
    setLoadingFrame(true);
    setError("");
    setImgLoaded(false);
    setImgSrc(`/api/bus/seat-monitor/frame/${busId}?t=${Date.now()}`);
  };

  const handleImgLoad = () => { setImgLoaded(true); setLoadingFrame(false); };
  const handleImgError = () => {
    setLoadingFrame(false);
    setError("Gagal mengambil frame dari stream. Pastikan Overhead Stream URL sudah benar.");
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const seat of seats) {
      if (seat.polygon.length < 2) continue;
      ctx.beginPath();
      const p0 = natToDisplay(seat.polygon[0][0], seat.polygon[0][1], img);
      ctx.moveTo(p0.dx, p0.dy);
      for (let i = 1; i < seat.polygon.length; i++) {
        const p = natToDisplay(seat.polygon[i][0], seat.polygon[i][1], img);
        ctx.lineTo(p.dx, p.dy);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
      ctx.fill();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.stroke();
      const cx = seat.polygon.reduce((s, p) => s + p[0], 0) / seat.polygon.length;
      const cy = seat.polygon.reduce((s, p) => s + p[1], 0) / seat.polygon.length;
      const { dx: lcx, dy: lcy } = natToDisplay(cx, cy, img);
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeText(seat.label, lcx, lcy);
      ctx.fillStyle = "#fff";
      ctx.fillText(seat.label, lcx, lcy);
    }

    if (drawing.length > 0) {
      ctx.beginPath();
      const d0 = natToDisplay(drawing[0][0], drawing[0][1], img);
      ctx.moveTo(d0.dx, d0.dy);
      for (let i = 1; i < drawing.length; i++) {
        const d = natToDisplay(drawing[i][0], drawing[i][1], img);
        ctx.lineTo(d.dx, d.dy);
      }
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const pt of drawing) {
        const { dx, dy } = natToDisplay(pt[0], pt[1], img);
        ctx.beginPath();
        ctx.arc(dx, dy, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
      }
    }
  }, [seats, drawing, imgLoaded]);

  useEffect(() => { redraw(); }, [redraw]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = canvas.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    const { rw, rh, ox, oy } = getImageBounds(img);
    const natX = ((displayX - ox) / rw) * img.naturalWidth;
    const natY = ((displayY - oy) / rh) * img.naturalHeight;
    if (natX < 0 || natY < 0 || natX > img.naturalWidth || natY > img.naturalHeight) return;
    setDrawing((prev) => [...prev, [natX, natY]]);
  };

  const cancelDrawing = () => { setDrawing([]); setLabel(""); };
  const undoPoint = () => setDrawing((prev) => prev.slice(0, -1));

  const saveSeat = async () => {
    if (drawing.length < 3) { setError("Minimal 3 titik untuk membentuk polygon"); return; }
    if (!label.trim()) { setError("Label kursi wajib diisi (contoh: 1A)"); return; }
    setSaving(true);
    setError("");
    try {
      await createBusSeat(busId, { label: label.trim(), polygon: drawing });
      setDrawing([]);
      setLabel("");
      await loadSeats();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (seatId: number) => {
    try {
      await deleteBusSeat(busId, seatId);
      await loadSeats();
    } catch { /**/ }
  };

  if (!overheadStreamUrl) {
    return (
      <p className="text-sm text-slate-500">
        Belum ada Overhead Stream URL. Set via tombol <strong className="text-slate-300">Edit</strong>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={loadFrame}
          disabled={loadingFrame}
          className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded text-sm hover:bg-slate-600 disabled:opacity-50 transition-colors"
        >
          {loadingFrame ? "Mengambil frame..." : imgSrc ? "Refresh Frame" : "Ambil Frame dari Kamera"}
        </button>
        {seats.length > 0 && (
          <span className="text-xs text-slate-500">{seats.length} kursi terdaftar</span>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {imgSrc && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Klik pada gambar untuk menambah titik polygon. Minimal 3 titik, lalu isi label dan simpan.
          </p>
          <div className="relative select-none rounded-lg overflow-hidden border border-slate-700 bg-black">
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Overhead bus frame"
              className="w-full max-h-96 object-contain"
              onLoad={handleImgLoad}
              onError={handleImgError}
              draggable={false}
            />
            {imgLoaded && (
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="absolute inset-0 cursor-crosshair"
                style={{ width: imgRef.current?.clientWidth, height: imgRef.current?.clientHeight }}
              />
            )}
          </div>

          {drawing.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center p-3 bg-slate-900/60 rounded border border-amber-500/30">
              <span className="text-amber-400 text-xs font-medium">{drawing.length} titik</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label kursi (contoh: 1A)"
                className="bg-card-dark border border-slate-600 text-white rounded px-2 py-1 text-sm focus:border-amber-400 focus:outline-none w-36"
              />
              <button
                onClick={saveSeat}
                disabled={saving || drawing.length < 3 || !label.trim()}
                className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Menyimpan..." : "Simpan Kursi"}
              </button>
              <button onClick={undoPoint} className="px-3 py-1 bg-slate-700 text-slate-300 rounded text-sm hover:bg-slate-600 transition-colors">
                Undo Titik
              </button>
              <button onClick={cancelDrawing} className="px-3 py-1 bg-red-900/40 text-red-400 rounded text-sm hover:bg-red-900/60 transition-colors">
                Batal
              </button>
            </div>
          )}
        </div>
      )}

      {seats.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Kursi Terdaftar</h4>
          <div className="flex flex-wrap gap-2">
            {seats.map((seat) => (
              <div
                key={seat.id}
                className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
              >
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                <span className="text-slate-200">{seat.label}</span>
                <span className="text-slate-500 text-xs">({seat.polygon.length} titik)</span>
                <button
                  onClick={() => handleDelete(seat.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors ml-1"
                  title="Hapus kursi"
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
