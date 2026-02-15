import { VehicleSummary } from "../../services/api";

const ICONS: Record<string, string> = {
  car: "🚗",
  motorcycle: "🏍️",
  bus: "🚌",
  truck: "🚛",
  bicycle: "🚲",
};

export default function StatsCards({ data }: { data: VehicleSummary[] }) {
  // Only show types that have data (count > 0)
  const cols = data.length >= 5 ? "md:grid-cols-5" : data.length >= 3 ? "md:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 ${cols} gap-2 md:gap-4`}>
      {data.map((item) => (
        <div
          key={item.vehicle_type}
          className="bg-white rounded-lg shadow p-3 md:p-4 text-center"
        >
          <div className="text-2xl md:text-3xl">{ICONS[item.vehicle_type] ?? "🚙"}</div>
          <div className="text-xl md:text-2xl font-bold mt-1 md:mt-2">
            {item.total_count.toLocaleString()}
          </div>
          <div className="text-xs md:text-sm text-gray-500 capitalize">{item.vehicle_type}</div>
        </div>
      ))}
    </div>
  );
}
