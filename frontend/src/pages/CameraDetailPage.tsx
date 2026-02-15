import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
import TrafficChart from "../components/Charts/HourlyChart";
import LiveMonitor from "../components/VideoPlayer/LiveMonitor";

// Fix leaflet default marker icon
L.Marker.prototype.options.icon = L.icon({
  iconUrl,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
import {
  Camera,
  DateFilter,
  Detection,
  getCamera,
  getDetections,
  getLiveStatus,
  getTrafficData,
  TimeInterval,
  TimeIntervalCount,
} from "../services/api";

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

export default function CameraDetailPage() {
  const { id } = useParams<{ id: string }>();
  const cameraId = Number(id);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [trafficData, setTrafficData] = useState<TimeIntervalCount[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [interval, setInterval] = useState<TimeInterval>("1h");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  const fetchData = useCallback(() => {
    getTrafficData(cameraId, { interval, date_filter: dateFilter }).then((r) =>
      setTrafficData(r.data)
    );
    getDetections({ camera_id: cameraId, limit: 20 }).then((r) =>
      setDetections(r.data)
    );
    setLastRefresh(new Date());
  }, [cameraId, interval, dateFilter]);

  // Initial load + refetch on filter change
  useEffect(() => {
    getCamera(cameraId).then((r) => setCamera(r.data));
  }, [cameraId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll live status to auto-enable refresh
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await getLiveStatus(cameraId);
        if (active) {
          const running = res.data.status === "running" || res.data.status === "starting";
          setIsAutoRefresh(running);
        }
      } catch {
        if (active) setIsAutoRefresh(false);
      }
    };
    check();
    const id = globalThis.setInterval(check, 5000);
    return () => {
      active = false;
      globalThis.clearInterval(id);
    };
  }, [cameraId]);

  // Auto-refresh polling (15s)
  useEffect(() => {
    if (autoRefreshRef.current) {
      globalThis.clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (isAutoRefresh) {
      autoRefreshRef.current = globalThis.setInterval(fetchData, 15000);
    }
    return () => {
      if (autoRefreshRef.current) {
        globalThis.clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [isAutoRefresh, fetchData]);

  if (!camera) return <div>Loading...</div>;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl md:text-2xl font-bold truncate">{camera.name}</h2>
        <span
          className={`px-2 py-1 rounded text-xs md:text-sm shrink-0 ${
            camera.status === "active"
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {camera.status}
        </span>
      </div>

      {/* Live Monitoring */}
      <LiveMonitor cameraId={cameraId} />

      {/* Camera Location Mini Map */}
      <div className="bg-white rounded-lg shadow p-3 md:p-4">
        <h3 className="text-base md:text-lg font-semibold mb-3">Camera Location</h3>
        <div className="flex flex-col md:flex-row gap-3 md:gap-4">
          <div className="flex-1 h-52 md:h-72">
            <MapContainer
              center={[camera.latitude, camera.longitude]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
              className="rounded-lg"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[camera.latitude, camera.longitude]}>
                <Popup>{camera.name}</Popup>
              </Marker>
            </MapContainer>
          </div>
          <div className="flex flex-row md:flex-col justify-center gap-2 text-sm text-gray-600 md:w-48">
            <div className="bg-gray-50 rounded p-3 flex-1 md:flex-none">
              <span className="block text-xs text-gray-400">Latitude</span>
              <span className="font-mono font-semibold text-gray-800 text-xs md:text-sm">{camera.latitude}</span>
            </div>
            <div className="bg-gray-50 rounded p-3 flex-1 md:flex-none">
              <span className="block text-xs text-gray-400">Longitude</span>
              <span className="font-mono font-semibold text-gray-800 text-xs md:text-sm">{camera.longitude}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Traffic Chart with controls */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
          {/* Interval + Date filter */}
          <div className="flex flex-wrap gap-2">
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

            <button
              onClick={fetchData}
              className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Refresh
            </button>
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-3 sm:ml-auto">
            {isAutoRefresh && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Auto-updating
              </span>
            )}
            {lastRefresh && (
              <span className="text-xs text-gray-400">
                {lastRefresh.toLocaleTimeString("id-ID")}
              </span>
            )}
          </div>
        </div>

        <TrafficChart data={trafficData} interval={interval} dateFilter={dateFilter} />
      </div>

      {/* Recent Detections */}
      <div className="bg-white rounded-lg shadow p-3 md:p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base md:text-lg font-semibold">Recent Detections</h3>
          {isAutoRefresh && (
            <span className="text-xs text-green-600">Live</span>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2">Type</th>
                <th className="py-2">Confidence</th>
                <th className="py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {detections.map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="py-2 capitalize">{d.vehicle_type}</td>
                  <td className="py-2">{(d.confidence * 100).toFixed(1)}%</td>
                  <td className="py-2 text-gray-500">
                    {new Date(d.timestamp).toLocaleString("id-ID")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="sm:hidden space-y-2">
          {detections.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b pb-2 text-sm">
              <div>
                <span className="capitalize font-medium">{d.vehicle_type}</span>
                <span className="text-gray-400 ml-2">{(d.confidence * 100).toFixed(0)}%</span>
              </div>
              <span className="text-xs text-gray-400">
                {new Date(d.timestamp).toLocaleTimeString("id-ID")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
