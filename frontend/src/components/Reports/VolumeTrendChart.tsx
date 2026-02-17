import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TimeIntervalCount } from "../../services/api";

interface Props {
  data: TimeIntervalCount[];
}

export default function VolumeTrendChart({ data }: Props) {
  // Pivot and aggregate by time_label
  const byLabel: Record<string, number> = {};
  for (const d of data) {
    byLabel[d.time_label] = (byLabel[d.time_label] ?? 0) + d.count;
  }
  const chartData = Object.entries(byLabel).map(([time, total]) => ({ time, total }));

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        Volume Trend
      </h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#223249" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "#90a9cb" }}
              stroke="#334155"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#90a9cb" }}
              stroke="#334155"
              tickLine={false}
            />
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
              fill="url(#trendGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
