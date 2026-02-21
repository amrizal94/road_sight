import { Link } from "react-router-dom";
import { BusStatus } from "../../services/api";

interface Props {
  bus: BusStatus;
  onEdit: (busId: number) => void;
}

export default function BusCard({ bus, onEdit }: Props) {
  const pct = bus.occupancy_pct;

  return (
    <div className="bg-card-dark border border-slate-800 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/bus/${bus.bus_id}`}
            className="text-sm font-semibold text-white hover:text-primary transition-colors truncate block"
          >
            {bus.name}
          </Link>
          {bus.number && (
            <span className="text-[11px] text-slate-500 font-mono">{bus.number}</span>
          )}
          {bus.route && (
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{bus.route}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {bus.is_live && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600 text-white">
              <span className="w-1 h-1 rounded-full bg-white animate-ping inline-block" />
              LIVE
            </span>
          )}
          <span
            className="px-2 py-0.5 rounded text-[10px] font-semibold text-white"
            style={{ background: bus.status_color }}
          >
            {bus.status_label}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-base font-bold text-amber-400">{bus.onboard}</div>
          <div className="text-[10px] text-slate-500">Onboard</div>
        </div>
        <div>
          <div className="text-base font-bold text-emerald-400">{bus.available}</div>
          <div className="text-[10px] text-slate-500">Kosong</div>
        </div>
        <div>
          <div className="text-base font-bold text-slate-300">{bus.capacity}</div>
          <div className="text-[10px] text-slate-500">Kapasitas</div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>{bus.available} kursi tersedia</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: bus.status_color }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          to={`/bus/${bus.bus_id}`}
          className="flex-1 text-center py-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs rounded-lg transition-colors"
        >
          Detail
        </Link>
        <button
          onClick={() => onEdit(bus.bus_id)}
          className="px-3 py-1.5 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 text-xs rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-sm leading-none">edit</span>
        </button>
      </div>
    </div>
  );
}
