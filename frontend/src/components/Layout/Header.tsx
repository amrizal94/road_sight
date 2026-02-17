import { useEffect, useState } from "react";

interface Props {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: Props) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const dateStr = time.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const timeStr = time.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <header className="h-16 bg-card-dark border-b border-slate-800 flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left: mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
        aria-label="Toggle menu"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>

      {/* Center: date + clock */}
      <div className="hidden sm:flex items-center gap-2 text-sm text-slate-300 font-medium tabular-nums">
        <span className="material-symbols-outlined text-lg text-slate-500">calendar_today</span>
        {dateStr} | {timeStr}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-4 ml-auto">
        {/* System status */}
        <div className="hidden md:flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            System Online
          </span>
        </div>

        {/* Clock (mobile only, since desktop shows center date+clock) */}
        <div className="sm:hidden text-sm text-slate-300 font-medium tabular-nums">
          {timeStr}
        </div>

        {/* Notification bell */}
        <button className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors relative">
          <span className="material-symbols-outlined text-xl">
            notifications
          </span>
        </button>

        {/* User avatar */}
        <div className="hidden sm:flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-sm">person</span>
          </div>
          <span className="text-sm font-medium text-slate-300">Admin User</span>
        </div>
      </div>
    </header>
  );
}
