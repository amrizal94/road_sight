import { useEffect, useState } from "react";
import TrafficMap from "../components/Map/TrafficMap";
import {
  Camera,
  createCamera,
  deleteCamera,
  getAllLiveMonitors,
  getCameras,
  getHeatmap,
  HeatmapPoint,
  LiveStatus,
  updateCamera,
} from "../services/api";

function parseGoogleMapsUrl(url: string) {
  const nameMatch = url.match(/\/place\/([^/@]+)/);
  const name = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, " ")) : "";

  let lat = "";
  let lng = "";

  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    lat = atMatch[1];
    lng = atMatch[2];
  }

  const dMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dMatch) {
    lat = dMatch[1];
    lng = dMatch[2];
  }

  return { name, lat, lng };
}

export default function MapPage() {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", latitude: "", longitude: "" });
  const [gmapsUrl, setGmapsUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", latitude: "", longitude: "" });

  const [focusCamera, setFocusCamera] = useState<Camera | null>(null);

  const [liveMonitors, setLiveMonitors] = useState<LiveStatus[]>([]);

  const fetchData = (retries = 2) => {
    getHeatmap()
      .then((r) => setPoints(r.data))
      .catch(() => {
        if (retries > 0) setTimeout(() => fetchData(retries - 1), 2000);
      });
    getCameras()
      .then((r) => setCameras(r.data))
      .catch(() => {});
    getAllLiveMonitors()
      .then((r) => setLiveMonitors(r.data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      getAllLiveMonitors()
        .then((r) => setLiveMonitors(r.data))
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const getMonitorStatus = (cameraId: number) => {
    const m = liveMonitors.find((s) => s.camera_id === cameraId);
    if (m?.status === "running") return "monitoring";
    return "idle";
  };

  const handlePasteUrl = (url: string) => {
    setGmapsUrl(url);
    if (url.includes("google.com/maps")) {
      const parsed = parseGoogleMapsUrl(url);
      setForm({
        name: parsed.name || form.name,
        latitude: parsed.lat || form.latitude,
        longitude: parsed.lng || form.longitude,
      });
    }
  };

  const handleAdd = async () => {
    if (!form.name || !form.latitude || !form.longitude) return;
    setLoading(true);
    try {
      await createCamera({
        name: form.name,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        status: "active",
      });
      setForm({ name: "", latitude: "", longitude: "" });
      setGmapsUrl("");
      setShowForm(false);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to add camera");
    }
    setLoading(false);
  };

  const handleEdit = (cam: Camera) => {
    setEditingId(cam.id);
    setEditForm({
      name: cam.name,
      latitude: String(cam.latitude),
      longitude: String(cam.longitude),
    });
  };

  const handleEditSave = async (id: number) => {
    setLoading(true);
    try {
      await updateCamera(id, {
        name: editForm.name,
        latitude: parseFloat(editForm.latitude),
        longitude: parseFloat(editForm.longitude),
      });
      setEditingId(null);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to update camera");
    }
    setLoading(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete camera "${name}"? This will also delete all related detection data.`)) return;
    setLoading(true);
    try {
      await deleteCamera(id);
      fetchData();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to delete camera");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-white">Traffic Map</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-primary text-white px-3 md:px-4 py-2 rounded-lg hover:bg-blue-700 text-xs md:text-sm transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Camera"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card-dark border border-slate-800 rounded-lg p-3 md:p-4 space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">
              Paste Google Maps URL (auto-fill name & coordinates)
            </label>
            <input
              type="text"
              placeholder="https://www.google.com/maps/place/..."
              value={gmapsUrl}
              onChange={(e) => handlePasteUrl(e.target.value)}
              className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 text-sm w-full placeholder-slate-500 focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-muted mb-1">Name</label>
              <input
                type="text"
                placeholder="Cam Sudirman"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 text-sm w-full placeholder-slate-500 focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  placeholder="-6.2088"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 text-sm w-full placeholder-slate-500 focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  placeholder="106.8456"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                  className="bg-card-dark-alt border border-slate-700 text-white rounded px-3 py-2 text-sm w-full placeholder-slate-500 focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={handleAdd}
              disabled={loading}
              className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 text-sm disabled:opacity-50 w-full sm:w-auto transition-colors"
            >
              {loading ? "Adding..." : "Add Camera"}
            </button>
          </div>
        </div>
      )}

      <TrafficMap points={points} cameras={cameras} focusCamera={focusCamera} />

      {/* Camera List */}
      {cameras.length > 0 && (
        <div className="bg-card-dark border border-slate-800 rounded-lg p-3 md:p-4">
          <h3 className="text-lg font-semibold mb-3 text-slate-200">Camera List</h3>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-muted">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Latitude</th>
                  <th className="py-2 pr-4">Longitude</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map((cam) => (
                  <tr
                    key={cam.id}
                    className={`border-b border-slate-800 cursor-pointer transition-colors ${
                      focusCamera?.id === cam.id
                        ? "bg-primary/10"
                        : "hover:bg-slate-800/50"
                    }`}
                    onClick={() => editingId !== cam.id && setFocusCamera(cam)}
                  >
                    {editingId === cam.id ? (
                      <>
                        <td className="py-2 pr-4">
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1 text-sm w-full focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            step="any"
                            value={editForm.latitude}
                            onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                            className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1 text-sm w-28 focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            step="any"
                            value={editForm.longitude}
                            onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                            className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1 text-sm w-28 focus:border-primary focus:outline-none"
                          />
                        </td>
                        <td className="py-2 pr-4 text-slate-400">{cam.status}</td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditSave(cam.id)}
                              disabled={loading}
                              className="bg-emerald-600 text-white px-3 py-1 rounded text-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="bg-slate-700 text-slate-300 px-3 py-1 rounded text-xs hover:bg-slate-600 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-4 font-medium text-slate-200">{cam.name}</td>
                        <td className="py-2 pr-4 font-mono text-slate-400">{cam.latitude}</td>
                        <td className="py-2 pr-4 font-mono text-slate-400">{cam.longitude}</td>
                        <td className="py-2 pr-4">
                          {getMonitorStatus(cam.id) === "monitoring" ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
                              </span>
                              Live
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-500">
                              Idle
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(cam)}
                              className="bg-primary/20 text-primary px-3 py-1 rounded text-xs hover:bg-primary/30 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(cam.id, cam.name)}
                              className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {cameras.map((cam) => (
              <div
                key={cam.id}
                className={`border rounded-lg p-3 transition-colors ${
                  focusCamera?.id === cam.id
                    ? "border-primary bg-primary/10"
                    : "border-slate-700"
                }`}
                onClick={() => editingId !== cam.id && setFocusCamera(cam)}
              >
                {editingId === cam.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1.5 text-sm w-full placeholder-slate-500 focus:border-primary focus:outline-none"
                      placeholder="Name"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        value={editForm.latitude}
                        onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                        className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1.5 text-sm flex-1 placeholder-slate-500 focus:border-primary focus:outline-none"
                        placeholder="Latitude"
                      />
                      <input
                        type="number"
                        step="any"
                        value={editForm.longitude}
                        onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                        className="bg-card-dark-alt border border-slate-700 text-white rounded px-2 py-1.5 text-sm flex-1 placeholder-slate-500 focus:border-primary focus:outline-none"
                        placeholder="Longitude"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditSave(cam.id)}
                        disabled={loading}
                        className="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs hover:bg-emerald-700 disabled:opacity-50 flex-1 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-xs hover:bg-slate-600 flex-1 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-slate-200">{cam.name}</span>
                      {getMonitorStatus(cam.id) === "monitoring" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
                          </span>
                          Live
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-500">
                          Idle
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted font-mono mb-2">
                      {cam.latitude}, {cam.longitude}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(cam); }}
                        className="bg-primary/20 text-primary px-3 py-1 rounded text-xs hover:bg-primary/30 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(cam.id, cam.name); }}
                        className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
