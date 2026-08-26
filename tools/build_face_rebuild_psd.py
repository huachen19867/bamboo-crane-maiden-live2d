"""Build a non-destructive V2 PSD with a properly partitioned eye structure.

The existing official PSD remains untouched.  This builder takes its proven
neutral body layers, replaces only the two large eye patches with tightly
bounded eye-white/iris/pupil/highlight/lid pieces, and writes a new staged PSD
for visual review before any Cubism import.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_cubism_psd as v1


RUNTIME = ROOT / "assets" / "runtime"
V1_LAYERS = ROOT / "assets" / "cubism" / "layers"
V2_LAYERS = ROOT / "assets" / "cubism" / "rebuild-v2" / "face-layers"
MODEL = ROOT / "model" / "cubism" / "bamboo-crane-maiden-face-rebuild-v2.psd"
PREVIEW = ROOT / "exports" / "cubism-face-rebuild-v2-preview.png"
FACE_PREVIEW = ROOT / "exports" / "cubism-face-rebuild-v2-face-close.png"
REPORT = ROOT / "exports" / "cubism-face-rebuild-v2-report.json"
REQUIRED_V1_LAYERS = (
    "UnderpaintNeckShoulder.png", "UnderpaintTorso.png", "UnderpaintPelvis.png",
    "UnderpaintArmLUpper.png", "UnderpaintArmLLower.png", "UnderpaintArmRUpper.png",
    "UnderpaintArmRLower.png", "UnderpaintLegLUpper.png", "UnderpaintLegLLower.png",
    "UnderpaintFootL.png", "UnderpaintLegRUpper.png", "UnderpaintLegRLower.png",
    "UnderpaintFootR.png", "ArtHeadBase.png", "ArtHairRoot.png", "ArtHairTips.png",
    "ArtEyeClosedL.png", "ArtEyeClosedR.png",
)


def ellipse_mask(bounds: tuple[int, int, int, int], blur: float = 0.0) -> Image.Image:
    mask = Image.new("L", v1.CANVAS, 0)
    ImageDraw.Draw(mask).ellipse(bounds, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask


def line_mask(
    points: list[tuple[int, int]], width: int, blur: float = 0.4
) -> Image.Image:
    mask = Image.new("L", v1.CANVAS, 0)
    ImageDraw.Draw(mask).line(points, fill=255, width=width, joint="curve")
    return mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask


def subtract(base: Image.Image, *cuts: Image.Image) -> Image.Image:
    result = base
    for cut in cuts:
        result = ImageChops.subtract(result, cut)
    return result


def save_candidate_layer(name: str, image: Image.Image) -> tuple[str, Image.Image]:
    V2_LAYERS.mkdir(parents=True, exist_ok=True)
    image.save(V2_LAYERS / f"{name}.png", optimize=True)
    return name, image


def eye_layers(side: str, master: Image.Image) -> list[tuple[str, Image.Image]]:
    """Split a source-faithful eye patch into independently deformable pieces.

    Components are mutually exclusive in their opaque interiors.  The full eye
    patch follows the same paths as the verified v1 source, so neutral compositing
    retains its exact eyelid contour while giving Cubism small meshes to animate.
    """

    if side == "L":
        full = v1.polygon_mask(
            [(580, 274), (586, 260), (607, 254), (625, 260),
             (630, 274), (621, 298), (604, 306), (588, 296)],
            blur=1.5,
        )
        iris = ellipse_mask((595, 262, 618, 296), blur=0.7)
        pupil = ellipse_mask((602, 268, 612, 291), blur=0.5)
        highlight = ellipse_mask((599, 266, 605, 273), blur=0.35)
        upper = line_mask([(583, 270), (593, 258), (607, 256), (622, 263), (628, 271)], 5)
        lower = line_mask([(586, 292), (599, 301), (612, 301), (624, 291)], 3)
    elif side == "R":
        full = v1.polygon_mask(
            [(631, 273), (637, 258), (655, 253), (674, 258),
             (679, 273), (670, 299), (653, 306), (638, 296)],
            blur=1.5,
        )
        iris = ellipse_mask((644, 261, 667, 296), blur=0.7)
        pupil = ellipse_mask((651, 267, 661, 290), blur=0.5)
        highlight = ellipse_mask((648, 265, 654, 272), blur=0.35)
        upper = line_mask([(634, 269), (644, 257), (657, 255), (672, 262), (677, 270)], 5)
        lower = line_mask([(637, 291), (649, 301), (663, 301), (675, 290)], 3)
    else:  # pragma: no cover - private call guard
        raise ValueError(side)

    # The contour and eyelid edges are source pixels, not freshly painted dark
    # strokes.  This prevents a new cartoon eye from appearing over the reference.
    white = subtract(full, iris, upper, lower)
    iris_only = subtract(iris, pupil, highlight, upper, lower)
    pupil_only = subtract(pupil, highlight, upper, lower)
    pieces = [
        (f"ArtEyeWhite{side}", white),
        (f"ArtIris{side}", iris_only),
        (f"ArtPupil{side}", pupil_only),
        (f"ArtHighlight{side}", highlight),
        (f"ArtUpperLid{side}", upper),
        (f"ArtLowerLid{side}", lower),
    ]
    return [save_candidate_layer(name, v1.masked(master, mask)) for name, mask in pieces]


def layer(path_name: str, object_name: str) -> tuple[str, Image.Image]:
    return object_name, v1.rgba(V1_LAYERS / path_name)


def runtime_layer(path_name: str, object_name: str) -> tuple[str, Image.Image]:
    return object_name, v1.rgba(RUNTIME / path_name)


def build() -> dict[str, object]:
    # V2 images are purely generated staging data.  Clean only the exact V2
    # directory, never v1 layers or the current official source.
    missing = [name for name in REQUIRED_V1_LAYERS if not (V1_LAYERS / name).is_file()]
    if missing:
        raise RuntimeError(
            "V1 generated layers are missing; run tools/build_cubism_psd.py first: "
            + ", ".join(missing)
        )
    if V2_LAYERS.exists():
        for old in V2_LAYERS.glob("*.png"):
            old.unlink()
    V2_LAYERS.mkdir(parents=True, exist_ok=True)
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)

    master = v1.rgba(RUNTIME / "character-master.png")
    psd = v1.PSDImage.new("RGB", v1.CANVAS, color=(0, 0, 0), depth=8)

    # Keep current non-face groups intact for a truthful full-body neutral
    # review.  They remain explicitly named Legacy* because this PSD does not
    # pretend to have solved their continuity yet.
    v1.add_group(psd, "LegacyUnderpaint", [
        layer(f"{name}.png", name)
        for name in (
            "UnderpaintNeckShoulder", "UnderpaintTorso", "UnderpaintPelvis",
            "UnderpaintArmLUpper", "UnderpaintArmLLower", "UnderpaintArmRUpper",
            "UnderpaintArmRLower", "UnderpaintLegLUpper", "UnderpaintLegLLower",
            "UnderpaintFootL", "UnderpaintLegRUpper", "UnderpaintLegRLower",
            "UnderpaintFootR",
        )
    ])
    v1.add_group(psd, "LegacyLegsFeet", [
        runtime_layer("foot-left.png", "ArtFootL"), runtime_layer("foot-right.png", "ArtFootR"),
    ])
    v1.add_group(psd, "LegacySkirt", [
        runtime_layer("hem-left.png", "ArtHemL"), runtime_layer("hem-right.png", "ArtHemR"),
        runtime_layer("hem-center.png", "ArtHemCenter"),
    ])
    v1.add_group(psd, "LegacyTorso", [runtime_layer("body-rig-base.png", "ArtBodyBase")])
    v1.add_group(psd, "LegacyArmsSleeves", [
        runtime_layer("arm-left.png", "ArtArmL"), runtime_layer("arm-right.png", "ArtArmR"),
    ])
    v1.add_group(psd, "LegacyRibbons", [
        runtime_layer("ribbon-lower.png", "ArtRibbonLower"), runtime_layer("ribbon-upper.png", "ArtRibbonUpper"),
    ])

    head_layers = [
        layer("ArtHeadBase.png", "ArtFaceBase"),
        layer("ArtHairRoot.png", "ArtHairRoot"),
        layer("ArtHairTips.png", "ArtHairTips"),
        *eye_layers("L", master),
        *eye_layers("R", master),
        layer("ArtEyeClosedL.png", "ArtEyeClosedL"),
        layer("ArtEyeClosedR.png", "ArtEyeClosedR"),
    ]
    head = v1.add_group(psd, "HeadFaceV2", head_layers)
    for pixel_layer in head:
        if pixel_layer.name.startswith("ArtEyeClosed"):
            pixel_layer.visible = False

    guide = v1.add_group(psd, "Guide", [("ReferenceNeutral", master)])
    guide.visible = False
    psd.save(MODEL)

    preview = v1.PSDImage.open(MODEL).composite(force=True).convert("RGBA")
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    preview.save(PREVIEW, optimize=True)
    # A close review is intentionally generated from the staged PSD composite,
    # not from the original reference: it proves the actual eye layers still
    # reconstruct the accepted face at rest.
    preview.crop((550, 190, 715, 365)).resize((1320, 1400), Image.Resampling.LANCZOS).save(
        FACE_PREVIEW, optimize=True
    )
    score = v1.alpha_weighted_similarity(preview, master)
    alpha_score = v1.alpha_iou(preview, master)
    report = {
        "purpose": "staged face-only rebuild; legacy body groups are not completed joints",
        "psd": str(MODEL.relative_to(ROOT)),
        "preview": str(PREVIEW.relative_to(ROOT)),
        "facePreview": str(FACE_PREVIEW.relative_to(ROOT)),
        "eyeLayersPerSide": ["EyeWhite", "Iris", "Pupil", "Highlight", "UpperLid", "LowerLid"],
        "neutralSimilarity": score,
        "neutralAlphaIoU": alpha_score,
        "pass": score >= 0.99 and alpha_score >= 0.99,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["pass"]:
        raise RuntimeError(f"face V2 neutral preview diverged: {report}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    build()
