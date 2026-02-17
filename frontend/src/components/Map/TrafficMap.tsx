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

// Fix leaflet default icon
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
L.Marker.prototype.options.icon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
});

function getColor(count: number) {
  if (count > 500) return "#ef4444"; // red
  if (count > 100) return "#f59e0b"; // yellow
  return "#22c55e"; // green
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
      {points.map((p) => (
        <CircleMarker
          key={p.camera_id}
          ref={(ref) => {
            if (ref) markerRefs.current[p.camera_id] = ref;
          }}
          center={[p.latitude, p.longitude]}
          radius={Math.max(8, Math.min(20, p.total_count / 20))}
          pathOptions={{
            color:
              focusCamera?.id === p.camera_id
                ? "#3b82f6"
                : getColor(p.total_count),
            fillColor:
              focusCamera?.id === p.camera_id
                ? "#3b82f6"
                : getColor(p.total_count),
            fillOpacity: focusCamera?.id === p.camera_id ? 0.9 : 0.7,
            weight: focusCamera?.id === p.camera_id ? 3 : 1,
          }}
        >
          <Popup>
            <strong>{cameraNames[p.camera_id] ?? `Camera #${p.camera_id}`}</strong>
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
      ))}
    </MapContainer>
    </div>
  );
}
