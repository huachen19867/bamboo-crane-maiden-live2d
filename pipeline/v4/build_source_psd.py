from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from psd_tools import PSDImage
from psd_tools.api.layers import Group, PixelLayer


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "assets" / "source" / "rebuild-v4"
MASTER_PATH = SOURCE_DIR / "character-master-front.png"
CLEAN_MASTER_PATH = SOURCE_DIR / "character-master-front-clean.png"
LAYERS_DIR = SOURCE_DIR / "layers"
MODEL_DIR = ROOT / "model" / "cubism-v4"
PSD_PATH = MODEL_DIR / "bamboo-crane-maiden-v4-source.psd"
REPORT_PATH = ROOT / "exports" / "v4-source-psd-report.json"
PREVIEW_PATH = ROOT / "exports" / "v4-source-neutral.png"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def cleaned_master(source: Image.Image) -> Image.Image:
    """Remove the generator's low-alpha aura without touching RGB artwork.

    The selected source has a nearly opaque character (normally alpha 252-254)
    plus a broad low-alpha glow.  Values below 64 are outside the inked
    silhouette.  Values from 64 through 223 are retained as a narrow antialias
    ramp; the painted interior becomes fully opaque.
    """

    rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8).copy()
    alpha = rgba[:, :, 3].astype(np.int16)
    mapped = np.zeros_like(alpha, dtype=np.uint8)
    edge = (alpha >= 64) & (alpha < 224)
    mapped[edge] = np.clip((alpha[edge] - 64) * 255 / 160, 0, 254).astype(np.uint8)
    mapped[alpha >= 224] = 255
    rgba[:, :, 3] = mapped
    rgba[mapped == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def polygon_mask(size: tuple[int, int], points: list[tuple[float, float]]) -> np.ndarray:
    width, height = size
    scaled = [(round(x * width / 1024), round(y * height / 1536)) for x, y in points]
    image = Image.new("L", size, 0)
    ImageDraw.Draw(image).polygon(scaled, fill=255)
    return np.asarray(image, dtype=np.uint8) > 0


def rect_mask(size: tuple[int, int], box: tuple[float, float, float, float]) -> np.ndarray:
    left, top, right, bottom = box
    return polygon_mask(size, [(left, top), (right, top), (right, bottom), (left, bottom)])


def rgba_for_mask(master: np.ndarray, mask: np.ndarray) -> Image.Image:
    output = master.copy()
    output[:, :, 3] = np.where(mask, master[:, :, 3], 0).astype(np.uint8)
    return Image.fromarray(output, "RGBA")


def add_layer(parent: Group | PSDImage, name: str, image: Image.Image) -> PixelLayer:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError(f"empty V4 layer: {name}")
    left, top, right, bottom = bounds
    return PixelLayer.frompil(
        image.crop(bounds), parent, name=name, top=top, left=left
    )


def build() -> dict[str, object]:
    if not MASTER_PATH.is_file():
        raise FileNotFoundError(MASTER_PATH)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    original = Image.open(MASTER_PATH).convert("RGBA")
    clean = cleaned_master(original)
    clean.save(CLEAN_MASTER_PATH, optimize=True)

    width, height = clean.size
    master = np.asarray(clean, dtype=np.uint8)
    visible = master[:, :, 3] > 0
    remaining = visible.copy()

    candidates: list[tuple[str, str, np.ndarray]] = [
        ("20_BODY", "ArtHandCuffL", rect_mask(clean.size, (105, 570, 255, 750))),
        ("20_BODY", "ArtHandCuffR", rect_mask(clean.size, (770, 570, 920, 750))),
        ("20_BODY", "ArtFootL", rect_mask(clean.size, (350, 1390, 515, 1536))),
        ("20_BODY", "ArtFootR", rect_mask(clean.size, (509, 1390, 680, 1536))),
        ("10_HEAD", "ArtHeadCombined", rect_mask(clean.size, (330, 0, 695, 330))),
        (
            "30_DYNAMIC_GARMENT",
            "ArtSleeveL",
            polygon_mask(
                clean.size,
                [(260, 330), (500, 370), (490, 680), (420, 850), (320, 1080),
                 (185, 1075), (110, 865), (100, 610)],
            ),
        ),
        (
            "30_DYNAMIC_GARMENT",
            "ArtSleeveR",
            polygon_mask(
                clean.size,
                [(764, 330), (524, 370), (534, 680), (604, 850), (704, 1080),
                 (839, 1075), (914, 865), (924, 610)],
            ),
        ),
        ("20_BODY", "ArtTorsoWaist", rect_mask(clean.size, (285, 285, 739, 720))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtL", rect_mask(clean.size, (0, 500, 430, 1536))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtR", rect_mask(clean.size, (594, 500, 1024, 1536))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtC", rect_mask(clean.size, (430, 500, 594, 1536))),
    ]

    assigned: list[tuple[str, str, np.ndarray]] = []
    for group_name, layer_name, region in candidates:
        mask = remaining & region
        if mask.any():
            assigned.append((group_name, layer_name, mask))
            remaining &= ~mask
    if remaining.any():
        assigned.append(("20_BODY", "ArtGarmentResidual", remaining.copy()))
        remaining[:] = False

    groups: dict[str, list[tuple[str, Image.Image]]] = {
        "10_HEAD": [],
        "20_BODY": [],
        "30_DYNAMIC_GARMENT": [],
    }
    manifest: list[dict[str, object]] = []
    reconstructed = np.zeros_like(master)
    for group_name, layer_name, mask in assigned:
        layer = rgba_for_mask(master, mask)
        bounds = layer.getchannel("A").getbbox()
        if bounds is None:
            continue
        layer_path = LAYERS_DIR / f"{layer_name}.png"
        layer.crop(bounds).save(layer_path, optimize=True)
        groups[group_name].append((layer_name, layer))
        reconstructed[mask] = master[mask]
        manifest.append(
            {
                "group": group_name,
                "name": layer_name,
                "bbox": list(bounds),
                "opaque_or_edge_pixels": int(mask.sum()),
                "png": str(layer_path.relative_to(ROOT)).replace("\\", "/"),
            }
        )

    if not np.array_equal(reconstructed, master):
        differing = int(np.any(reconstructed != master, axis=2).sum())
        raise RuntimeError(f"V4 partition lost {differing} master pixels")

    # Cubism-imported PSDs in the proven V3 path use an RGB document whose
    # individual pixel layers carry transparency. psd-tools flattens the empty
    # canvas to black, but Cubism reads each ArtMesh source layer's alpha.
    psd = PSDImage.new("RGB", clean.size, color=(0, 0, 0), depth=8)
    guide = Group.new(psd, name="00_GUIDE_DO_NOT_RIG", open_folder=False)
    source_layer = add_layer(guide, "ReferenceMasterFront", clean)
    source_layer.visible = False
    guide.visible = False

    for group_name in ("10_HEAD", "20_BODY", "30_DYNAMIC_GARMENT"):
        group = Group.new(psd, name=group_name, open_folder=True)
        for layer_name, image in groups[group_name]:
            add_layer(group, layer_name, image)

    underpaint = Group.new(psd, name="90_UNDERPAINT_TODO", open_folder=True)
    underpaint.visible = False
    psd.save(PSD_PATH)

    clean.save(PREVIEW_PATH, optimize=True)
    staged = PSDImage.open(PSD_PATH).composite().convert("RGB")
    staged_array = np.asarray(staged, dtype=np.uint8)
    solid = master[:, :, 3] == 255
    solid_diff = np.abs(
        staged_array.astype(np.int16) - master[:, :, :3].astype(np.int16)
    )
    solid_diff_pixels = int(np.any(solid_diff > 0, axis=2)[solid].sum())
    solid_max_channel_error = int(solid_diff[solid].max())
    if solid_diff_pixels != 0:
        raise RuntimeError(
            f"PSD changed {solid_diff_pixels} solid character pixels "
            f"(max error {solid_max_channel_error})"
        )
    alpha = master[:, :, 3]
    ys, xs = np.where(alpha > 0)

    report: dict[str, object] = {
        "schema": "bamboo-crane-maiden-v4-source-psd-report/v1",
        "source": str(MASTER_PATH.relative_to(ROOT)).replace("\\", "/"),
        "source_sha256": sha256(MASTER_PATH),
        "clean_master": str(CLEAN_MASTER_PATH.relative_to(ROOT)).replace("\\", "/"),
        "clean_master_sha256": sha256(CLEAN_MASTER_PATH),
        "psd": str(PSD_PATH.relative_to(ROOT)).replace("\\", "/"),
        "psd_sha256": sha256(PSD_PATH),
        "canvas": [width, height],
        "clean_alpha_bbox": [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)],
        "clean_visible_pixels": int(visible.sum()),
        "layer_count": len(manifest),
        "layers": manifest,
        "partition_unassigned_pixels": int(remaining.sum()),
        "partition_reconstruction_diff_pixels": 0,
        "staged_composite_solid_rgb_diff_pixels": solid_diff_pixels,
        "staged_composite_solid_max_channel_error": solid_max_channel_error,
        "antialiased_edge_pixels": int(((alpha > 0) & (alpha < 255)).sum()),
        "preview": str(PREVIEW_PATH.relative_to(ROOT)).replace("\\", "/"),
        "quality_boundary": (
            "This is a pixel-exact neutral scaffold from the new front master. "
            "Head facial features, joint underpaint, sleeve articulation, hair strands, "
            "and eye/mouth difference art are not yet production-ready."
        ),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2))
