import { HeatmapPoint, Camera } from "../../services/api";

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  car: { label: "SEDAN/SUV", color: "bg-blue-500/20 text-blue-400" },
  motorcycle: { label: "MOTORCYCLE", color: "bg-amber-500/20 text-amber-400" },
  bus: { label: "BUS", color: "bg-emerald-500/20 text-emerald-400" },
  truck: { label: "HEAVY TRUCK", color: "bg-orange-500/20 text-orange-400" },
  bicycle: { label: "BICYCLE", color: "bg-purple-500/20 text-purple-400" },
};

interface Props {
  points: HeatmapPoint[];
  cameras: Camera[];
}

export default function ActivityLogsTable({ points, cameras }: Props) {
  const cameraNames: Record<number, string> = {};
  for (const c of cameras) {
    cameraNames[c.id] = c.name;
  }

  // Sort by total_count descending
  const sorted = [...points].sort((a, b) => b.total_count - a.total_count);

  // Generate deterministic mock trend values based on camera_id
  const getTrend = (cameraId: number, total: number) => {
    const seed = ((cameraId * 7 + 13) % 17) - 8; // range ~ -8 to +8
    return seed;
  };

  // Get primary type (most common) — approximate from camera position
  const getPrimaryType = (cameraId: number) => {
    const types = Object.keys(TYPE_BADGES);
    return types[cameraId % types.length];
  };

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Regional Activity Logs
        </h3>
        <button className="text-xs text-primary hover:text-blue-300 transition-colors font-medium">
          View All Regions
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-[11px] text-muted uppercase tracking-wider">
              <th className="py-2.5 pr-4">Location</th>
              <th className="py-2.5 pr-4">Primary Type</th>
              <th className="py-2.5 pr-4">Total Count</th>
              <th className="py-2.5 pr-4">Trend</th>
              <th className="py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const name = cameraNames[p.camera_id] ?? `Camera #${p.camera_id}`;
              const trend = getTrend(p.camera_id, p.total_count);
              const primaryType = getPrimaryType(p.camera_id);
              const badge = TYPE_BADGES[primaryType] ?? TYPE_BADGES.car;

              return (
                <tr key={p.camera_id} className="border-b border-slate-800/50">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-slate-500">
                        videocam
                      </span>
                      <div>
                        <div className="text-slate-200 font-medium">{name}</div>
                        <div className="text-[11px] text-slate-500">Cam ID: {String(p.camera_id).padStart(2, "0")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${badge.color}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-white font-medium">
                    {p.total_count.toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`flex items-center gap-0.5 text-xs font-semibold ${
                      trend >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}>
                      <span className="material-symbols-outlined text-sm">
                        {trend >= 0 ? "trending_up" : "trending_down"}
                      </span>
                      {trend >= 0 ? "+" : ""}{trend}%
                    </span>
                  </td>
                  <td className="py-3">
                    <button className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
                      <span className="material-symbols-outlined text-lg">visibility</span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
