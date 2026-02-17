import { VehicleSummary } from "../../services/api";

const ICONS: Record<string, string> = {
  car: "directions_car",
  motorcycle: "two_wheeler",
  bus: "directions_bus",
  truck: "local_shipping",
  bicycle: "pedal_bike",
};

const ICON_COLORS: Record<string, string> = {
  car: "text-blue-400",
  motorcycle: "text-amber-400",
  bus: "text-emerald-400",
  truck: "text-red-400",
  bicycle: "text-purple-400",
};

export default function StatsCards({ data }: { data: VehicleSummary[] }) {
  const cols = data.length >= 5 ? "md:grid-cols-5" : data.length >= 3 ? "md:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 ${cols} gap-2 md:gap-4`}>
      {data.map((item) => (
        <div
          key={item.vehicle_type}
          className="bg-card-dark border border-slate-800 rounded-lg p-3 md:p-4 text-center"
        >
          <span
            className={`material-symbols-outlined text-2xl md:text-3xl ${
              ICON_COLORS[item.vehicle_type] ?? "text-slate-400"
            }`}
          >
            {ICONS[item.vehicle_type] ?? "directions_car"}
          </span>
          <div className="text-xl md:text-2xl font-bold mt-1 md:mt-2 text-white">
            {item.total_count.toLocaleString()}
          </div>
          <div className="text-xs md:text-sm text-muted capitalize">{item.vehicle_type}</div>
        </div>
      ))}
    </div>
  );
}
