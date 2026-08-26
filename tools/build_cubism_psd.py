"""Build the layered PSD used as the official Cubism Editor rebuild source.

The browser prototype remains useful as a control specification, but its PNG
pieces were moved rigidly.  This builder repackages the same pixel-faithful
neutral artwork into a valid-name PSD and adds generated hidden underpainting
for shoulder/elbow/hip/knee/ankle continuity.  Cubism Editor is then responsible
for ArtMesh, Deformer, Glue, parameter and physics authoring.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
RUNTIME = ASSETS / "runtime"
CUBISM_ASSETS = ASSETS / "cubism"
GENERATED_LAYERS = CUBISM_ASSETS / "layers"
MODEL_DIR = ROOT / "model" / "cubism"
EXPORTS = ROOT / "exports"

VENDOR = ROOT / "tools" / "_python"
if VENDOR.exists():
    sys.path.insert(0, str(VENDOR))

try:
    from psd_tools import PSDImage
    from psd_tools.api.layers import Group, PixelLayer
except ImportError as exc:  # pragma: no cover - actionable setup failure
    raise SystemExit(
        "psd-tools is required. Install it with: "
        "python -m pip install --target tools/_python 'psd-tools>=1.10,<2'"
    ) from exc


CANVAS = (1254, 1254)
VALID_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def connected_neutral_background(rgb: np.ndarray) -> np.ndarray:
    """Remove the generated checkerboard without erasing interior pale cloth."""
    h, w, _ = rgb.shape
    lo = rgb.min(axis=2)
    hi = rgb.max(axis=2)
    candidate = (lo >= 185) & ((hi - lo) <= 26)

    seen = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        if candidate[0, x]:
            stack.append((0, x))
        if candidate[h - 1, x]:
            stack.append((h - 1, x))
    for y in range(h):
        if candidate[y, 0]:
            stack.append((y, 0))
        if candidate[y, w - 1]:
            stack.append((y, w - 1))

    while stack:
        y, x = stack.pop()
        if seen[y, x] or not candidate[y, x]:
            continue
        seen[y, x] = True
        if y:
            stack.append((y - 1, x))
        if y + 1 < h:
            stack.append((y + 1, x))
        if x:
            stack.append((y, x - 1))
        if x + 1 < w:
            stack.append((y, x + 1))

    # Clear enclosed bright checker cores, protecting the face and hands.
    bright = (lo >= 232) & ((hi - lo) <= 20)
    bright[80:380, 430:735] = False
    bright[250:700, 230:990] = False
    seen |= bright
    background = Image.fromarray((seen * 255).astype(np.uint8), "L")
    background = background.filter(ImageFilter.GaussianBlur(1.15))
    return 255 - np.asarray(background, dtype=np.uint8)


def rgba(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    if image.size != CANVAS:
        image = image.resize(CANVAS, Image.Resampling.LANCZOS)
    return image


def polygon_mask(points: list[tuple[int, int]], blur: float = 1.2) -> Image.Image:
    mask = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def masked(image: Image.Image, mask: Image.Image) -> Image.Image:
    out = image.copy()
    out.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return out


def safe_clean_generated_layers() -> None:
    target = GENERATED_LAYERS.resolve()
    expected_parent = CUBISM_ASSETS.resolve()
    if target.parent != expected_parent or target.name != "layers":
        raise RuntimeError(f"refusing to clean unexpected target: {target}")
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)


def clean_underpaint(coverage_alpha: Image.Image) -> Image.Image:
    raw_path = CUBISM_ASSETS / "body-underpaint-v1.png"
    raw = Image.open(raw_path).convert("RGB")
    if raw.size != CANVAS:
        raw = raw.resize(CANVAS, Image.Resampling.LANCZOS)
    alpha = connected_neutral_background(np.asarray(raw))
    underpaint = Image.fromarray(np.dstack([np.asarray(raw), alpha]), "RGBA")

    # Underpaint is allowed only where the neutral outer artwork is fully
    # opaque.  It is invisible at rest, then becomes visible when a sleeve,
    # skirt or limb ArtMesh moves away.  Eroding the coverage prevents pale
    # generated pixels from leaking around antialiased silhouettes.
    occluded = coverage_alpha.point(lambda value: 255 if value == 255 else 0)
    occluded = occluded.filter(ImageFilter.MinFilter(7))
    underpaint.putalpha(ImageChops.multiply(underpaint.getchannel("A"), occluded))
    underpaint.save(CUBISM_ASSETS / "body-underpaint-clean.png", optimize=True)
    return underpaint


def build_underpaint_layers(
    underpaint: Image.Image,
    neutral_master: Image.Image,
) -> dict[str, Image.Image]:
    def extend_neutral_texture(points: list[tuple[int, int]]) -> Image.Image:
        """Bridge only the truly transparent right-shoulder seam.

        This deliberately does *not* copy the composited neutral master into
        the whole limiting polygon.  That historical approach promoted real
        sleeve and waist pixels to an opaque static trapezoid, which surfaced
        as a duplicate dark-cyan patch at the right-shoulder extreme.  The
        polygon here merely bounds a strict-alpha seam.  Its colour is rebuilt
        between opaque pixels from the torso and articulated arm source layers.
        """

        corridor = np.asarray(polygon_mask(points, blur=0.0)) > 0
        master = np.asarray(neutral_master.convert("RGBA"))
        strict_gap = corridor & (master[:, :, 3] <= 32)

        # The additional four pixels remain hidden under the two real meshes
        # in neutral pose; they provide overlap when the shoulder rotates.
        expanded = np.asarray(
            Image.fromarray((strict_gap * 255).astype(np.uint8), "L").filter(
                ImageFilter.MaxFilter(9)
            )
        )
        expanded = expanded & corridor
        alpha = np.asarray(
            Image.fromarray((expanded * 255).astype(np.uint8), "L").filter(
                ImageFilter.GaussianBlur(0.6))
        )
        alpha = np.where(corridor, alpha, 0).astype(np.uint8)

        body = np.asarray(rgba(RUNTIME / "body-rig-base.png"), dtype=np.uint8)
        arm = np.asarray(rgba(RUNTIME / "arm-right.png"), dtype=np.uint8)
        samples: dict[int, tuple[int, int, np.ndarray, np.ndarray]] = {}
        for y in np.flatnonzero(strict_gap.any(axis=1)):
            gap_x = np.flatnonzero(strict_gap[y])
            left, right = int(gap_x[0]), int(gap_x[-1])
            row_lo, row_hi = max(0, y - 2), min(CANVAS[1], y + 3)
            left_strip = body[row_lo:row_hi, max(0, left - 10):max(0, left - 2)]
            right_strip = arm[row_lo:row_hi, min(CANVAS[0], right + 3):min(CANVAS[0], right + 11)]
            left_pixels = left_strip[left_strip[:, :, 3] >= 224][:, :3]
            right_pixels = right_strip[right_strip[:, :, 3] >= 224][:, :3]
            if len(left_pixels) and len(right_pixels):
                samples[int(y)] = (
                    left,
                    right,
                    np.median(left_pixels, axis=0),
                    np.median(right_pixels, axis=0),
                )

        if not samples:
            raise RuntimeError("right-shoulder seam has no opaque donor strips")

        # Smooth the donor colours in the vertical direction, but never blur
        # unpremultiplied RGBA: that was the source of the historical pale
        # horizontal stripes.
        source_rows = np.array(sorted(samples), dtype=int)
        smoothed: dict[int, tuple[int, int, np.ndarray, np.ndarray]] = {}
        weights = np.array([1.0, 2.0, 3.0, 2.0, 1.0])
        for y in source_rows:
            nearby = source_rows[(source_rows >= y - 2) & (source_rows <= y + 2)]
            local_weights = np.array([weights[row - y + 2] for row in nearby])
            smoothed[int(y)] = (
                samples[int(y)][0],
                samples[int(y)][1],
                np.average([samples[int(row)][2] for row in nearby], axis=0, weights=local_weights),
                np.average([samples[int(row)][3] for row in nearby], axis=0, weights=local_weights),
            )

        output = np.zeros((CANVAS[1], CANVAS[0], 4), dtype=np.uint8)
        for y in np.flatnonzero(alpha.any(axis=1)):
            nearest = int(source_rows[np.argmin(np.abs(source_rows - y))])
            left, right, left_rgb, right_rgb = smoothed[nearest]
            target_x = np.flatnonzero(alpha[y] > 0)
            # The colour transition extends through the four-pixel overlap,
            # keeping the bridge a continuous shade instead of a hard seam.
            blend = np.clip((target_x - (left - 4)) / max(1, (right - left) + 8), 0.0, 1.0)
            output[y, target_x, :3] = np.round(
                left_rgb[None, :] * (1.0 - blend[:, None])
                + right_rgb[None, :] * blend[:, None]
            ).astype(np.uint8)
            output[y, target_x, 3] = alpha[y, target_x]
        return Image.fromarray(output, "RGBA")

    specs = {
        "UnderpaintNeckShoulder": [(390, 235), (760, 220), (815, 500), (375, 525)],
        "UnderpaintTorso": [(385, 350), (815, 335), (845, 720), (360, 735)],
        "UnderpaintPelvis": [(355, 555), (835, 540), (865, 900), (350, 910)],
        "UnderpaintArmLUpper": [(350, 330), (505, 335), (535, 500), (375, 540)],
        # Lower-arm underpaint is limited to the elbow overlap.  Extending it
        # through the free hand exposed a static duplicate hand when the
        # Cubism shoulder parameter moved the articulated arm away.
        "UnderpaintArmLLower": [(380, 430), (520, 410), (530, 620), (360, 650)],
        "UnderpaintArmRUpper": [(555, 330), (680, 315), (735, 500), (590, 550)],
        "UnderpaintArmRLower": [(640, 325), (760, 310), (800, 470), (665, 520)],
        "UnderpaintLegLUpper": [(420, 660), (650, 645), (665, 930), (405, 965)],
        "UnderpaintLegLLower": [(430, 825), (640, 800), (650, 1140), (410, 1185)],
        "UnderpaintFootL": [(385, 1050), (650, 1010), (665, 1248), (360, 1248)],
        "UnderpaintLegRUpper": [(570, 645), (785, 650), (810, 940), (560, 955)],
        "UnderpaintLegRLower": [(560, 810), (790, 820), (805, 1135), (550, 1160)],
        "UnderpaintFootR": [(535, 1030), (815, 1010), (840, 1248), (520, 1248)],
    }
    result: dict[str, Image.Image] = {}
    # Limit the right-shoulder bridge to the observed transparent seam.  This
    # is a limiter rather than a texture shape: see extend_neutral_texture().
    connector_specs = {
        "UnderpaintArmRUpper": [
            (635, 504), (650, 503), (653, 516), (657, 530),
            (662, 543), (665, 552), (652, 554), (648, 544),
            (643, 534), (632, 530), (634, 516),
        ],
    }
    for name, points in specs.items():
        if not VALID_ID.fullmatch(name):
            raise RuntimeError(f"invalid Cubism object name: {name}")
        layer = masked(underpaint, polygon_mask(points))
        connector_points = connector_specs.get(name)
        if connector_points is not None:
            connector = extend_neutral_texture(connector_points)
            layer.alpha_composite(connector)
            layer_alpha = np.asarray(layer.getchannel("A"))
            if np.any(layer_alpha[555:, 620:700] > 0):
                raise RuntimeError("right-shoulder underpaint escaped below the seam")
        layer.save(GENERATED_LAYERS / f"{name}.png", optimize=True)
        result[name] = layer
    return result


def build_face_layers(master: Image.Image) -> dict[str, Image.Image]:
    """Build blink-safe head and eye textures from the neutral master.

    The browser prototype's eye PNGs were broad feathered half-face patches.
    They looked correct at rest, but a Cubism eye Warp could not close them:
    moving the patch merely exposed an identical open eye in ``head-base``.
    Keep each eye as a tight neutral-master patch and replace the matching
    pixels in the head base with a locally fitted skin plane.  At EyeOpen=1
    the exact master pixels cover the fill.  A separate closed-lash layer is
    generated for each eye so EyeOpen=0 can cross-fade to a clean dark curve;
    compressing the complete iris texture alone leaves a green residual line.
    """

    specs = {
        "ArtEyeL": [(580, 274), (586, 260), (607, 254), (625, 260),
                    (630, 274), (621, 298), (604, 306), (588, 296)],
        "ArtEyeR": [(631, 273), (637, 258), (655, 253), (674, 258),
                    (679, 273), (670, 299), (653, 306), (638, 296)],
    }
    master_array = np.asarray(master.convert("RGBA"), dtype=np.float32)
    head = rgba(RUNTIME / "head-base.png")
    head_array = np.asarray(head, dtype=np.float32).copy()
    result: dict[str, Image.Image] = {}
    eye_exclusion = Image.new("L", CANVAS, 0)

    closed_specs = {
        "ArtEyeClosedL": ((585.0, 274.0), (605.0, 283.0), (627.0, 274.0), "left"),
        "ArtEyeClosedR": ((636.0, 274.0), (655.0, 282.0), (676.0, 273.0), "right"),
    }

    # Supersample the short lashes so they stay smooth after Cubism packs the
    # tightly bounded layer into the texture atlas.  The curve is intentionally
    # dark brown rather than pure black to match the reference line art.
    scale = 4
    for name, (start, control, end, outer_side) in closed_specs.items():
        large = Image.new("RGBA", (CANVAS[0] * scale, CANVAS[1] * scale), (0, 0, 0, 0))
        draw = ImageDraw.Draw(large)
        curve: list[tuple[int, int]] = []
        for index in range(41):
            t = index / 40.0
            one_minus = 1.0 - t
            x = one_minus * one_minus * start[0] + 2.0 * one_minus * t * control[0] + t * t * end[0]
            y = one_minus * one_minus * start[1] + 2.0 * one_minus * t * control[1] + t * t * end[1]
            curve.append((round(x * scale), round(y * scale)))
        lash_color = (61, 43, 35, 245)
        draw.line(curve, fill=lash_color, width=9, joint="curve")
        if outer_side == "left":
            outer = (round(start[0] * scale), round(start[1] * scale))
            draw.line([outer, (round((start[0] - 6.0) * scale), round((start[1] - 4.0) * scale))],
                      fill=lash_color, width=6)
            draw.line([outer, (round((start[0] - 5.0) * scale), round((start[1] - 1.0) * scale))],
                      fill=lash_color, width=5)
        else:
            outer = (round(end[0] * scale), round(end[1] * scale))
            draw.line([outer, (round((end[0] + 6.0) * scale), round((end[1] - 5.0) * scale))],
                      fill=lash_color, width=6)
            draw.line([outer, (round((end[0] + 5.0) * scale), round((end[1] - 1.0) * scale))],
                      fill=lash_color, width=5)
        lash = large.resize(CANVAS, Image.Resampling.LANCZOS)
        lash.save(GENERATED_LAYERS / f"{name}.png", optimize=True)
        result[name] = lash

    for name, points in specs.items():
        hard_mask = polygon_mask(points, blur=0.0)
        soft_mask = hard_mask.filter(ImageFilter.GaussianBlur(1.5))
        eye_exclusion = ImageChops.lighter(eye_exclusion, soft_mask)
        eye = masked(master, soft_mask)
        eye.save(GENERATED_LAYERS / f"{name}.png", optimize=True)
        result[name] = eye

        mask = np.asarray(soft_mask, dtype=np.float32) / 255.0
        ys, xs = np.where(np.asarray(hard_mask) > 0)
        left, right = max(0, int(xs.min()) - 14), min(CANVAS[0], int(xs.max()) + 15)
        top, bottom = max(0, int(ys.min()) - 14), min(CANVAS[1], int(ys.max()) + 15)

        local = master_array[top:bottom, left:right]
        local_mask = mask[top:bottom, left:right]
        spread = np.asarray(
            soft_mask.filter(ImageFilter.MaxFilter(25)), dtype=np.float32
        )[top:bottom, left:right] / 255.0
        ring = (spread > 0.2) & (local_mask < 0.02)
        rgb = local[:, :, :3]
        # Skin samples: sufficiently bright, warm, and not green iris/hair.
        skin = (
            ring
            & (local[:, :, 3] > 220)
            & (rgb[:, :, 0] > 195)
            & ((rgb[:, :, 0] - rgb[:, :, 1]) > 12)
            & ((rgb[:, :, 1] - rgb[:, :, 2]) > 8)
        )
        sample_y, sample_x = np.where(skin)
        if len(sample_x) < 20:
            raise RuntimeError(f"not enough skin samples to fill {name}: {len(sample_x)}")

        targets = rgb[sample_y, sample_x]
        # Interpolate only from nearby skin samples.  A generic Laplace fill
        # lets dark bangs dominate the upper/right boundary and produces a
        # brown eye-shaped stain; inverse-distance skin interpolation preserves
        # the cheek/forehead gradient without pulling in hair or iris colors.
        fitted = local[:, :, :3].copy()
        hole = np.asarray(hard_mask)[top:bottom, left:right] > 0
        hole_y, hole_x = np.where(hole)
        nearest_count = min(32, len(sample_x))
        for start in range(0, len(hole_x), 512):
            target_x = hole_x[start:start + 512, None]
            target_y = hole_y[start:start + 512, None]
            distance2 = (
                (target_x - sample_x[None, :]) ** 2
                + (target_y - sample_y[None, :]) ** 2
            ).astype(np.float32)
            nearest = np.argpartition(
                distance2, nearest_count - 1, axis=1
            )[:, :nearest_count]
            near_distance2 = np.take_along_axis(distance2, nearest, axis=1)
            weights = 1.0 / (near_distance2 + 2.0)
            colors = targets[nearest]
            interpolated = (colors * weights[:, :, None]).sum(axis=1)
            interpolated /= weights.sum(axis=1)[:, None]
            fitted[
                hole_y[start:start + 512], hole_x[start:start + 512]
            ] = interpolated
        fill = np.dstack([fitted, np.full_like(fitted[:, :, :1], 255.0)])
        blend = local_mask[:, :, None]
        current = head_array[top:bottom, left:right]
        head_array[top:bottom, left:right] = current * (1.0 - blend) + fill * blend

    corrected_head = Image.fromarray(np.clip(head_array, 0, 255).astype(np.uint8), "RGBA")
    corrected_head.save(GENERATED_LAYERS / "ArtHeadBase.png", optimize=True)
    result["ArtHeadBase"] = corrected_head

    # The prototype's hair-root PNG also contains the complete face.  Preserve
    # its outer silhouette for neutral likeness, but remove the eye regions so
    # the duplicated open eyes cannot show through a closing eye ArtMesh.
    eye_block = eye_exclusion
    hair_root = rgba(RUNTIME / "hair-root.png")
    hair_root.putalpha(ImageChops.multiply(
        hair_root.getchannel("A"), ImageChops.invert(eye_block)
    ))
    hair_root.save(GENERATED_LAYERS / "ArtHairRoot.png", optimize=True)
    result["ArtHairRoot"] = hair_root

    hair_tips = rgba(RUNTIME / "hair-tips.png")
    hair_tips.save(GENERATED_LAYERS / "ArtHairTips.png", optimize=True)
    result["ArtHairTips"] = hair_tips
    return result


def add_pixel_layer(group: Group, name: str, image: Image.Image) -> PixelLayer:
    """Add a tightly bounded RGBA layer while preserving canvas coordinates.

    ``PixelLayer.frompil`` uses the supplied image dimensions as the Photoshop
    layer record bounds.  Passing a full-canvas transparent PNG therefore makes
    Cubism import a 1254 x 1254 layer even when only a small eye or hair strand
    is visible.  Cubism then fits ArtMeshes and Warp Deformers to the whole
    canvas, which defeats local continuous deformation.  Crop to the alpha
    bounds and carry the crop origin through ``top``/``left`` instead.
    """

    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError(f"cannot create empty Cubism pixel layer: {name}")
    left, top, right, bottom = bounds
    cropped = image.crop((left, top, right, bottom))
    return PixelLayer.frompil(cropped, group, name=name, top=top, left=left)


def add_group(psd: PSDImage, name: str, layers: list[tuple[str, Image.Image]]) -> Group:
    if not VALID_ID.fullmatch(name):
        raise RuntimeError(f"invalid Cubism group name: {name}")
    group = Group.new(psd, name=name, open_folder=True)
    for layer_name, image in layers:
        if not VALID_ID.fullmatch(layer_name):
            raise RuntimeError(f"invalid Cubism layer name: {layer_name}")
        add_pixel_layer(group, layer_name, image)
    return group


def alpha_weighted_similarity(actual: Image.Image, reference: Image.Image) -> float:
    a = np.asarray(actual.convert("RGBA"), dtype=np.float32)
    r = np.asarray(reference.convert("RGBA"), dtype=np.float32)
    weight = r[:, :, 3] / 255.0
    denom = float(weight.sum() * 3.0)
    if denom <= 0:
        return 0.0
    error = float((np.abs(a[:, :, :3] - r[:, :, :3]) * weight[:, :, None]).sum())
    return 1.0 - error / (255.0 * denom)


def alpha_iou(actual: Image.Image, reference: Image.Image) -> float:
    a = np.asarray(actual.convert("RGBA"))[:, :, 3] > 16
    r = np.asarray(reference.convert("RGBA"))[:, :, 3] > 16
    union = int(np.logical_or(a, r).sum())
    return float(np.logical_and(a, r).sum() / union) if union else 1.0


def build() -> dict:
    CUBISM_ASSETS.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS.mkdir(parents=True, exist_ok=True)
    safe_clean_generated_layers()

    master = rgba(RUNTIME / "character-master.png")
    face_layers = build_face_layers(master)
    outer_draw_order = [
        "foot-left.png", "foot-right.png",
        "hem-left.png", "hem-right.png", "hem-center.png",
        "body-rig-base.png", "arm-left.png", "arm-right.png",
        "ribbon-lower.png", "ribbon-upper.png",
        "head-base.png", "hair-root.png", "hair-tips.png",
        "eye-left-open.png", "eye-right-open.png",
    ]
    outer_neutral = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    for filename in outer_draw_order:
        outer_neutral.alpha_composite(rgba(RUNTIME / filename))
    underpaint = clean_underpaint(outer_neutral.getchannel("A"))
    underpaint_layers = build_underpaint_layers(underpaint, master)

    psd = PSDImage.new("RGB", CANVAS, color=(0, 0, 0), depth=8)
    add_group(psd, "Underpaint", list(underpaint_layers.items()))
    add_group(psd, "LegsFeet", [
        ("ArtFootL", rgba(RUNTIME / "foot-left.png")),
        ("ArtFootR", rgba(RUNTIME / "foot-right.png")),
    ])
    add_group(psd, "Skirt", [
        ("ArtHemL", rgba(RUNTIME / "hem-left.png")),
        ("ArtHemR", rgba(RUNTIME / "hem-right.png")),
        ("ArtHemCenter", rgba(RUNTIME / "hem-center.png")),
    ])
    add_group(psd, "Torso", [
        ("ArtBodyBase", rgba(RUNTIME / "body-rig-base.png")),
    ])
    add_group(psd, "ArmsSleeves", [
        ("ArtArmL", rgba(RUNTIME / "arm-left.png")),
        ("ArtArmR", rgba(RUNTIME / "arm-right.png")),
    ])
    add_group(psd, "Ribbons", [
        ("ArtRibbonLower", rgba(RUNTIME / "ribbon-lower.png")),
        ("ArtRibbonUpper", rgba(RUNTIME / "ribbon-upper.png")),
    ])
    head_group = add_group(psd, "HeadFace", [
        ("ArtHeadBase", face_layers["ArtHeadBase"]),
        ("ArtHairRoot", face_layers["ArtHairRoot"]),
        ("ArtHairTips", face_layers["ArtHairTips"]),
        ("ArtEyeL", face_layers["ArtEyeL"]),
        ("ArtEyeR", face_layers["ArtEyeR"]),
        ("ArtEyeClosedL", face_layers["ArtEyeClosedL"]),
        ("ArtEyeClosedR", face_layers["ArtEyeClosedR"]),
    ])
    for layer in head_group:
        if layer.name.startswith("ArtEyeClosed"):
            layer.visible = False
    guide = add_group(psd, "Guide", [("ReferenceNeutral", master)])
    guide.visible = False

    psd_path = MODEL_DIR / "bamboo-crane-maiden-source.psd"
    psd.save(psd_path)
    reopened = PSDImage.open(psd_path)
    preview = reopened.composite(force=True).convert("RGBA")
    preview_path = EXPORTS / "cubism-psd-preview.png"
    preview.save(preview_path, optimize=True)

    pixel_layers = [layer for layer in reopened.descendants() if isinstance(layer, PixelLayer)]
    layer_names = [layer.name for layer in pixel_layers]
    invalid_names = [name for name in layer_names if not VALID_ID.fullmatch(name)]
    full_canvas_layers = [
        layer.name
        for layer in pixel_layers
        if layer.bbox == (0, 0, CANVAS[0], CANVAS[1])
    ]
    report = {
        "editorTarget": "Live2D Cubism Editor 5.3.03",
        "canvas": list(CANVAS),
        "psd": str(psd_path.relative_to(ROOT)),
        "preview": str(preview_path.relative_to(ROOT)),
        "pixelLayers": len(layer_names),
        "fullCanvasPixelLayers": full_canvas_layers,
        "invalidObjectNames": invalid_names,
        "neutralSimilarity": alpha_weighted_similarity(preview, master),
        "neutralAlphaIoU": alpha_iou(preview, master),
        "underpaintLayers": len(underpaint_layers),
        "underpaintPurpose": "hidden joint and garment continuity; never used as the neutral likeness reference",
    }
    (EXPORTS / "cubism-psd-build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (CUBISM_ASSETS / "layer-manifest.json").write_text(
        json.dumps({"layers": layer_names}, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if invalid_names:
        raise RuntimeError(f"invalid Cubism object names: {invalid_names}")
    if report["neutralSimilarity"] < 0.95:
        raise RuntimeError(f"neutral likeness below 95%: {report}")
    if report["neutralAlphaIoU"] < 0.99:
        raise RuntimeError(f"neutral silhouette mismatch: {report}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    build()
