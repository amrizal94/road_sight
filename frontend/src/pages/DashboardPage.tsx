import { useEffect, useState, useCallback } from "react";
import TrafficMap from "../components/Map/TrafficMap";
import DashboardSidebar from "../components/Dashboard/DashboardSidebar";
import CameraStrip from "../components/Dashboard/CameraStrip";
import {
  getCameras,
  getHeatmap,
  getTrafficData,
  getSummary,
  getAllLiveMonitors,
  Camera,
  HeatmapPoint,
  LiveStatus,
  TimeIntervalCount,
  VehicleSummary,
} from "../services/api";

const POLL_INTERVAL = 10_000;

export default function DashboardPage() {
  const [summary, setSummary] = useState<VehicleSummary[]>([]);
  const [trafficData, setTrafficData] = useState<TimeIntervalCount[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [liveMonitors, setLiveMonitors] = useState<LiveStatus[]>([]);
  const [hasLiveMonitor, setHasLiveMonitor] = useState(false);

  useEffect(() => {
    getCameras().then((r) => setCameras(r.data)).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, heatmapRes] = await Promise.all([
        getSummary(),
        getHeatmap(),
      ]);
      setSummary(summaryRes.data);
      setPoints(heatmapRes.data);

      // Get traffic data for first camera if available
      if (cameras.length > 0) {
        const trafficRes = await getTrafficData(cameras[0].id, {
          interval: "1h",
          date_filter: "today",
        });
        setTrafficData(trafficRes.data);
      }
    } catch {
      // ignore
    }
  }, [cameras]);

  useEffect(() => {
    const checkLive = async () => {
      try {
        const res = await getAllLiveMonitors();
        setLiveMonitors(res.data);
        setHasLiveMonitor(res.data.some((m) => m.status === "running"));
      } catch {
        setHasLiveMonitor(false);
      }
    };
    checkLive();
    const iv = window.setInterval(checkLive, 10_000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    fetchData();
    if (!hasLiveMonitor) return;
    const iv = window.setInterval(fetchData, POLL_INTERVAL);
    return () => window.clearInterval(iv);
  }, [fetchData, hasLiveMonitor]);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Main content: map + sidebar */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Map area */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <TrafficMap
            points={points}
            cameras={cameras}
            className="flex-1 min-h-[300px] w-full rounded-lg overflow-hidden border border-slate-800"
          />
          {/* Camera strip below map */}
          <CameraStrip cameras={cameras} liveMonitors={liveMonitors} />
        </div>

        {/* Right sidebar */}
        <DashboardSidebar
          summary={summary}
          trafficData={trafficData}
          hasLiveMonitor={hasLiveMonitor}
        />
      </div>
    </div>
  );
}
