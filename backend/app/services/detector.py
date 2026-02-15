import numpy as np
from ultralytics import YOLO

from ..config import settings

# COCO class IDs for vehicles
VEHICLE_CLASSES = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

AVAILABLE_MODELS = [
    {"id": "yolo26n.pt", "name": "YOLO26 Nano", "description": "Tercepat, akurasi dasar"},
    {"id": "yolo26s.pt", "name": "YOLO26 Small", "description": "Cepat, akurasi baik"},
    {"id": "yolo26m.pt", "name": "YOLO26 Medium", "description": "Seimbang"},
    {"id": "yolo26l.pt", "name": "YOLO26 Large", "description": "Akurat, butuh GPU"},
    {"id": "yolo26x.pt", "name": "YOLO26 Extra", "description": "Paling akurat, paling berat"},
    {"id": "yolo11n.pt", "name": "YOLO11 Nano", "description": "Legacy, ringan"},
    {"id": "yolo11s.pt", "name": "YOLO11 Small", "description": "Legacy, seimbang"},
    {"id": "yolov8n.pt", "name": "YOLOv8 Nano", "description": "Legacy v8, ringan"},
    {"id": "yolov8s.pt", "name": "YOLOv8 Small", "description": "Legacy v8, seimbang"},
    {"id": "yolov8x.pt", "name": "YOLOv8 Extra", "description": "Legacy v8, akurat"},
]


class VehicleDetector:
    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or settings.yolo_model
        self.model = YOLO(self.model_name)
        self.confidence = settings.confidence_threshold

    def detect(self, frame: np.ndarray) -> list[dict]:
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            if cls_id in VEHICLE_CLASSES:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append({
                    "bbox": [x1, y1, x2, y2],
                    "confidence": float(box.conf[0]),
                    "class_id": cls_id,
                    "vehicle_type": VEHICLE_CLASSES[cls_id],
                })
        return detections
