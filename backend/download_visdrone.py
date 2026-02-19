"""
Download VisDrone-trained YOLOv8 weights for overhead/aerial vehicle detection.
Run from backend/ directory: python download_visdrone.py
"""
import sys
from pathlib import Path
import urllib.request

MODELS_DIR = Path(__file__).parent / "models"

# Official Ultralytics pre-trained VisDrone weights
VISDRONE_MODELS = [
    {
        "filename": "yolov8n-visdrone.pt",
        "url": "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n-visdrone.pt",
        "desc": "YOLOv8 Nano VisDrone (~6 MB, fastest)",
    },
    {
        "filename": "yolov8s-visdrone.pt",
        "url": "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8s-visdrone.pt",
        "desc": "YOLOv8 Small VisDrone (~22 MB, more accurate)",
    },
]


def download(url: str, dest: Path):
    print(f"  Downloading {dest.name} ...", end=" ", flush=True)

    def _progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 // total_size)
            print(f"\r  Downloading {dest.name} ... {pct}%  ", end="", flush=True)

    try:
        urllib.request.urlretrieve(url, dest, reporthook=_progress)
        print(f"\r  ✓ {dest.name} saved ({dest.stat().st_size // 1024} KB)")
        return True
    except Exception as e:
        print(f"\r  ✗ Failed: {e}")
        if dest.exists():
            dest.unlink()
        return False


def main():
    MODELS_DIR.mkdir(exist_ok=True)

    print("=" * 55)
    print("  VisDrone YOLOv8 Model Downloader")
    print("  Optimized for overhead/aerial parking detection")
    print("=" * 55)

    success = []
    for m in VISDRONE_MODELS:
        dest = MODELS_DIR / m["filename"]
        if dest.exists():
            print(f"  ✓ {m['filename']} already exists ({dest.stat().st_size // 1024} KB)")
            success.append(m["filename"])
            continue
        print(f"\n  {m['desc']}")
        if download(m["url"], dest):
            success.append(m["filename"])

    print()
    if success:
        print(f"Downloaded {len(success)} model(s) to backend/models/")
        print()
        print("Next steps:")
        print("  1. Rebuild Docker: docker compose up -d --build backend")
        print("  2. In Space Detection tab, select 'YOLOv8n VisDrone' model")
        print("  3. Start Space Detection")
    else:
        print("No models downloaded. Check your internet connection.")
        print()
        print("Manual download:")
        for m in VISDRONE_MODELS:
            print(f"  {m['url']}")
        print(f"  → Save to: {MODELS_DIR}/")
        sys.exit(1)


if __name__ == "__main__":
    main()
