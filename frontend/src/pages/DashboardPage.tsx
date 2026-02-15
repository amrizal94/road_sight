import { useEffect, useState, useCallback } from "react";
import TrafficChart from "../components/Charts/HourlyChart";
import StatsCards from "../components/Dashboard/StatsCards";
import {
  getCameras,
  getTrafficData,
  getSummary,
  getAllLiveMonitors,
  Camera,
  TimeIntervalCount,
  VehicleSummary,
  TimeInterval,
  DateFilter,
} from "../services/api";

const POLL_INTERVAL = 10_000;

const INTERVALS: { value: TimeInterval; label: string }[] = [
  { value: "5m", label: "5M" },
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "1h", label: "1H" },
];

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "all", label: "All" },
];

export default function DashboardPage() {
  const [summary, setSummary] = useState<VehicleSummary[]>([]);
  const [trafficData, setTrafficData] = useState<TimeIntervalCount[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<number | null>(null);
  const [interval, setInterval] = useState<TimeInterval>("1h");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [hasLiveMonitor, setHasLiveMonitor] = useState(false);

  // Load cameras once
  useEffect(() => {
    getCameras().then((r) => {
      setCameras(r.data);
      if (r.data.length > 0 && selectedCamera === null) {
        setSelectedCamera(r.data[0].id);
      }
    });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const summaryRes = await getSummary();
      setSummary(summaryRes.data);
      if (selectedCamera !== null) {
        const trafficRes = await getTrafficData(selectedCamera, {
          interval,
          date_filter: dateFilter,
        });
        setTrafficData(trafficRes.data);
      }
      setLastUpdate(new Date());
    } catch {
      // ignore fetch errors
    }
  }, [selectedCamera, interval, dateFilter]);

  // Check if any live monitor is active
  useEffect(() => {
    const checkLive = async () => {
      try {
        const res = await getAllLiveMonitors();
        setHasLiveMonitor(res.data.some((m) => m.status === "running"));
      } catch {
        setHasLiveMonitor(false);
      }
    };
    checkLive();
    const iv = window.setInterval(checkLive, 30_000);
    return () => window.clearInterval(iv);
  }, []);

  // Fetch data on filter change + auto-refresh
  useEffect(() => {
    fetchData();
    if (!hasLiveMonitor) return;

    const iv = window.setInterval(fetchData, POLL_INTERVAL);
    return () => window.clearInterval(iv);
  }, [fetchData, hasLiveMonitor]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-bold">Dashboard</h2>
        {lastUpdate && (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-400">
            {hasLiveMonitor && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            {hasLiveMonitor ? "Auto-updating" : "Last update"} &middot;{" "}
            {lastUpdate.toLocaleTimeString("id-ID")}
          </div>
        )}
      </div>

      <StatsCards data={summary} />

      {/* Traffic Chart with controls */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
          {/* Camera selector */}
          {cameras.length > 1 && (
            <select
              value={selectedCamera ?? ""}
              onChange={(e) => setSelectedCamera(Number(e.target.value))}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Interval + Date filter row */}
          <div className="flex flex-wrap gap-2">
            {/* Interval toggles */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterval(opt.value)}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                    interval === opt.value
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Date filter toggles */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {DATE_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDateFilter(opt.value)}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                    dateFilter === opt.value
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <button
              onClick={fetchData}
              className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <TrafficChart data={trafficData} interval={interval} dateFilter={dateFilter} />
      </div>
    </div>
  );
}
