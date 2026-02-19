import { useEffect, useState } from "react";
import {
  ParkingLot,
  ParkingLotCreate,
  createParkingLot,
  updateParkingLot,
} from "../../services/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editLot?: ParkingLot | null;
}

const EMPTY_FORM: ParkingLotCreate = {
  name: "",
  address: "",
  latitude: -6.2,
  longitude: 106.85,
  total_spaces: 50,
  initial_occupied: 0,
  status: "active",
  stream_url: "",
};

export default function AddParkingLotModal({ open, onClose, onSaved, editLot }: Props) {
  const [form, setForm] = useState<ParkingLotCreate>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editLot) {
      setForm({
        name: editLot.name,
        address: editLot.address ?? "",
        latitude: editLot.latitude,
        longitude: editLot.longitude,
        total_spaces: editLot.total_spaces,
        initial_occupied: editLot.initial_occupied,
        status: editLot.status,
        stream_url: editLot.stream_url ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError("");
  }, [editLot, open]);

  if (!open) return null;

  const set = (field: keyof ParkingLotCreate, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Nama wajib diisi"); return; }
    if (!form.total_spaces || form.total_spaces < 1) { setError("Total tempat minimal 1"); return; }
    setLoading(true);
    setError("");
    try {
      const payload = {
        ...form,
        stream_url: form.stream_url?.trim() || null,
      };
      if (editLot) {
        await updateParkingLot(editLot.id, payload);
      } else {
        await createParkingLot(payload);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || "Gagal menyimpan");
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-sidebar-dark border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-200">
            {editLot ? "Edit Lot Parkir" : "Tambah Lot Parkir"}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nama *</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Parkiran Mal XYZ"
              className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none placeholder-slate-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Alamat</label>
            <input
              value={form.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Jl. Contoh No. 1"
              className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none placeholder-slate-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Latitude *</label>
              <input
                type="number" step="any"
                value={form.latitude}
                onChange={(e) => set("latitude", parseFloat(e.target.value))}
                className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Longitude *</label>
              <input
                type="number" step="any"
                value={form.longitude}
                onChange={(e) => set("longitude", parseFloat(e.target.value))}
                className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Total Tempat *</label>
              <input
                type="number" min={1}
                value={form.total_spaces}
                onChange={(e) => set("total_spaces", parseInt(e.target.value) || 0)}
                className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Awal Terisi</label>
              <input
                type="number" min={0}
                value={form.initial_occupied}
                onChange={(e) => set("initial_occupied", parseInt(e.target.value) || 0)}
                className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Stream URL (opsional)</label>
            <input
              value={form.stream_url ?? ""}
              onChange={(e) => set("stream_url", e.target.value)}
              placeholder="https://youtube.com/watch?v=... atau rtsp://..."
              className="w-full bg-card-dark border border-slate-700 text-white rounded px-3 py-2 text-sm focus:border-primary focus:outline-none placeholder-slate-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              URL YouTube / RTSP kamera parkir — dipakai khusus untuk hitung masuk/keluar.
              Terpisah dari kamera traffic monitoring.
            </p>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-2 rounded bg-primary text-white hover:bg-primary/80 text-sm transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? "Menyimpan..." : editLot ? "Simpan" : "Tambah"}
          </button>
        </div>
      </div>
    </div>
  );
}
