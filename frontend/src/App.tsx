import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/Layout/AppLayout";
import CameraDetailPage from "./pages/CameraDetailPage";
import DashboardPage from "./pages/DashboardPage";
import MapPage from "./pages/MapPage";
import SurveillancePage from "./pages/SurveillancePage";
import ReportsPage from "./pages/ReportsPage";

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/surveillance" element={<SurveillancePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/cameras/:id" element={<CameraDetailPage />} />
      </Routes>
    </AppLayout>
  );
}
