import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { VehicleSummary, TimeIntervalCount, getSummaryCompare, SummaryCompare } from "../../services/api";

const VEHICLE_ICONS: Record<string, string> = {
  car: "directions_car",
  motorcycle: "two_wheeler",
  bus: "directions_bus",
  truck: "local_shipping",
  bicycle: "pedal_bike",
};

const VEHICLE_COLORS: Record<string, string> = {
  car: "text-blue-400",
  motorcycle: "text-amber-400",
  bus: "text-emerald-400",
  truck: "text-red-400",
  bicycle: "text-purple-400",
};

type FlowFilter = "all" | "car" | "motorcycle" | "truck";

const FLOW_FILTERS: { key: FlowFilter; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "car", label: "CARS" },
  { key: "motorcycle", label: "MOTORCYCLES" },
  { key: "truck", label: "TRUCKS" },
];

interface Props {
  summary: VehicleSummary[];
  trafficData: TimeIntervalCount[];
  hasLiveMonitor: boolean;
}

export default function DashboardSidebar({ summary, trafficData, hasLiveMonitor }: Props) {
  const totalCount = summary.reduce((acc, s) => acc + s.total_count, 0);
  const [compare, setCompare] = useState<SummaryCompare | null>(null);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>("all");

  useEffect(() => {
    getSummaryCompare()
      .then((r) => setCompare(r.data))
      .catch(() => {});
  }, []);

  // Pivot traffic data for mini chart
  const byLabel: Record<string, Record<string, number>> = {};
  for (const d of trafficData) {
    if (!byLabel[d.time_label]) byLabel[d.time_label] = {};
    byLabel[d.time_label][d.vehicle_type] = (byLabel[d.time_label][d.vehicle_type] ?? 0) + d.count;
  }
  const chartData = Object.entries(byLabel).map(([label, counts]) => ({
    time: label,
    total:
      flowFilter === "all"
        ? Object.values(counts).reduce((a, b) => a + b, 0)
        : counts[flowFilter] ?? 0,
  }));

  return (
    <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
      {/* Live Statistics */}
      <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Live Statistics
          </h3>
          {hasLiveMonitor && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live
            </span>
          )}
        </div>

        {/* Total KPI */}
        <div className="text-center mb-4 pb-4 border-b border-slate-800">
          <div className="text-4xl font-bold text-white tabular-nums">
            {totalCount.toLocaleString()}
          </div>
          <div className="text-sm text-muted mt-1">Total Vehicles Detected</div>
          {compare && compare.change_pct !== null && (
            <div className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
              compare.change_pct >= 0
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            }`}>
              <span className="material-symbols-outlined text-sm">
                {compare.change_pct >= 0 ? "trending_up" : "trending_down"}
              </span>
              {compare.change_pct >= 0 ? "+" : ""}{compare.change_pct}%
            </div>
          )}
        </div>

        {/* Breakdown per type */}
        <div className="space-y-2">
          {summary.map((item) => (
            <div key={item.vehicle_type} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-lg ${VEHICLE_COLORS[item.vehicle_type] ?? "text-slate-400"}`}>
                  {VEHICLE_ICONS[item.vehicle_type] ?? "directions_car"}
                </span>
                <span className="text-sm text-slate-300 capitalize">{item.vehicle_type}</span>
              </div>
              <span className="text-sm font-semibold text-white tabular-nums">
                {item.total_count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Vehicle Flow mini chart */}
      {chartData.length > 0 && (
        <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Vehicle Flow
          </h3>
          {/* Filter tabs */}
          <div className="flex gap-1 mb-3">
            {FLOW_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFlowFilter(f.key)}
                className={`px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  flowFilter === f.key
                    ? "bg-primary text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="flowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  stroke="#334155"
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1a2332",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  fill="url(#flowGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* System Health */}
      <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          System Health
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-emerald-400">memory</span>
              <span className="text-sm text-slate-300">AI Engine</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Active</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-blue-400">cloud_sync</span>
              <span className="text-sm text-slate-300">Cloud Sync</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Connected</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-amber-400">storage</span>
              <span className="text-sm text-slate-300">Database</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
