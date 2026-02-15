"""
Minimal vehicle detection test from YouTube live stream.
No database, no API, no frontend — just YOLO + OpenCV window.

Usage:
    python test_detection.py "https://www.youtube.com/watch?v=VIDEO_ID"
"""

import subprocess
import sys
import time

import cv2
from ultralytics import YOLO

VEHICLE_CLASSES = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

COLORS = {
    "car": (255, 144, 30),
    "motorcycle": (0, 165, 255),
    "bus": (0, 200, 0),
    "truck": (0, 0, 255),
    "bicycle": (255, 0, 200),
}


def get_stream_url(youtube_url: str) -> str:
    print(f"Getting stream URL from: {youtube_url}")
    result = subprocess.run(
        ["yt-dlp", "-g", "-f", "best", youtube_url],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        print(f"Error: {result.stderr.strip()}")
        sys.exit(1)
    url = result.stdout.strip().split("\n")[0]
    print(f"Stream URL obtained.")
    return url


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_detection.py <youtube_url> [model]")
        print("Models: yolov8n.pt, yolov8s.pt, yolov8m.pt, yolov8l.pt, yolov8x.pt")
        sys.exit(1)

    youtube_url = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "yolo26n.pt"

    stream_url = get_stream_url(youtube_url)

    print(f"Loading model: {model_name}")
    model = YOLO(model_name)

    print("Opening stream...")
    cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)

    if not cap.isOpened():
        print("Error: Cannot open stream")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    print(f"Stream FPS: {fps:.1f}")

    frame_count = 0
    detect_every = max(1, int(fps // 5))  # ~5 detections per second
    last_detections = []
    fps_counter = 0
    fps_timer = time.time()
    display_fps = 0.0

    MODEL_KEYS = {
        ord("1"): "yolo26n.pt",
        ord("2"): "yolo26s.pt",
        ord("3"): "yolo26m.pt",
        ord("4"): "yolo26l.pt",
        ord("5"): "yolo26x.pt",
        ord("6"): "yolov8n.pt",
        ord("7"): "yolov8s.pt",
        ord("8"): "yolov8x.pt",
    }

    print(f"Running detection every {detect_every} frames")
    print("Press 'q' to quit")
    print("Press '1'=yolo26n  '2'=yolo26s  '3'=yolo26m  '4'=yolo26l  '5'=yolo26x")
    print("      '6'=yolov8n  '7'=yolov8s  '8'=yolov8x")
    print("=" * 50)

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Frame read failed, retrying...")
            time.sleep(0.1)
            continue

        frame_count += 1

        # Run detection on every Nth frame
        if frame_count % detect_every == 0:
            orig_w = frame.shape[1]
            scale = 640 / orig_w
            small = cv2.resize(frame, None, fx=scale, fy=scale)

            results = model(small, conf=0.25, verbose=False)[0]

            last_detections = []
            for box in results.boxes:
                cls_id = int(box.cls[0])
                if cls_id in VEHICLE_CLASSES:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    last_detections.append({
                        "bbox": [x1 / scale, y1 / scale, x2 / scale, y2 / scale],
                        "type": VEHICLE_CLASSES[cls_id],
                        "conf": float(box.conf[0]),
                    })

        # Draw detections on every frame
        for det in last_detections:
            x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
            color = COLORS.get(det["type"], (128, 128, 128))
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            label = f"{det['type']} {det['conf']:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
            cv2.putText(frame, label, (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        # FPS counter
        fps_counter += 1
        elapsed = time.time() - fps_timer
        if elapsed >= 1.0:
            display_fps = fps_counter / elapsed
            fps_counter = 0
            fps_timer = time.time()

        # Resize for display first, then draw info overlay on top
        h, w = frame.shape[:2]
        if w > 1280:
            scale_d = 1280 / w
            frame = cv2.resize(frame, None, fx=scale_d, fy=scale_d)

        # Info bar at bottom (black background so always visible)
        bar_h = 40
        h, w = frame.shape[:2]
        cv2.rectangle(frame, (0, h - bar_h), (w, h), (0, 0, 0), -1)
        info = f"FPS: {display_fps:.1f} | Detections: {len(last_detections)} | Model: {model_name} | Press 1-5 to switch"
        cv2.putText(frame, info, (10, h - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        cv2.imshow("Vehicle Detection Test", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key in MODEL_KEYS:
            new_model = MODEL_KEYS[key]
            if new_model != model_name:
                print(f"\nSwitching model: {model_name} -> {new_model} ...")
                model_name = new_model
                model = YOLO(model_name)
                last_detections = []
                print(f"Model {model_name} loaded!")

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nTotal frames: {frame_count}")


if __name__ == "__main__":
    main()
