import { useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import CameraDetailPage from "./pages/CameraDetailPage";
import DashboardPage from "./pages/DashboardPage";
import MapPage from "./pages/MapPage";

const NAV_LINKS = [
  { to: "/", label: "Dashboard" },
  { to: "/map", label: "Map" },
];

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-gray-900 text-white px-4 md:px-6 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-bold">Road Sight</h1>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`hover:text-blue-300 transition-colors ${
                  location.pathname === link.to ? "text-blue-400" : ""
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-1 rounded hover:bg-gray-700 transition-colors"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu dropdown */}
        {menuOpen && (
          <div className="md:hidden mt-3 pb-1 flex flex-col gap-2 border-t border-gray-700 pt-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded hover:bg-gray-700 transition-colors ${
                  location.pathname === link.to ? "bg-gray-700 text-blue-400" : ""
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
      <main className="p-3 md:p-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/cameras/:id" element={<CameraDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}
