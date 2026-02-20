"""
CNN-based parking slot classifier using MobileNetV3-Small.

Loaded once as a module-level singleton via load_slot_classifier().
Gracefully degrades (returns None) if the model file is missing or
PyTorch is unavailable, so the rest of the system keeps working.
"""
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_slot_classifier: Optional["SlotClassifier"] = None


class SlotClassifier:
    """
    MobileNetV3-Small binary classifier: index 0 = free, index 1 = occupied.
    predict() returns float 0.0 (definitely free) → 1.0 (definitely occupied).
    """

    def __init__(self, model_path: str):
        import torch
        import torchvision.transforms as T
        from torchvision.models import mobilenet_v3_small

        self.device = torch.device("cpu")

        model = mobilenet_v3_small(weights=None)
        # Replace final classifier layer to output 2 classes [free, occupied]
        in_features = model.classifier[-1].in_features
        model.classifier[-1] = torch.nn.Linear(in_features, 2)
        model.load_state_dict(torch.load(model_path, map_location="cpu"))
        model.eval()
        self._model = model

        self._transform = T.Compose([
            T.ToPILImage(),
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        logger.info(f"SlotClassifier loaded: {model_path}")

    def predict(self, crop_bgr: np.ndarray) -> float:
        """Return occupancy probability: 0.0 = free, 1.0 = occupied."""
        import torch
        import cv2

        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        tensor = self._transform(crop_rgb).unsqueeze(0)   # (1, 3, 224, 224)
        with torch.no_grad():
            logits = self._model(tensor)                  # (1, 2)
            probs = torch.softmax(logits, dim=1)          # [free_prob, occ_prob]
            return float(probs[0, 1].item())              # occupied probability


def load_slot_classifier(path: str) -> bool:
    """
    Load (or reload) the CNN model from *path*.
    Returns True on success, False if path is empty or file not found.
    Result stored in module-level singleton; thread-safe for read-only inference.
    """
    global _slot_classifier
    if not path:
        logger.info("SlotClassifier: no model path configured — CNN layer disabled")
        return False
    try:
        _slot_classifier = SlotClassifier(path)
        return True
    except FileNotFoundError:
        logger.warning(f"SlotClassifier: model not found at '{path}' — CNN layer disabled")
        _slot_classifier = None
        return False
    except Exception as e:
        logger.warning(f"SlotClassifier: failed to load '{path}': {e} — CNN layer disabled")
        _slot_classifier = None
        return False


def get_slot_classifier() -> Optional[SlotClassifier]:
    """Return the loaded singleton, or None if not available."""
    return _slot_classifier
