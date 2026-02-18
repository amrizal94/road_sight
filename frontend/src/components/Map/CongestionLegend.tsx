import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

const TIERS = [
  { color: "#22c55e", label: "Low Traffic" },
  { color: "#f59e0b", label: "Moderate" },
  { color: "#f97316", label: "Heavy" },
  { color: "#ef4444", label: "Severe" },
];

export default function CongestionLegend() {
  const map = useMap();

  useEffect(() => {
    const legend = new L.Control({ position: "bottomright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.style.cssText =
        "background:rgba(15,23,42,0.85);padding:10px 14px;border-radius:8px;border:1px solid rgba(148,163,184,0.2);backdrop-filter:blur(4px);";

      div.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Congestion Level</div>
        ${TIERS.map(
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
    return () => {
      legend.remove();
    };
  }, [map]);

  return null;
}
