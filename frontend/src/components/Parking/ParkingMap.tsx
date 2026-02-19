import L from "leaflet";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import { OccupancyStatus } from "../../services/api";

// Fix leaflet default icon
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
L.Marker.prototype.options.icon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
});

const PARKING_TIERS = [
  { color: "#22c55e", label: "Tersedia" },
  { color: "#f59e0b", label: "Sibuk" },
  { color: "#f97316", label: "Hampir Penuh" },
  { color: "#ef4444", label: "Penuh" },
];

function ParkingLegend() {
  const map = useMap();

  useEffect(() => {
    const legend = new L.Control({ position: "bottomright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.style.cssText =
        "background:rgba(15,23,42,0.85);padding:10px 14px;border-radius:8px;border:1px solid rgba(148,163,184,0.2);backdrop-filter:blur(4px);";
      div.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Status Parkir</div>
        ${PARKING_TIERS.map(
          (t) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${t.color};display:inline-block;flex-shrink:0;"></span>
            <span style="font-size:11px;color:#e2e8f0;">${t.label}</span>
          </div>`
        ).join("")}
      `;
      return div;
    };

    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map]);

  return null;
}

interface Props {
  lots: OccupancyStatus[];
  center?: [number, number];
  className?: string;
}

export default function ParkingMap({
  lots,
  center = [-6.2, 106.85],
  className,
}: Props) {
  return (
    <div className={className ?? "h-72 sm:h-96 md:h-[500px] w-full rounded-lg overflow-hidden border border-slate-800"}>
      <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <ParkingLegend />
        {lots.map((lot) => (
          <span key={lot.lot_id}>
            {/* Outer pulse ring */}
            <CircleMarker
              center={[lot.latitude, lot.longitude]}
              radius={22}
              pathOptions={{
                color: lot.status_color,
                fillColor: lot.status_color,
                fillOpacity: 0.2,
                weight: 1,
                opacity: 0.3,
              }}
              interactive={false}
            />
            {/* Inner marker */}
            <CircleMarker
              center={[lot.latitude, lot.longitude]}
              radius={10}
              pathOptions={{
                color: "#ffffff",
                fillColor: lot.status_color,
                fillOpacity: 0.9,
                weight: 2,
                opacity: 0.7,
              }}
            >
              <Popup minWidth={200}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{lot.name}</strong>
                  {lot.is_live && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 3,
                      padding: "1px 6px", borderRadius: 9999,
                      fontSize: 9, fontWeight: 700, background: "#dc2626", color: "#fff",
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
                      LIVE
                    </span>
                  )}
                </div>
                {lot.address && (
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{lot.address}</div>
                )}
                <span style={{
                  display: "inline-block", marginBottom: 6,
                  padding: "2px 8px", borderRadius: 9999,
                  fontSize: 11, fontWeight: 600, color: "#fff",
                  background: lot.status_color,
                }}>
                  {lot.status_label}
                </span>
                <div style={{ fontSize: 12, marginBottom: 2 }}>
                  Terisi: {lot.occupied_spaces} / {lot.total_spaces}
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  Tersedia: {lot.available_spaces} ({(100 - lot.occupancy_pct).toFixed(1)}%)
                </div>
                <Link to={`/parking/${lot.lot_id}`} className="text-primary underline" style={{ fontSize: 12 }}>
                  Lihat Detail
                </Link>
              </Popup>
            </CircleMarker>
          </span>
        ))}
      </MapContainer>
    </div>
  );
}
