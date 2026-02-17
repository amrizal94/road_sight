import { Link, useLocation } from "react-router-dom";

const MAIN_ITEMS = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/surveillance", label: "Surveillance", icon: "videocam" },
  { to: "/reports", label: "Reports", icon: "assessment" },
  { to: "/map", label: "Map", icon: "map" },
];

const OTHER_ITEMS = [
  { to: "/settings", label: "Settings", icon: "settings" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: Props) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const renderNavItem = (item: { to: string; label: string; icon: string }) => (
    <Link
      key={item.to}
      to={item.to}
      onClick={onClose}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        isActive(item.to)
          ? "bg-primary text-white"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
      }`}
    >
      <span className="material-symbols-outlined text-xl">
        {item.icon}
      </span>
      {item.label}
    </Link>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-[999] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-[1000] h-full w-64 bg-sidebar-dark border-r border-slate-800 flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-slate-800">
          <Link to="/" className="flex items-center gap-3" onClick={onClose}>
            <span className="material-symbols-outlined text-primary text-2xl">
              traffic
            </span>
            <span className="text-lg font-bold text-white tracking-tight">
              Road Sight
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          {/* MAIN section */}
          <div className="mb-4">
            <div className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
              Main
            </div>
            <div className="space-y-1">
              {MAIN_ITEMS.map(renderNavItem)}
            </div>
          </div>

          {/* OTHER section */}
          <div>
            <div className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
              Other
            </div>
            <div className="space-y-1">
              {OTHER_ITEMS.map(renderNavItem)}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-sm">
                person
              </span>
            </div>
            <div className="text-xs">
              <div className="text-slate-300 font-medium">Admin</div>
              <div className="text-slate-500">Operator</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
