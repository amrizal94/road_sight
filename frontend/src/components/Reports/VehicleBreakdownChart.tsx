import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { VehicleSummary } from "../../services/api";

const COLORS: Record<string, string> = {
  car: "#3b82f6",
  motorcycle: "#f59e0b",
  bus: "#10b981",
  truck: "#ef4444",
  bicycle: "#8b5cf6",
};

interface Props {
  data: VehicleSummary[];
}

export default function VehicleBreakdownChart({ data }: Props) {
  const total = data.reduce((acc, d) => acc + d.total_count, 0);

  const chartData = data.map((d) => ({
    name: d.vehicle_type,
    value: d.total_count,
    pct: total > 0 ? Math.round((d.total_count / total) * 100) : 0,
  }));

  return (
    <div className="bg-card-dark border border-slate-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        Vehicle Breakdown
      </h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={COLORS[entry.name] ?? "#6b7280"}
                />
              ))}
              <Label
                position="center"
                content={() => (
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <tspan x="50%" dy="-8" fontSize="20" fontWeight="bold" fill="#ffffff">
                      100%
                    </tspan>
                    <tspan x="50%" dy="22" fontSize="10" fill="#64748b" fontWeight="600" letterSpacing="0.05em">
                      TOTAL SHARE
                    </tspan>
                  </text>
                )}
              />
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a2332",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#e2e8f0",
                fontSize: "12px",
              }}
              formatter={(value: number) => [value.toLocaleString(), "Count"]}
            />
            <Legend
              wrapperStyle={{ color: "#90a9cb", fontSize: "12px" }}
              formatter={(value: string) => {
                const item = chartData.find((d) => d.name === value);
                const pct = item ? item.pct : 0;
                return (
                  <span className="capitalize text-slate-300">
                    {value} ({pct}%)
                  </span>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
