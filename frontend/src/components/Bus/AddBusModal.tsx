import { useEffect, useState } from "react";
import { Bus, BusCreate, createBus, updateBus } from "../../services/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editBus?: Bus | null;
}

const EMPTY: BusCreate = {
  name: "",
  number: "",
  capacity: 40,
  route: "",
  stream_url: "",
  overhead_stream_url: "",
  status: "active",
};

export default function AddBusModal({ open, onClose, onSaved, editBus }: Props) {
  const [form, setForm] = useState<BusCreate>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editBus) {
      setForm({
        name: editBus.name,
        number: editBus.number ?? "",
        capacity: editBus.capacity,
        route: editBus.route ?? "",
        stream_url: editBus.stream_url ?? "",
        overhead_stream_url: editBus.overhead_stream_url ?? "",
        status: editBus.status,
      });
    } else {
      setForm(EMPTY);
    }
    setError("");
  }, [editBus, open]);

  if (!open) return null;

  const set = (field: keyof BusCreate, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Nama bus wajib diisi"); return; }
    if (!form.capacity || form.capacity < 1) { setError("Kapasitas minimal 1"); return; }

    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        number: form.number || null,
        route: form.route || null,
        stream_url: form.stream_url || null,
        overhead_stream_url: form.overhead_stream_url || null,
      };
      if (editBus) {
        await updateBus(editBus.id, payload);
      } else {
        await createBus(payload);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">
            {editBus ? "Edit Bus" : "Tambah Bus Baru"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Nama Bus *</label>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="contoh: Bus Kota 01"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Nomor / Plat</label>
              <input
                value={form.number ?? ""}
                onChange={(e) => set("number", e.target.value)}
                placeholder="contoh: B 1234 CD"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Kapasitas Kursi *</label>
              <input
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => set("capacity", parseInt(e.target.value) || 0)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Rute</label>
              <input
                value={form.route ?? ""}
                onChange={(e) => set("route", e.target.value)}
                placeholder="contoh: Blok M - Kota"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <hr className="border-slate-800" />

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Stream URL Kamera Pintu
              <span className="ml-1 text-slate-500 font-normal">(untuk Passenger Counter)</span>
            </label>
            <input
              value={form.stream_url ?? ""}
              onChange={(e) => set("stream_url", e.target.value)}
              placeholder="YouTube URL atau rtsp://..."
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Overhead Stream URL
              <span className="ml-1 text-slate-500 font-normal">(untuk Seat Detection)</span>
            </label>
            <input
              value={form.overhead_stream_url ?? ""}
              onChange={(e) => set("overhead_stream_url", e.target.value)}
              placeholder="YouTube URL atau rtsp://..."
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm hover:bg-slate-700 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/80 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? "Menyimpan..." : editBus ? "Simpan Perubahan" : "Tambah Bus"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
