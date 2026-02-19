import { useCallback, useEffect, useState } from "react";
import AddParkingLotModal from "../components/Parking/AddParkingLotModal";
import ParkingLotCard from "../components/Parking/ParkingLotCard";
import ParkingMap from "../components/Parking/ParkingMap";
import {
  OccupancyStatus,
  ParkingLot,
  getParkingLot,
  getParkingStatus,
} from "../services/api";

export default function ParkingPage() {
  const [statuses, setStatuses] = useState<OccupancyStatus[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editLot, setEditLot] = useState<ParkingLot | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getParkingStatus();
      setStatuses(res.data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = window.setInterval(fetchStatus, 10_000);
    return () => window.clearInterval(iv);
  }, [fetchStatus]);

  const handleEdit = async (lotId: number) => {
    try {
      const res = await getParkingLot(lotId);
      setEditLot(res.data);
      setModalOpen(true);
    } catch {
      // ignore
    }
  };

  const handleAddNew = () => {
    setEditLot(null);
    setModalOpen(true);
  };

  // Summary stats
  const totalLots = statuses.length;
  const totalSpaces = statuses.reduce((a, s) => a + s.total_spaces, 0);
  const totalOccupied = statuses.reduce((a, s) => a + s.occupied_spaces, 0);
  const totalAvailable = statuses.reduce((a, s) => a + s.available_spaces, 0);
  const overallPct = totalSpaces > 0 ? Math.round((totalOccupied / totalSpaces) * 100) : 0;

  // Map center: average of all lots or default
  const center: [number, number] =
    statuses.length > 0
      ? [
          statuses.reduce((a, s) => a + s.latitude, 0) / statuses.length,
          statuses.reduce((a, s) => a + s.longitude, 0) / statuses.length,
        ]
      : [-6.2, 106.85];

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left: map + lot cards */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Peta Parkir
          </h2>
          <ParkingMap
            lots={statuses}
            center={center}
            className="flex-1 min-h-[300px] w-full rounded-lg overflow-hidden border border-slate-800"
          />

          {/* Lot cards grid */}
          {statuses.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Lot Parkir
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {statuses.map((lot) => (
                  <ParkingLotCard key={lot.lot_id} lot={lot} onEdit={handleEdit} />
                ))}
              </div>
            </div>
          )}

          {statuses.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
              <span className="material-symbols-outlined text-5xl">local_parking</span>
              <p className="text-sm">Belum ada lot parkir. Tambah lot pertama Anda.</p>
            </div>
          )}
        </div>

        {/* Right: summary + add button */}
        <div className="lg:w-64 xl:w-72 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Ringkasan
            </h2>
            <button
              onClick={handleAddNew}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary/80 transition-colors font-medium"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Tambah Lot
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Total Lot</div>
              <div className="text-2xl font-bold text-white">{totalLots}</div>
            </div>
            <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Total Kapasitas</div>
              <div className="text-2xl font-bold text-white">{totalSpaces.toLocaleString()}</div>
            </div>
            <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Terisi</div>
              <div className="text-2xl font-bold text-amber-400">{totalOccupied.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-1">{overallPct}% dari kapasitas</div>
            </div>
            <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Tersedia</div>
              <div className="text-2xl font-bold text-emerald-400">{totalAvailable.toLocaleString()}</div>
            </div>
          </div>

          {/* Status breakdown */}
          {statuses.length > 0 && (
            <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-3">Status per Lot</div>
              <div className="space-y-2">
                {(["Tersedia", "Sibuk", "Hampir Penuh", "Penuh"] as const).map((label) => {
                  const count = statuses.filter((s) => s.status_label === label).length;
                  const colors: Record<string, string> = {
                    Tersedia: "#22c55e",
                    Sibuk: "#f59e0b",
                    "Hampir Penuh": "#f97316",
                    Penuh: "#ef4444",
                  };
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: colors[label] }}
                        />
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
      </div>

      <AddParkingLotModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchStatus}
        editLot={editLot}
      />
    </div>
  );
}
