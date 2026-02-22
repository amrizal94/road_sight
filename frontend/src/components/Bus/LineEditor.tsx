import { useEffect, useRef, useState } from "react";
import { LinePts, getBusMonitorFrameUrl } from "../../services/api";

interface Props {
  busId: number;
  linePts: LinePts;        // normalized 0–1
  onSave: (pts: LinePts) => void;
  onClose: () => void;
}

const HANDLE_RADIUS = 14;   // px hit radius
const ARROW_LEN = 48;       // px arrow length

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,   // tip
  ux: number, uy: number,   // unit direction toward tip
  color: string,
) {
  const HEAD = 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - HEAD * (ux + uy * 0.45), ty - HEAD * (uy - ux * 0.45));
  ctx.lineTo(tx - HEAD * (ux - uy * 0.45), ty - HEAD * (uy + ux * 0.45));
  ctx.closePath();
  ctx.fill();
}

export default function LineEditor({ busId, linePts, onSave, onClose }: Props) {
  const [pts, setPts] = useState<LinePts>(linePts);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<"pt1" | "pt2" | null>(null);
  const frameUrl = getBusMonitorFrameUrl(busId);

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!imgLoaded && !imgError) return;

    // Sync bitmap resolution to CSS display size
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw === 0 || ch === 0) return;
    if (canvas.width !== Math.round(cw) || canvas.height !== Math.round(ch)) {
      canvas.width = Math.round(cw);
      canvas.height = Math.round(ch);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark placeholder when no frame available
    if (imgError) {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // subtle grid
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      ctx.fillStyle = "#475569";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Stream tidak tersedia — posisi garis tetap bisa diatur", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
    }

    // Pixel coords from normalized
    const px1 = pts.x1 * canvas.width,  py1 = pts.y1 * canvas.height;
    const px2 = pts.x2 * canvas.width,  py2 = pts.y2 * canvas.height;

    // ── Counting line ──
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Perpendicular direction arrows ──
    // Left-normal of (dx,dy) in screen coords (Y-down): n = (dy, -dx) / len
    // This corresponds to supervision's "in_count" side.
    const dx = px2 - px1, dy = py2 - py1;
    const len = Math.hypot(dx, dy);
    if (len > 10) {
      const nx = dy / len, ny = -dx / len;   // left-normal → NAIK (in)
      const mx = (px1 + px2) / 2, my = (py1 + py2) / 2;

      // NAIK arrow (green)
      const inX = mx + nx * ARROW_LEN, inY = my + ny * ARROW_LEN;
      const inUx = (inX - mx) / ARROW_LEN, inUy = (inY - my) / ARROW_LEN;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(inX, inY);
      ctx.stroke();
      drawArrowhead(ctx, inX, inY, inUx, inUy, "#22c55e");
      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("NAIK", inX + inUx * 6 - (inUx < 0 ? 36 : 0), inY + inUy * 6 + 4);

      // TURUN arrow (red)
      const outX = mx - nx * ARROW_LEN, outY = my - ny * ARROW_LEN;
      const outUx = (outX - mx) / ARROW_LEN, outUy = (outY - my) / ARROW_LEN;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(outX, outY);
      ctx.stroke();
      drawArrowhead(ctx, outX, outY, outUx, outUy, "#ef4444");
      ctx.fillStyle = "#ef4444";
      ctx.fillText("TURUN", outX + outUx * 6 - (outUx < 0 ? 40 : 0), outY + outUy * 6 + 4);
    }

    // ── Drag handles ──
    for (const [px, py, label] of [
      [px1, py1, "P1"],
      [px2, py2, "P2"],
    ] as [number, number, string][]) {
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, 2 * Math.PI);
      ctx.fillStyle = "#facc15";
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, px, py + 3);
      ctx.textAlign = "left";
    }
  }, [pts, imgLoaded, imgError]);

  // ── Mouse interaction ─────────────────────────────────────────────────────
  const toNorm = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const getHit = (e: React.MouseEvent<HTMLCanvasElement>): "pt1" | "pt2" | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = rect.width, h = rect.height;
    if (Math.hypot(mx - pts.x1 * w, my - pts.y1 * h) < HANDLE_RADIUS) return "pt1";
    if (Math.hypot(mx - pts.x2 * w, my - pts.y2 * h) < HANDLE_RADIUS) return "pt2";
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    draggingRef.current = getHit(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = draggingRef.current ? "grabbing"
        : getHit(e) ? "grab" : "crosshair";
    }
    if (!draggingRef.current) return;
    const { x, y } = toNorm(e);
    if (draggingRef.current === "pt1") setPts(p => ({ ...p, x1: x, y1: y }));
    else                               setPts(p => ({ ...p, x2: x, y2: y }));
  };

  const handleMouseUp = () => { draggingRef.current = null; };

  const handleSwap = () => {
    setPts(p => ({ x1: p.x2, y1: p.y2, x2: p.x1, y2: p.y1 }));
  };

  const isHorizontal = Math.abs(pts.y2 - pts.y1) < 0.02;
  const posLabel = isHorizontal
    ? `Horizontal — ${Math.round(pts.y1 * 100)}% dari atas`
    : `(${(pts.x1 * 100).toFixed(0)}%, ${(pts.y1 * 100).toFixed(0)}%) → (${(pts.x2 * 100).toFixed(0)}%, ${(pts.y2 * 100).toFixed(0)}%)`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col gap-4 p-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-200">Atur Garis Hitung</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Hint + swap */}
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">
            Drag titik <strong>P1</strong> dan <strong>P2</strong> untuk mengatur garis.
            Panah hijau = arah <strong>NAIK</strong>, merah = <strong>TURUN</strong>.
          </div>
          <button
            onClick={handleSwap}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 rounded transition-colors"
          >
            <span className="material-symbols-outlined text-sm">swap_vert</span>
            Tukar Naik/Turun
          </button>
        </div>

        {/* Canvas + image */}
        <div
          className="relative rounded overflow-hidden bg-black border border-slate-800 select-none"
          style={imgError ? { minHeight: "300px" } : undefined}
        >
          {!imgError && (
            <img
              src={frameUrl}
              alt="Stream frame"
              className="w-full block"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          )}
          {(imgLoaded || imgError) && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ cursor: "crosshair" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          )}
          {!imgLoaded && !imgError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-500 text-sm animate-pulse">Memuat frame...</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-slate-400">
            <span className="text-slate-500">Posisi: </span>
            <strong className="text-amber-400">{posLabel}</strong>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Batal
            </button>
            <button
              onClick={() => onSave(pts)}
              className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              Simpan
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
