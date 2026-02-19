import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AddParkingLotModal from "../components/Parking/AddParkingLotModal";
import ParkingMonitor from "../components/Parking/ParkingMonitor";
import SpaceEditor from "../components/Parking/SpaceEditor";
import SpaceMonitorView from "../components/Parking/SpaceMonitorView";
import {
  OccupancyStatus,
  OccupancyTrend,
  ParkingLot,
  ParkingSpace,
  deleteParkingLot,
  getParkingLot,
  getParkingLotStatus,
  getParkingSpaces,
  getParkingTrends,
} from "../services/api";

type MonitorTab = "gate" | "space-editor" | "space-monitor";

export default function ParkingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const lotId = Number(id);

  const [lot, setLot] = useState<ParkingLot | null>(null);
  const [status, setStatus] = useState<OccupancyStatus | null>(null);
  const [trends, setTrends] = useState<OccupancyTrend[]>([]);
  const [spaces, setSpaces] = useState<ParkingSpace[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<MonitorTab>("gate");

  const fetchAll = useCallback(async () => {
    try {
      const [lotRes, statusRes, trendRes] = await Promise.all([
        getParkingLot(lotId),
        getParkingLotStatus(lotId),
        getParkingTrends(lotId),
      ]);
      setLot(lotRes.data);
      setStatus(statusRes.data);
      setTrends(trendRes.data);
    } catch {
      // ignore
    }
  }, [lotId]);

  const fetchSpaces = useCallback(async () => {
    try {
      const res = await getParkingSpaces(lotId);
      setSpaces(res.data);
    } catch { /**/ }
  }, [lotId]);

  useEffect(() => {
    fetchAll();
    fetchSpaces();
    const iv = window.setInterval(fetchAll, 10_000);
    return () => window.clearInterval(iv);
  }, [fetchAll, fetchSpaces]);

  // Refresh spaces when switching to space tabs
  useEffect(() => {
    if (tab === "space-editor" || tab === "space-monitor") {
      fetchSpaces();
    }
  }, [tab, fetchSpaces]);

  const handleDelete = async () => {
    if (!window.confirm("Hapus lot parkir ini?")) return;
    setDeleting(true);
    try {
      await deleteParkingLot(lotId);
      window.location.href = "/parking";
    } catch {
      setDeleting(false);
    }
  };

  if (!lot || !status) return <div className="text-slate-400 p-4">Loading...</div>;

  const trendData = trends.map((t) => ({
    time: new Date(t.timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
    occupied: t.occupied_spaces,
  }));

  const tabs: { key: MonitorTab; label: string; icon: string }[] = [
    { key: "gate", label: "Gate Monitor", icon: "sensors" },
    { key: "space-editor", label: "Space Editor", icon: "edit_square" },
    { key: "space-monitor", label: "Space Detection", icon: "grid_view" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/parking" className="text-slate-500 hover:text-slate-300 transition-colors">
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-white truncate flex-1 min-w-0">
          {lot.name}
        </h2>
        <span
          className="px-3 py-1 rounded-full text-xs font-semibold text-white flex-shrink-0"
          style={{ background: status.status_color }}
        >
          {status.status_label}
        </span>
        {status.is_live && (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-red-600 text-white flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping inline-block" />
            LIVE
          </span>
        )}
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-900/40 text-red-400 hover:bg-red-900/60 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
          Hapus
        </button>
      </div>

      {lot.address && <p className="text-sm text-slate-500 -mt-2">{lot.address}</p>}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Total Kapasitas</div>
          <div className="text-2xl font-bold text-white">{status.total_spaces}</div>
        </div>
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Terisi</div>
          <div className="text-2xl font-bold text-amber-400">{status.occupied_spaces}</div>
        </div>
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Tersedia</div>
          <div className="text-2xl font-bold text-emerald-400">{status.available_spaces}</div>
        </div>
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Occupancy</div>
          <div className="text-2xl font-bold text-white">{status.occupancy_pct}%</div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${status.occupancy_pct}%`, background: status.status_color }}
            />
          </div>
        </div>
      </div>

      {/* Live stats when gate monitor running */}
      {status.is_live && (status.line_in > 0 || status.line_out > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card-dark border border-slate-800 rounded-lg p-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-emerald-400">login</span>
            <div>
              <div className="text-xs text-slate-500">Masuk (live)</div>
              <div className="text-xl font-bold text-emerald-400">{status.line_in}</div>
            </div>
          </div>
          <div className="bg-card-dark border border-slate-800 rounded-lg p-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-red-400">logout</span>
            <div>
              <div className="text-xs text-slate-500">Keluar (live)</div>
              <div className="text-xl font-bold text-red-400">{status.line_out}</div>
            </div>
          </div>
        </div>
      )}

      {/* Monitor section with tabs */}
      <div className="bg-card-dark border border-slate-800 rounded-lg overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-slate-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4">
          {tab === "gate" && (
            <ParkingMonitor
              lotId={lotId}
              streamUrl={lot.stream_url}
              totalSpaces={lot.total_spaces}
            />
          )}
          {tab === "space-editor" && (
            <SpaceEditor
              lotId={lotId}
              overheadStreamUrl={lot.overhead_stream_url}
            />
          )}
          {tab === "space-monitor" && (
            <SpaceMonitorView
              lotId={lotId}
              totalSpaces={lot.total_spaces}
              hasSpaces={spaces.length > 0}
              overheadStreamUrl={lot.overhead_stream_url}
            />
          )}
        </div>
      </div>

      {/* Occupancy trend chart */}
      <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-4">
          Tren Occupancy (24 Jam Terakhir)
        </h3>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={[0, lot.total_spaces]}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                itemStyle={{ color: "#e2e8f0", fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="occupied"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Terisi"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
            <span className="material-symbols-outlined text-3xl">bar_chart</span>
            <p className="text-sm">Belum ada data snapshot occupancy.</p>
            <p className="text-xs text-slate-600">Snapshot tersimpan otomatis setiap 5 menit saat monitor aktif.</p>
          </div>
        )}
      </div>

      <AddParkingLotModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={fetchAll}
        editLot={lot}
      />
    </div>
  );
}
