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
