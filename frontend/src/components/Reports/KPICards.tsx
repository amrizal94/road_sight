import { SummaryCompare, VehicleSummary } from "../../services/api";

interface Props {
  summary: VehicleSummary[];
  peakHour: string;
  mostActiveRegion: string;
  compare: SummaryCompare | null;
}

export default function KPICards({ summary, peakHour, mostActiveRegion, compare }: Props) {
  const totalVehicles = summary.reduce((acc, s) => acc + s.total_count, 0);

  // Build peak hour range display
  const formatPeakHourRange = (hour: string) => {
    if (!hour) return "—";
    // If it's already a range or not a simple HH:MM, return as-is
    const match = hour.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return hour;
    const h = parseInt(match[1], 10);
    const nextH = (h + 1) % 24;
    const fmt = (n: number) => String(n).padStart(2, "0") + ":00";
    return `${fmt(h)} - ${fmt(nextH)}`;
  };

  const peakHourPeriod = (() => {
    if (!peakHour) return "";
    const match = peakHour.match(/^(\d{1,2}):/);
    if (!match) return "";
    const h = parseInt(match[1], 10);
    return h < 12 ? "AM Period Peak" : "PM Period Peak";
  })();

  const cards = [
    {
      icon: "directions_car",
      iconColor: "text-blue-400",
      bgColor: "bg-blue-500/15",
      label: "Total Vehicles",
      value: totalVehicles.toLocaleString(),
      subLabel: null as string | null,
      change: compare,
    },
    {
      icon: "schedule",
      iconColor: "text-amber-400",
      bgColor: "bg-amber-500/15",
      label: "Peak Hour",
      value: formatPeakHourRange(peakHour),
      subLabel: peakHourPeriod,
      change: null,
    },
    {
      icon: "location_on",
      iconColor: "text-emerald-400",
      bgColor: "bg-emerald-500/15",
      label: "Most Active Region",
      value: mostActiveRegion || "—",
      subLabel: mostActiveRegion ? "Primary monitoring zone" : null,
      change: null,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-card-dark border border-slate-800 rounded-lg p-4 flex items-center justify-between"
        >
          {/* Left: value + label */}
          <div className="min-w-0">
            <div className="text-xs text-muted uppercase tracking-wider">{card.label}</div>
            <div className="text-xl font-bold text-white mt-0.5">{card.value}</div>
            {card.subLabel && (
              <div className="text-[11px] text-slate-500 mt-0.5">{card.subLabel}</div>
            )}
            {card.change && card.change.change_pct !== null && (
              <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${
                card.change.change_pct >= 0 ? "text-emerald-400" : "text-red-400"
              }`}>
                <span className="material-symbols-outlined text-sm">
                  {card.change.change_pct >= 0 ? "trending_up" : "trending_down"}
                </span>
                {card.change.change_pct >= 0 ? "+" : ""}{card.change.change_pct}% from yesterday
              </div>
            )}
          </div>

          {/* Right: large icon */}
          <div className={`w-12 h-12 rounded-full ${card.bgColor} flex items-center justify-center shrink-0 ml-4`}>
            <span className={`material-symbols-outlined text-2xl ${card.iconColor}`}>
              {card.icon}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
