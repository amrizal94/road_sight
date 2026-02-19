import { Link } from "react-router-dom";
import { OccupancyStatus } from "../../services/api";

interface Props {
  lot: OccupancyStatus;
  onEdit: (lotId: number) => void;
}

export default function ParkingLotCard({ lot, onEdit }: Props) {
  const barWidth = `${Math.min(100, lot.occupancy_pct)}%`;

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-200 truncate">{lot.name}</h3>
          {lot.address && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{lot.address}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {lot.is_live && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-600 text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
              LIVE
            </span>
          )}
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
            style={{ background: lot.status_color }}
          >
            {lot.status_label}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{lot.occupied_spaces} terisi</span>
          <span>{lot.occupancy_pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: barWidth, background: lot.status_color }}
          />
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {lot.available_spaces} tersedia dari {lot.total_spaces} tempat
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Link
          to={`/parking/${lot.lot_id}`}
          className="flex-1 text-center text-xs py-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-medium"
        >
          Detail
        </Link>
        <button
          onClick={() => onEdit(lot.lot_id)}
          className="flex-1 text-xs py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors font-medium"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
