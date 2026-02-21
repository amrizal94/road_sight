import { useCallback, useEffect, useState } from "react";
import AddBusModal from "../components/Bus/AddBusModal";
import BusCard from "../components/Bus/BusCard";
import { Bus, BusStatus, getBus, getBusStatuses } from "../services/api";

export default function BusPage() {
  const [statuses, setStatuses] = useState<BusStatus[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editBus, setEditBus] = useState<Bus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getBusStatuses();
      setStatuses(res.data);
    } catch { /**/ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = window.setInterval(fetchStatus, 10_000);
    return () => window.clearInterval(iv);
  }, [fetchStatus]);

  const handleEdit = async (busId: number) => {
    try {
      const res = await getBus(busId);
      setEditBus(res.data);
      setModalOpen(true);
    } catch { /**/ }
  };

  const handleAddNew = () => { setEditBus(null); setModalOpen(true); };

  const totalBuses = statuses.length;
  const totalCapacity = statuses.reduce((a, s) => a + s.capacity, 0);
  const totalOnboard = statuses.reduce((a, s) => a + s.onboard, 0);
  const totalAvailable = statuses.reduce((a, s) => a + s.available, 0);
  const overallPct = totalCapacity > 0 ? Math.round((totalOnboard / totalCapacity) * 100) : 0;
  const liveBuses = statuses.filter((s) => s.is_live).length;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Left: bus cards */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Daftar Bus
          </h2>
        </div>

        {statuses.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {statuses.map((bus) => (
              <BusCard key={bus.bus_id} bus={bus} onEdit={handleEdit} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
            <span className="material-symbols-outlined text-5xl">directions_bus</span>
            <p className="text-sm">Belum ada bus. Tambah bus pertama Anda.</p>
          </div>
        )}
      </div>

      {/* Right: summary */}
      <div className="lg:w-64 xl:w-72 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Ringkasan</h2>
          <button
            onClick={handleAddNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary/80 transition-colors font-medium"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Tambah Bus
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
          <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Total Bus</div>
            <div className="text-2xl font-bold text-white">{totalBuses}</div>
            {liveBuses > 0 && (
              <div className="text-xs text-emerald-400 mt-1">{liveBuses} live monitoring</div>
            )}
          </div>
          <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Total Kapasitas</div>
            <div className="text-2xl font-bold text-white">{totalCapacity.toLocaleString()}</div>
          </div>
          <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Penumpang Onboard</div>
            <div className="text-2xl font-bold text-amber-400">{totalOnboard.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mt-1">{overallPct}% dari kapasitas</div>
          </div>
          <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Kursi Tersedia</div>
            <div className="text-2xl font-bold text-emerald-400">{totalAvailable.toLocaleString()}</div>
          </div>
        </div>

        {statuses.length > 0 && (
          <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-3">Status per Bus</div>
            <div className="space-y-2">
              {(["Tersedia", "Sibuk", "Hampir Penuh", "Penuh"] as const).map((label) => {
                const count = statuses.filter((s) => s.status_label === label).length;
                const colors: Record<string, string> = {
                  Tersedia: "#22c55e", Sibuk: "#f59e0b", "Hampir Penuh": "#f97316", Penuh: "#ef4444",
                };
                return (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors[label] }} />
                      <span className="text-xs text-slate-400">{label}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-200">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <AddBusModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchStatus}
        editBus={editBus}
      />
    </div>
  );
}
