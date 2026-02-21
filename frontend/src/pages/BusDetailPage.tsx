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
import AddBusModal from "../components/Bus/AddBusModal";
import PassengerMonitorView from "../components/Bus/PassengerMonitorView";
import SeatEditor from "../components/Bus/SeatEditor";
import SeatMonitorView from "../components/Bus/SeatMonitorView";
import {
  Bus,
  BusSeat,
  BusStatus,
  PassengerTrend,
  deleteBus,
  getBus,
  getBusSeats,
  getBusStatus,
  getBusTrends,
} from "../services/api";

type BusTab = "passenger" | "seat-editor" | "seat-monitor";

export default function BusDetailPage() {
  const { id } = useParams<{ id: string }>();
  const busId = Number(id);

  const [bus, setBus] = useState<Bus | null>(null);
  const [status, setStatus] = useState<BusStatus | null>(null);
  const [trends, setTrends] = useState<PassengerTrend[]>([]);
  const [seats, setSeats] = useState<BusSeat[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<BusTab>("passenger");

  const fetchAll = useCallback(async () => {
    try {
      const [busRes, statusRes, trendRes] = await Promise.all([
        getBus(busId),
        getBusStatus(busId),
        getBusTrends(busId),
      ]);
      setBus(busRes.data);
      setStatus(statusRes.data);
      setTrends(trendRes.data);
    } catch { /**/ }
  }, [busId]);

  const fetchSeats = useCallback(async () => {
    try {
      const res = await getBusSeats(busId);
      setSeats(res.data);
    } catch { /**/ }
  }, [busId]);

  useEffect(() => {
    fetchAll();
    fetchSeats();
    const iv = window.setInterval(fetchAll, 10_000);
    return () => window.clearInterval(iv);
  }, [fetchAll, fetchSeats]);

  useEffect(() => {
    if (tab === "seat-editor" || tab === "seat-monitor") fetchSeats();
  }, [tab, fetchSeats]);

  const handleDelete = async () => {
    if (!window.confirm("Hapus bus ini?")) return;
    setDeleting(true);
    try {
      await deleteBus(busId);
      window.location.href = "/bus";
    } catch {
      setDeleting(false);
    }
  };

  if (!bus || !status) return <div className="text-slate-400 p-4">Loading...</div>;

  const trendData = trends.map((t) => ({
    time: new Date(t.timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
    penumpang: t.passenger_count,
  }));

  const tabs: { key: BusTab; label: string; icon: string }[] = [
    { key: "passenger", label: "Passenger Counter", icon: "people" },
    { key: "seat-editor", label: "Seat Editor", icon: "edit_square" },
    { key: "seat-monitor", label: "Seat Detection", icon: "airline_seat_recline_normal" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/bus" className="text-slate-500 hover:text-slate-300 transition-colors">
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl md:text-2xl font-bold text-white truncate">{bus.name}</h2>
          {(bus.number || bus.route) && (
            <p className="text-sm text-slate-500 mt-0.5">
              {bus.number && <span className="font-mono mr-2">{bus.number}</span>}
              {bus.route && <span>{bus.route}</span>}
            </p>
          )}
        </div>
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Kapasitas</div>
          <div className="text-2xl font-bold text-white">{status.capacity}</div>
        </div>
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Onboard</div>
          <div className="text-2xl font-bold text-amber-400">{status.onboard}</div>
        </div>
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Kursi Kosong</div>
          <div className="text-2xl font-bold text-emerald-400">{status.available}</div>
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

      {/* Live counters */}
      {status.is_live && (status.line_in > 0 || status.line_out > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card-dark border border-slate-800 rounded-lg p-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-emerald-400">arrow_upward</span>
            <div>
              <div className="text-xs text-slate-500">Naik (live)</div>
              <div className="text-xl font-bold text-emerald-400">{status.line_in}</div>
            </div>
          </div>
          <div className="bg-card-dark border border-slate-800 rounded-lg p-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-red-400">arrow_downward</span>
            <div>
              <div className="text-xs text-slate-500">Turun (live)</div>
              <div className="text-xl font-bold text-red-400">{status.line_out}</div>
            </div>
          </div>
        </div>
      )}

      {/* Monitor tabs */}
      <div className="bg-card-dark border border-slate-800 rounded-lg overflow-hidden">
        <div className="flex border-b border-slate-800 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
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

        <div className="p-4">
          {tab === "passenger" && (
            <PassengerMonitorView
              busId={busId}
              streamUrl={bus.stream_url}
              capacity={bus.capacity}
            />
          )}
          {tab === "seat-editor" && (
            <SeatEditor busId={busId} overheadStreamUrl={bus.overhead_stream_url} />
          )}
          {tab === "seat-monitor" && (
            <SeatMonitorView
              busId={busId}
              hasSeats={seats.length > 0}
              overheadStreamUrl={bus.overhead_stream_url}
            />
          )}
        </div>
      </div>

      {/* Trend chart */}
      <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-4">
          Tren Penumpang (24 Jam Terakhir)
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
                domain={[0, bus.capacity]}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                itemStyle={{ color: "#e2e8f0", fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="penumpang"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Penumpang"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
            <span className="material-symbols-outlined text-3xl">bar_chart</span>
            <p className="text-sm">Belum ada data snapshot penumpang.</p>
            <p className="text-xs text-slate-600">Snapshot tersimpan otomatis setiap 5 menit saat Passenger Counter aktif.</p>
          </div>
        )}
      </div>

      <AddBusModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={fetchAll}
        editBus={bus}
      />
    </div>
  );
}
