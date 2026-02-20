"""
Training script — Parking Slot Classifier (MobileNetV3-Small)
==============================================================
Trains a binary classifier: 0 = free, 1 = occupied.

Supported dataset layouts
--------------------------
A) Direct (ImageFolder-compatible):
   <root>/free/       ← free slot images
   <root>/occupied/   ← occupied slot images

B) CNRPark-Patches-150x150 (auto-detected):
   Scans recursively for directories named FREE/ and BUSY/.

Usage
-----
  # CNRPark dataset
  python train_slot_classifier.py --data CNRPark-Patches-150x150 --out models/parking_classifier.pt

  # Custom free/occupied folders
  python train_slot_classifier.py --data my_dataset --out models/parking_classifier.pt

  # With more epochs and custom batch size
  python train_slot_classifier.py --data CNRPark-Patches-150x150 --epochs 20 --batch 64
"""
import argparse
import os
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split
from torchvision import transforms
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
from PIL import Image


# ── Dataset ──────────────────────────────────────────────────────────────────

class ParkingDataset(Dataset):
    """
    Collects images from:
    - <root>/free/ + <root>/occupied/  (direct format)
    - Recursive scan for FREE/ and BUSY/ dirs  (CNRPark format)
    """

    EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

    def __init__(self, root: str, transform=None):
        self.transform = transform
        self.samples: list[tuple[str, int]] = []

        root_path = Path(root)

        # Try direct format first
        free_dir = root_path / "free"
        occ_dir = root_path / "occupied"
        if free_dir.is_dir() or occ_dir.is_dir():
            if free_dir.is_dir():
                self._collect(free_dir, label=0)
            if occ_dir.is_dir():
                self._collect(occ_dir, label=1)
        else:
            # CNRPark-style: scan for FREE/ and BUSY/ anywhere in tree
            for path in root_path.rglob("*"):
                if path.suffix.lower() not in self.EXTS:
                    continue
                parts_upper = [p.upper() for p in path.parts]
                if "FREE" in parts_upper:
                    self.samples.append((str(path), 0))
                elif "BUSY" in parts_upper or "OCCUPIED" in parts_upper:
                    self.samples.append((str(path), 1))

        if not self.samples:
            raise ValueError(
                f"No images found in '{root}'.\n"
                "Expected either free/occupied sub-folders, "
                "or CNRPark-style FREE/BUSY directories."
            )

        free_count = sum(1 for _, l in self.samples if l == 0)
        occ_count = len(self.samples) - free_count
        print(f"Dataset: {len(self.samples)} images  |  free={free_count}  occupied={occ_count}")

    def _collect(self, directory: Path, label: int):
        for f in directory.rglob("*"):
            if f.suffix.lower() in self.EXTS:
                self.samples.append((str(f), label))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, label


# ── Transforms ───────────────────────────────────────────────────────────────

TRAIN_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomVerticalFlip(),
    transforms.RandomRotation(15),
    transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

VAL_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── Training ─────────────────────────────────────────────────────────────────

def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # Build full dataset (no transform yet — split first, then assign)
    full_ds = ParkingDataset(args.data, transform=None)

    val_size = max(1, int(len(full_ds) * 0.15))
    train_size = len(full_ds) - val_size
    train_ds, val_ds = random_split(full_ds, [train_size, val_size],
                                    generator=torch.Generator().manual_seed(42))

    # Wrap with per-split transforms
    class _WithTransform(Dataset):
        def __init__(self, subset, transform):
            self.subset = subset
            self.transform = transform

        def __len__(self):
            return len(self.subset)

        def __getitem__(self, idx):
            path, label = self.subset.dataset.samples[self.subset.indices[idx]]
            img = Image.open(path).convert("RGB")
            return self.transform(img), label

    train_loader = DataLoader(
        _WithTransform(train_ds, TRAIN_TRANSFORM),
        batch_size=args.batch, shuffle=True,
        num_workers=min(4, os.cpu_count() or 1), pin_memory=(device.type == "cuda"),
    )
    val_loader = DataLoader(
        _WithTransform(val_ds, VAL_TRANSFORM),
        batch_size=args.batch, shuffle=False,
        num_workers=min(4, os.cpu_count() or 1),
    )

    # Model: MobileNetV3-Small, pretrained on ImageNet
    model = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, 2)
    model = model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"\nTraining for {args.epochs} epochs  |  train={train_size}  val={val_size}\n")

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0

        for imgs, labels in train_loader:
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            out = model(imgs)
            loss = criterion(out, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * imgs.size(0)
            train_correct += (out.argmax(1) == labels).sum().item()
            train_total += imgs.size(0)

        scheduler.step()

        # Validation
        model.eval()
        val_correct, val_total = 0, 0
        with torch.no_grad():
            for imgs, labels in val_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                out = model(imgs)
                val_correct += (out.argmax(1) == labels).sum().item()
                val_total += imgs.size(0)

        train_acc = train_correct / train_total
        val_acc = val_correct / val_total
        elapsed = time.time() - t0

        marker = " ← best" if val_acc > best_val_acc else ""
        print(
            f"Epoch {epoch:02d}/{args.epochs}  "
            f"loss={train_loss/train_total:.4f}  "
            f"train_acc={train_acc:.4f}  "
            f"val_acc={val_acc:.4f}  "
            f"({elapsed:.1f}s){marker}"
        )

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), out_path)

    print(f"\nDone. Best val accuracy: {best_val_acc:.4f}")
    print(f"Model saved → {out_path.resolve()}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train parking slot CNN classifier")
    parser.add_argument("--data", required=True,
                        help="Dataset root (free/occupied folders or CNRPark layout)")
    parser.add_argument("--out", default="models/parking_classifier.pt",
                        help="Output model path (default: models/parking_classifier.pt)")
    parser.add_argument("--epochs", type=int, default=15,
                        help="Number of training epochs (default: 15)")
    parser.add_argument("--batch", type=int, default=32,
                        help="Batch size (default: 32)")
    parser.add_argument("--lr", type=float, default=1e-4,
                        help="Learning rate for Adam (default: 1e-4)")
    args = parser.parse_args()
    train(args)
