import L from "leaflet";
import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { Link } from "react-router-dom";
import { Camera, HeatmapPoint } from "../../services/api";
import CongestionLegend from "./CongestionLegend";

// Fix leaflet default icon
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
L.Marker.prototype.options.icon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
});

interface CongestionInfo {
  color: string;
  label: string;
  level: "low" | "moderate" | "heavy" | "severe";
}

function getCongestionInfo(count: number): CongestionInfo {
  if (count > 500) return { color: "#ef4444", label: "Severe", level: "severe" };
  if (count > 300) return { color: "#f97316", label: "Heavy", level: "heavy" };
  if (count > 100) return { color: "#f59e0b", label: "Moderate", level: "moderate" };
  return { color: "#22c55e", label: "Low Traffic", level: "low" };
}

/** Flies the map to a camera location when focusCamera changes */
function FlyToCamera({ camera }: { camera: Camera | null }) {
  const map = useMap();

  useEffect(() => {
    if (!camera) return;
    map.flyTo([camera.latitude, camera.longitude], 16, { duration: 1.2 });
  }, [camera, map]);

  return null;
}

interface Props {
  points: HeatmapPoint[];
  cameras?: Camera[];
  center?: [number, number];
  focusCamera?: Camera | null;
  className?: string;
}

export default function TrafficMap({
  points,
  cameras = [],
  center = [-6.2, 106.85],
  focusCamera = null,
  className,
}: Props) {
  const markerRefs = useRef<Record<number, L.CircleMarker>>({});

  // Open popup when focusCamera changes
  useEffect(() => {
    if (focusCamera) {
      const marker = markerRefs.current[focusCamera.id];
      if (marker) {
        setTimeout(() => marker.openPopup(), 1300);
      }
    }
  }, [focusCamera]);

  // Find camera name by id
  const cameraNames: Record<number, string> = {};
  for (const c of cameras) {
    cameraNames[c.id] = c.name;
  }

  return (
    <div className={className ?? "h-72 sm:h-96 md:h-[500px] w-full rounded-lg overflow-hidden border border-slate-800"}>
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <FlyToCamera camera={focusCamera} />
      <CongestionLegend />
      {points.map((p) => {
        const info = getCongestionInfo(p.total_count);
        const isFocused = focusCamera?.id === p.camera_id;
        const color = isFocused ? "#3b82f6" : info.color;
        const innerRadius = Math.max(8, Math.min(20, p.total_count / 20));

        return (
          <span key={p.camera_id}>
            {/* Outer pulse ring */}
            <CircleMarker
              center={[p.latitude, p.longitude]}
              radius={innerRadius + 14}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.25,
                weight: 1,
                opacity: 0.3,
                className: "congestion-pulse",
              }}
              interactive={false}
            />
            {/* Inner marker */}
            <CircleMarker
              ref={(ref) => {
                if (ref) markerRefs.current[p.camera_id] = ref;
              }}
              center={[p.latitude, p.longitude]}
              radius={innerRadius}
              pathOptions={{
                color: isFocused ? "#93c5fd" : "#ffffff",
                fillColor: color,
                fillOpacity: isFocused ? 0.95 : 0.9,
                weight: isFocused ? 3 : 2,
                opacity: isFocused ? 1 : 0.6,
                className: "congestion-marker",
              }}
            >
              <Popup>
                <strong>{cameraNames[p.camera_id] ?? `Camera #${p.camera_id}`}</strong>
                <br />
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    marginBottom: 4,
                    padding: "2px 8px",
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    background: info.color,
                  }}
                >
                  {info.label}
                </span>
                <br />
                Total: {p.total_count.toLocaleString()} vehicles
                <br />
                <Link
                  to={`/cameras/${p.camera_id}`}
                  className="text-primary underline"
                >
                  View Details
                </Link>
              </Popup>
            </CircleMarker>
          </span>
        );
      })}
    </MapContainer>
    </div>
  );
}
