import axios from "axios";

const api = axios.create({ baseURL: "/api" });

export interface Camera {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  status: string;
  created_at: string | null;
}

export interface Detection {
  id: number;
  camera_id: number;
  vehicle_type: string;
  confidence: number;
  timestamp: string;
}

export interface VehicleSummary {
  vehicle_type: string;
  total_count: number;
}

export interface HourlyCount {
  hour: number;
  vehicle_type: string;
  count: number;
}

export interface TimeIntervalCount {
  time_label: string;
  vehicle_type: string;
  count: number;
}

export type TimeInterval = "5m" | "15m" | "30m" | "1h";
export type DateFilter = "today" | "24h" | "all";

export interface HeatmapPoint {
  camera_id: number;
  latitude: number;
  longitude: number;
  total_count: number;
}

export const getCameras = () => api.get<Camera[]>("/cameras");
export const getCamera = (id: number) => api.get<Camera>(`/cameras/${id}`);
export const createCamera = (data: Omit<Camera, "id" | "created_at">) =>
  api.post<Camera>("/cameras", data);
export const updateCamera = (id: number, data: Partial<Omit<Camera, "id" | "created_at">>) =>
  api.put<Camera>(`/cameras/${id}`, data);
export const deleteCamera = (id: number) =>
  api.delete(`/cameras/${id}`);

export const getDetections = (params?: Record<string, string | number>) =>
  api.get<Detection[]>("/detections", { params });

export interface SummaryCompare {
  today_total: number;
  yesterday_total: number;
  change_pct: number | null;
}

export const getSummary = () => api.get<VehicleSummary[]>("/analytics/summary");
export const getSummaryCompare = () => api.get<SummaryCompare>("/analytics/summary-compare");
export const getHourly = (cameraId: number) =>
  api.get<HourlyCount[]>(`/analytics/hourly/${cameraId}`);
export const getTrafficData = (
  cameraId: number,
  params?: { interval?: TimeInterval; date_filter?: DateFilter }
) =>
  api.get<TimeIntervalCount[]>(`/analytics/traffic/${cameraId}`, { params });
export const getHeatmap = () => api.get<HeatmapPoint[]>("/analytics/heatmap");

export const processVideo = (cameraId: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/stream/process?camera_id=${cameraId}`, form);
};

export const processUrl = (cameraId: number, url: string, duration = 30) =>
  api.post("/stream/process-url", { camera_id: cameraId, url, duration });

export const getJobStatus = (jobId: string) =>
  api.get(`/stream/status/${jobId}`);

// Live monitoring
export interface LiveStatus {
  camera_id: number;
  youtube_url: string;
  model_name: string;
  status: string;
  frame_count: number;
  detections_total: number;
  vehicle_counts: Record<string, number>;
  line_in: number;
  line_out: number;
  last_update: string | null;
}

export interface YoloModel {
  id: string;
  name: string;
  description: string;
}

export const getModels = () => api.get<YoloModel[]>("/stream/models");

export const startLiveMonitor = (cameraId: number, youtubeUrl: string, modelName?: string) =>
  api.post("/stream/live/start", { camera_id: cameraId, youtube_url: youtubeUrl, model_name: modelName });

export const stopLiveMonitor = (cameraId: number) =>
  api.post(`/stream/live/stop/${cameraId}`);

export const getLiveStatus = (cameraId: number) =>
  api.get<LiveStatus>(`/stream/live/status/${cameraId}`);

export const getAllLiveMonitors = () =>
  api.get<LiveStatus[]>("/stream/live/all");

export interface SystemHealth {
  cpu_pct: number;
  ram_pct: number;
  ram_used_mb: number;
  ram_total_mb: number;
  uptime_seconds: number;
}

export const getSystemHealth = () => api.get<SystemHealth>("/system/health");

// Parking
export interface ParkingLot {
  id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  total_spaces: number;
  initial_occupied: number;
  status: string;
  stream_url: string | null;
  overhead_stream_url: string | null;
  created_at: string | null;
}

export interface ParkingLotCreate {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  total_spaces: number;
  initial_occupied?: number;
  status?: string;
  stream_url?: string | null;
  overhead_stream_url?: string | null;
}

export interface OccupancyStatus {
  lot_id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  total_spaces: number;
  occupied_spaces: number;
  available_spaces: number;
  occupancy_pct: number;
  status_label: string;
  status_color: string;
  stream_url: string | null;
  overhead_stream_url: string | null;
  is_live: boolean;
  line_in: number;
  line_out: number;
}

export interface ParkingMonitorStatus {
  lot_id: number;
  stream_url: string | null;
  status: string;
  line_in: number;
  line_out: number;
  occupied_spaces: number;
  last_update: string | null;
  error: string | null;
}

export interface OccupancyTrend {
  timestamp: string;
  occupied_spaces: number;
}

export const getParkingLots = () => api.get<ParkingLot[]>("/parking/lots");
export const getParkingLot = (id: number) => api.get<ParkingLot>(`/parking/lots/${id}`);
export const createParkingLot = (data: ParkingLotCreate) =>
  api.post<ParkingLot>("/parking/lots", data);
export const updateParkingLot = (id: number, data: Partial<ParkingLotCreate>) =>
  api.put<ParkingLot>(`/parking/lots/${id}`, data);
export const deleteParkingLot = (id: number) =>
  api.delete(`/parking/lots/${id}`);
export const getParkingStatus = () =>
  api.get<OccupancyStatus[]>("/parking/status");
export const getParkingLotStatus = (id: number) =>
  api.get<OccupancyStatus>(`/parking/status/${id}`);
export const getParkingTrends = (id: number) =>
  api.get<OccupancyTrend[]>(`/parking/trends/${id}`);

export const startParkingMonitor = (id: number, modelName?: string) =>
  api.post(`/parking/monitor/start/${id}`, { model_name: modelName ?? null });
export const stopParkingMonitor = (id: number) =>
  api.post(`/parking/monitor/stop/${id}`);
export const getParkingMonitorStatus = (id: number) =>
  api.get<ParkingMonitorStatus>(`/parking/monitor/status/${id}`);

// Space Detection
export interface ParkingSpace {
  id: number;
  parking_lot_id: number;
  label: string;
  polygon: number[][];  // [[x, y], ...]
}

export interface SpaceStatus {
  space_id: number;
  label: string;
  occupied: boolean;
  polygon: number[][];
}

export interface SpaceMonitorStatus {
  lot_id: number;
  status: string;  // idle | starting | running | stopping | stopped | error
  occupied_count: number;
  free_count: number;
  total_count: number;
  spaces: SpaceStatus[];
  last_update: string | null;
  error: string | null;
}

export const getParkingSpaces = (lotId: number) =>
  api.get<ParkingSpace[]>(`/parking/spaces/${lotId}`);
export const createParkingSpace = (lotId: number, data: { label: string; polygon: number[][] }) =>
  api.post<ParkingSpace>(`/parking/spaces/${lotId}`, data);
export const deleteParkingSpace = (lotId: number, spaceId: number) =>
  api.delete(`/parking/spaces/${lotId}/${spaceId}`);

export const startSpaceMonitor = (lotId: number, modelName?: string) =>
  api.post(`/parking/space-monitor/start/${lotId}`, { model_name: modelName ?? null });
export const stopSpaceMonitor = (lotId: number) =>
  api.post(`/parking/space-monitor/stop/${lotId}`);
export const getSpaceMonitorStatus = (lotId: number) =>
  api.get<SpaceMonitorStatus>(`/parking/space-monitor/status/${lotId}`);
