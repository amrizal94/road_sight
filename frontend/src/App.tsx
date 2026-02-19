import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/Layout/AppLayout";
import CameraDetailPage from "./pages/CameraDetailPage";
import DashboardPage from "./pages/DashboardPage";
import MapPage from "./pages/MapPage";
import ParkingDetailPage from "./pages/ParkingDetailPage";
import ParkingPage from "./pages/ParkingPage";
import ReportsPage from "./pages/ReportsPage";
import SurveillancePage from "./pages/SurveillancePage";

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/surveillance" element={<SurveillancePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/cameras/:id" element={<CameraDetailPage />} />
        <Route path="/parking" element={<ParkingPage />} />
        <Route path="/parking/:id" element={<ParkingDetailPage />} />
      </Routes>
    </AppLayout>
  );
}
