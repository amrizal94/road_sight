import logging

import numpy as np
from ultralytics import YOLO

from ..config import settings

logger = logging.getLogger(__name__)

# Fallback: COCO class IDs (used when model names can't be parsed)
VEHICLE_CLASSES = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Map model class name → our vehicle type label
# Covers both COCO ("car", "motorcycle") and VisDrone ("van", "motor") naming
_NAME_TO_VTYPE: dict[str, str] = {
    "car": "car",
    "van": "car",          # VisDrone
    "automobile": "car",
    "truck": "truck",
    "lorry": "truck",
    "bus": "bus",
    "coach": "bus",
    "motorcycle": "motorcycle",
    "motorbike": "motorcycle",
    "motor": "motorcycle",  # VisDrone
    "bicycle": "bicycle",
    "bike": "bicycle",
}

AVAILABLE_MODELS = [
    # VisDrone — trained on aerial/overhead footage, best for overhead parking cameras.
    # NOT suitable for person detection or side-angle vehicle counting.
    {"id": "models/yolov8n-visdrone.pt", "name": "YOLOv8n VisDrone",
     "description": "Khusus overhead/aerial — terbaik untuk kamera parkir atas, tidak cocok untuk deteksi orang"},
    {"id": "models/yolov8s-visdrone.pt", "name": "YOLOv8s VisDrone",
     "description": "Khusus overhead/aerial (lebih akurat) — terbaik untuk kamera parkir atas, tidak cocok untuk deteksi orang"},
    # YOLO26 custom models — optimised for vehicle detection in traffic scenarios.
    # Class names are COCO but person detection performance is poor.
    # Recommended for: traffic monitor, parking gate. NOT recommended for: bus passenger counter.
    {"id": "models/yolo26n.pt", "name": "YOLO26 Nano",
     "description": "Tercepat — vehicle detection, tidak direkomendasikan untuk deteksi orang"},
    {"id": "models/yolo26s.pt", "name": "YOLO26 Small",
     "description": "Cepat — vehicle detection, tidak direkomendasikan untuk deteksi orang"},
    {"id": "models/yolo26m.pt", "name": "YOLO26 Medium",
     "description": "Seimbang — vehicle detection, tidak direkomendasikan untuk deteksi orang"},
    {"id": "models/yolo26l.pt", "name": "YOLO26 Large",
     "description": "Akurat — vehicle detection, butuh GPU, tidak direkomendasikan untuk deteksi orang"},
    {"id": "models/yolo26x.pt", "name": "YOLO26 Extra",
     "description": "Paling akurat — vehicle detection, butuh GPU, tidak direkomendasikan untuk deteksi orang"},
    # Standard Ultralytics COCO models — recommended for both vehicle and person detection.
    {"id": "yolo11n.pt",  "name": "YOLO11 Nano",
     "description": "Versi terbaru Ultralytics — lebih akurat dari YOLOv8, tetap ringan. Cocok untuk orang & kendaraan"},
    {"id": "yolo11s.pt",  "name": "YOLO11 Small",
     "description": "Versi terbaru — akurasi tinggi, tetap cepat. Cocok untuk orang & kendaraan"},
    {"id": "yolov8n.pt",  "name": "YOLOv8 Nano",
     "description": "Ringan dan andal — direkomendasikan untuk deteksi orang & kendaraan (default)"},
    {"id": "yolov8s.pt",  "name": "YOLOv8 Small",
     "description": "Akurasi lebih baik dari Nano — cocok untuk orang & kendaraan"},
    {"id": "yolov8x.pt",  "name": "YOLOv8 Extra",
     "description": "Paling akurat — cocok untuk orang & kendaraan, butuh GPU"},
]


class PersonDetector:
    """YOLO detector that tracks only the 'person' class — for bus passenger counting."""

    def __init__(self, model_name: str | None = None, confidence: float | None = None):
        self.model_name = model_name or settings.yolo_model
        self.model = YOLO(self.model_name)
        # Allow per-instance confidence override (bus monitor uses lower threshold
        # than the global setting to maintain tracking through low-visibility zones)
        self.confidence = confidence if confidence is not None else settings.confidence_threshold

        # Find person class ID(s) from the model's own names
        self._person_ids: set[int] = set()
        for cls_id, name in self.model.names.items():
            if name.lower() in ("person", "pedestrian", "people"):
                self._person_ids.add(cls_id)

        if self._person_ids:
            logger.warning(f"PersonDetector loaded: {self.model_name} | person IDs: {self._person_ids}")
        else:
            # Fallback: COCO class 0 is always 'person'
            self._person_ids = {0}
            logger.warning(f"PersonDetector: WARNING — no person class found in {self.model_name}, falling back to class 0 (may be wrong for non-COCO models!)")

    def detect(self, frame: np.ndarray) -> list[dict]:
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            if cls_id not in self._person_ids:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "bbox": [x1, y1, x2, y2],
                "confidence": float(box.conf[0]),
                "class_id": cls_id,
                "vehicle_type": "person",
            })
        return detections


class VehicleDetector:
    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or settings.yolo_model
        self.model = YOLO(self.model_name)
        self.confidence = settings.confidence_threshold

        # Auto-detect vehicle class IDs from the model's own class names.
        # This works for any model: COCO, VisDrone, custom, etc.
        self._vehicle_ids: dict[int, str] = {}
        for cls_id, name in self.model.names.items():
            vtype = _NAME_TO_VTYPE.get(name.lower())
            if vtype:
                self._vehicle_ids[cls_id] = vtype

        if self._vehicle_ids:
            logger.info(f"Detector loaded: {self.model_name} | vehicle classes: {self._vehicle_ids}")
        else:
            # Fallback to hardcoded COCO IDs
            self._vehicle_ids = dict(VEHICLE_CLASSES)
            logger.warning(f"Detector: could not parse vehicle classes from {self.model_name}, using COCO defaults")

    def detect(self, frame: np.ndarray) -> list[dict]:
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            if cls_id not in self._vehicle_ids:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "bbox": [x1, y1, x2, y2],
                "confidence": float(box.conf[0]),
                "class_id": cls_id,
                "vehicle_type": self._vehicle_ids[cls_id],
            })
        return detections
