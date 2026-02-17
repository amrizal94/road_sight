import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HourlyCount, TimeIntervalCount, TimeInterval, DateFilter } from "../../services/api";

const COLORS: Record<string, string> = {
  car: "#3b82f6",
  motorcycle: "#f59e0b",
  bus: "#10b981",
  truck: "#ef4444",
  bicycle: "#8b5cf6",
};

const INTERVAL_LABELS: Record<TimeInterval, string> = {
  "5m": "5-Minute",
  "15m": "15-Minute",
  "30m": "30-Minute",
  "1h": "Hourly",
};

const DATE_LABELS: Record<DateFilter, string> = {
  today: "Today",
  "24h": "Last 24h",
  all: "All Time",
};

interface Props {
  data: TimeIntervalCount[];
  interval: TimeInterval;
  dateFilter: DateFilter;
}

/** Backward-compatible wrapper for DashboardPage */
export function HourlyChart({ data }: { data: HourlyCount[] }) {
  const converted: TimeIntervalCount[] = data.map((d) => ({
    time_label: `${String(d.hour).padStart(2, "0")}:00`,
    vehicle_type: d.vehicle_type,
    count: d.count,
  }));
  return <TrafficChart data={converted} interval="1h" dateFilter="today" />;
}

export default function TrafficChart({ data, interval, dateFilter }: Props) {
  // Pivot data by time_label
  const byLabel: Record<string, Record<string, string | number>> = {};
  for (const d of data) {
    if (!byLabel[d.time_label]) byLabel[d.time_label] = { time_label: d.time_label };
    byLabel[d.time_label][d.vehicle_type] = d.count;
  }
  const chartData = Object.values(byLabel);

  const vehicleTypes = [...new Set(data.map((d) => d.vehicle_type))];

  const title = `${INTERVAL_LABELS[interval]} Traffic - ${DATE_LABELS[dateFilter]}`;
  const rotateLabels = interval === "5m" || interval === "15m";

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-3 md:p-4">
      <h3 className="text-sm md:text-lg font-semibold mb-3 md:mb-4 text-slate-200">{title}</h3>
      <div className="h-52 md:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#223249" />
          <XAxis
            dataKey="time_label"
            angle={rotateLabels ? -45 : 0}
            textAnchor={rotateLabels ? "end" : "middle"}
            height={rotateLabels ? 60 : 30}
            tick={{ fontSize: rotateLabels ? 10 : 12, fill: "#90a9cb" }}
            stroke="#334155"
          />
          <YAxis tick={{ fill: "#90a9cb" }} stroke="#334155" />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a2332",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#e2e8f0",
            }}
          />
          <Legend wrapperStyle={{ color: "#90a9cb" }} />
          {vehicleTypes.map((vt) => (
            <Bar
              key={vt}
              dataKey={vt}
              fill={COLORS[vt] ?? "#6b7280"}
              stackId="a"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
