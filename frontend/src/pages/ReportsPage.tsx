import { useEffect, useState, useCallback } from "react";
import KPICards from "../components/Reports/KPICards";
import VehicleBreakdownChart from "../components/Reports/VehicleBreakdownChart";
import VolumeTrendChart from "../components/Reports/VolumeTrendChart";
import ActivityLogsTable from "../components/Reports/ActivityLogsTable";
import {
  Camera,
  getCameras,
  getHeatmap,
  getSummary,
  getSummaryCompare,
  getTrafficData,
  HeatmapPoint,
  SummaryCompare,
  TimeIntervalCount,
  VehicleSummary,
} from "../services/api";

export default function ReportsPage() {
  const [summary, setSummary] = useState<VehicleSummary[]>([]);
  const [trafficData, setTrafficData] = useState<TimeIntervalCount[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [peakHour, setPeakHour] = useState("");
  const [mostActiveRegion, setMostActiveRegion] = useState("");
  const [compare, setCompare] = useState<SummaryCompare | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, heatmapRes, camerasRes, compareRes] = await Promise.all([
        getSummary(),
        getHeatmap(),
        getCameras(),
        getSummaryCompare(),
      ]);
      setSummary(summaryRes.data);
      setCompare(compareRes.data);
      setPoints(heatmapRes.data);
      setCameras(camerasRes.data);

      // Find most active region
      if (heatmapRes.data.length > 0) {
        const top = heatmapRes.data.reduce((a, b) => (a.total_count > b.total_count ? a : b));
        const cam = camerasRes.data.find((c) => c.id === top.camera_id);
        setMostActiveRegion(cam?.name ?? `Camera #${top.camera_id}`);
      }

      // Get traffic data from first camera for trend chart
      if (camerasRes.data.length > 0) {
        const trafficRes = await getTrafficData(camerasRes.data[0].id, {
          interval: "1h",
          date_filter: "today",
        });
        setTrafficData(trafficRes.data);

        // Find peak hour
        const byHour: Record<string, number> = {};
        for (const d of trafficRes.data) {
          byHour[d.time_label] = (byHour[d.time_label] ?? 0) + d.count;
        }
        const entries = Object.entries(byHour);
        if (entries.length > 0) {
          const peak = entries.reduce((a, b) => (a[1] > b[1] ? a : b));
          setPeakHour(peak[0]);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExportCSV = () => {
    const rows = [["Vehicle Type", "Total Count"]];
    for (const s of summary) {
      rows.push([s.vehicle_type, String(s.total_count)]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `road-sight-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <h2 className="text-xl md:text-2xl font-bold text-white">Reports & Analytics</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-card-dark border border-slate-700 rounded-lg text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICards summary={summary} peakHour={peakHour} mostActiveRegion={mostActiveRegion} compare={compare} />

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VehicleBreakdownChart data={summary} />
        <VolumeTrendChart data={trafficData} />
      </div>

      {/* Activity table */}
      <ActivityLogsTable points={points} cameras={cameras} />

      {/* Fixed Export PDF button — bottom-left */}
      <button
        onClick={handleExportPDF}
        className="no-print fixed bottom-6 left-72 z-40 flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-lg shadow-primary/25 transition-colors"
      >
        <span className="material-symbols-outlined text-lg">download</span>
        Export PDF
      </button>
    </div>
  );
}
