import numpy as np
import supervision as sv


class VehicleTracker:
    def __init__(self, frame_height: int,
                 track_activation_threshold: float = 0.25,
                 lost_track_buffer: int = 30,
                 minimum_matching_threshold: float = 0.8,
                 frame_rate: int = 30):
        self.byte_tracker = sv.ByteTrack(
            track_activation_threshold=track_activation_threshold,
            lost_track_buffer=lost_track_buffer,
            minimum_matching_threshold=minimum_matching_threshold,
            frame_rate=frame_rate,
        )
        # Counting line at the middle of the frame
        self.line_y = frame_height // 2
        self.line_start = sv.Point(0, self.line_y)
        self.line_end = sv.Point(10000, self.line_y)
        self.line_zone = sv.LineZone(
            start=self.line_start,
            end=self.line_end,
        )
        self.counts: dict[str, int] = {}

    def update(self, detections_raw: list[dict]) -> list[dict]:
        if not detections_raw:
            return []

        bboxes = np.array([d["bbox"] for d in detections_raw], dtype=np.float32)
        confidences = np.array([d["confidence"] for d in detections_raw], dtype=np.float32)
        class_ids = np.array([d["class_id"] for d in detections_raw], dtype=int)

        sv_detections = sv.Detections(
            xyxy=bboxes,
            confidence=confidences,
            class_id=class_ids,
        )
        tracked = self.byte_tracker.update_with_detections(sv_detections)
        self.line_zone.trigger(tracked)

        results = []
        for i in range(len(tracked)):
            vtype = detections_raw[0]["vehicle_type"]
            for d in detections_raw:
                if d["class_id"] == tracked.class_id[i]:
                    vtype = d["vehicle_type"]
                    break
            results.append({
                "tracker_id": int(tracked.tracker_id[i]) if tracked.tracker_id is not None else -1,
                "bbox": tracked.xyxy[i].tolist(),
                "confidence": float(tracked.confidence[i]) if tracked.confidence is not None else 0.0,
                "class_id": int(tracked.class_id[i]),
                "vehicle_type": vtype,
            })
        return results

    def get_line_counts(self) -> tuple[int, int]:
        return self.line_zone.in_count, self.line_zone.out_count
