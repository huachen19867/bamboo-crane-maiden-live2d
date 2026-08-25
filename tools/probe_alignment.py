"""Probe a uniform scale/translation that aligns the extracted character to the reference.

The score deliberately matches the visual acceptance agent: RGB absolute
similarity weighted by the transformed character alpha.  This tool is read-only
and prints candidates; the selected transform is authored in build_assets.py.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SIZE = 627


def load() -> tuple[Image.Image, np.ndarray]:
    character = Image.open(ROOT / "assets/runtime/character-master.png").convert("RGBA")
    reference = Image.open(ROOT / "assets/runtime/reference-preview.png").convert("RGB")
    reference = reference.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return character, np.asarray(reference, dtype=np.float32)


def scaled_array(character: Image.Image, scale: float) -> np.ndarray:
    side = max(1, round(SIZE * scale))
    layer = character.resize((side, side), Image.Resampling.BILINEAR)
    return np.asarray(layer, dtype=np.float32)


def score(arr: np.ndarray, reference: np.ndarray, dx: int, dy: int) -> float:
    side = arr.shape[0]
    x0 = max(0, dx)
    y0 = max(0, dy)
    x1 = min(SIZE, dx + side)
    y1 = min(SIZE, dy + side)
    if x1 <= x0 or y1 <= y0:
        return 0
    src = arr[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    ref = reference[y0:y1, x0:x1]
    alpha = src[:, :, 3] / 255
    visible_weight = alpha.sum()
    total_weight = (arr[:, :, 3] / 255).sum()
    if visible_weight < 1 or total_weight < 1:
        return 0
    similarity = 1 - np.abs(src[:, :, :3] - ref).mean(axis=2) / 255
    # Pixels moved outside the canvas count as zero similarity.  This prevents
    # a numerically good transform from "aligning" by clipping the feet.
    return float((similarity * alpha).sum() / total_weight * 100)


def frange(start: float, end: float, step: float):
    value = start
    while value <= end + step / 2:
        yield round(value, 6)
        value += step


def search(character: Image.Image, reference: np.ndarray):
    best = (0.0, 1.0, 0, 0)
    # The default runtime is already coarsely registered; search a fine local
    # neighbourhood at half resolution so one-pixel edge alignment is visible.
    for scale in frange(.975, 1.025, .005):
        arr = scaled_array(character, scale)
        for dx in range(-8, 9, 2):
            for dy in range(-8, 9, 2):
                candidate = score(arr, reference, dx, dy)
                if candidate > best[0]:
                    best = (candidate, scale, dx, dy)
    _, scale, dx, dy = best
    for fine_scale in frange(scale - .006, scale + .006, .001):
        arr = scaled_array(character, fine_scale)
        for fine_dx in range(dx - 2, dx + 3):
            for fine_dy in range(dy - 2, dy + 3):
                candidate = score(arr, reference, fine_dx, fine_dy)
                if candidate > best[0]:
                    best = (candidate, fine_scale, fine_dx, fine_dy)
    return best


if __name__ == "__main__":
    source, reference_array = load()
    result = search(source, reference_array)
    print({
        "similarity_percent": round(result[0], 5),
        "scale": result[1],
        "translate_preview_px": [result[2], result[3]],
        "translate_1254_px": [round(result[2] * 1254 / SIZE), round(result[3] * 1254 / SIZE)],
    })
