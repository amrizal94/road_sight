import { useNavigate } from "react-router-dom";

export default function AddCameraCard() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/map")}
      className="border-2 border-dashed border-slate-700 rounded-lg flex flex-col items-center justify-center aspect-video hover:border-slate-500 hover:bg-slate-800/30 transition-all group"
    >
      <span className="material-symbols-outlined text-4xl text-slate-600 group-hover:text-slate-400 transition-colors">
        add_circle
      </span>
      <span className="text-sm text-slate-500 group-hover:text-slate-400 mt-2 transition-colors">
        Add Camera Feed
      </span>
    </button>
  );
}
