from __future__ import annotations

import hashlib
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from psd_tools import PSDImage
from psd_tools.api.layers import Group, PixelLayer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_source_psd import (
    cleaned_master,
    polygon_mask,
    rect_mask,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "assets" / "source" / "rebuild-v4"
MASTER_PATH = SOURCE_DIR / "character-master-front.png"
GUIDE_PATH = SOURCE_DIR / "head-detail-guide-v1.png"
FACE_BASE_CHROMA_PATH = SOURCE_DIR / "head-production" / "face-base-chroma-v2.png"
OUTPUT_DIR = SOURCE_DIR / "head-production" / "v2"
LAYERS_DIR = OUTPUT_DIR / "layers"
MASTER_OUTPUT_PATH = OUTPUT_DIR / "character-master-front-head-production-v2.png"
MODEL_PATH = ROOT / "model" / "cubism-v4" / "bamboo-crane-maiden-v4-head-production-v2.psd"
PREVIEW_PATH = ROOT / "exports" / "v4-head-production-neutral-v2.png"
HEAD_PREVIEW_PATH = ROOT / "exports" / "v4-head-production-guide-space-v2.png"
REPORT_PATH = ROOT / "exports" / "v4-head-production-report-v2.json"

CANVAS_SCALE = 2
GUIDE_TO_MODEL_SCALE = 0.716
GUIDE_TO_MODEL_OFFSET = (566, 24)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def mask_polygon(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    image = Image.new("L", size, 0)
    ImageDraw.Draw(image).polygon(points, fill=255)
    return np.asarray(image, dtype=np.uint8) > 0


def mask_rect(size: tuple[int, int], box: tuple[int, int, int, int]) -> np.ndarray:
    left, top, right, bottom = box
    return mask_polygon(size, [(left, top), (right, top), (right, bottom), (left, bottom)])


def dilate(mask: np.ndarray, size: int = 3) -> np.ndarray:
    if size <= 1:
        return mask
    image = Image.fromarray((mask.astype(np.uint8) * 255), "L")
    return np.asarray(image.filter(ImageFilter.MaxFilter(size)), dtype=np.uint8) > 0


def erode(mask: np.ndarray, size: int = 3) -> np.ndarray:
    if size <= 1:
        return mask
    image = Image.fromarray((mask.astype(np.uint8) * 255), "L")
    return np.asarray(image.filter(ImageFilter.MinFilter(size)), dtype=np.uint8) > 0


def edge_connected_neutral_background(rgb: np.ndarray) -> np.ndarray:
    """Find the guide's gray background without deleting enclosed face whites.

    The guide has no alpha. Its background is a low-chroma gray gradient. We
    flood only pixels reachable from the canvas edge, so the inked silhouette
    protects pale skin and eye whites. Enclosed low-chroma holes are removed
    later only outside the protected face/neck region.
    """

    channel_max = rgb.max(axis=2).astype(np.int16)
    channel_min = rgb.min(axis=2).astype(np.int16)
    mean = rgb.mean(axis=2)
    eligible = ((channel_max - channel_min) <= 28) & (mean >= 128)
    height, width = eligible.shape
    seen = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if eligible[y, x] and not seen[y, x]:
            seen[y, x] = True
            queue.append((y, x))

    for x in range(width):
        seed(0, x)
        seed(height - 1, x)
    for y in range(height):
        seed(y, 0)
        seed(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            seed(y - 1, x)
        if y + 1 < height:
            seed(y + 1, x)
        if x > 0:
            seed(y, x - 1)
        if x + 1 < width:
            seed(y, x + 1)
    return seen


def guide_subject_mask(guide: np.ndarray, protected: np.ndarray) -> np.ndarray:
    background = edge_connected_neutral_background(guide[:, :, :3])
    rgb = guide[:, :, :3].astype(np.int16)
    channel_range = rgb.max(axis=2) - rgb.min(axis=2)
    mean = rgb.mean(axis=2)
    neutral_hole = (channel_range <= 20) & (mean >= 180) & ~protected
    subject = ~(background | neutral_hole)
    return dilate(erode(subject, 3), 3)


def key_chroma_magenta(image: Image.Image) -> Image.Image:
    """Remove the generated magenta screen without retaining coloured fringe.

    The candidate background is not a single RGB value: image generation added
    a mild gradient and antialiasing. Euclidean distance from pure magenta made
    those mixed edge pixels partly opaque, so they reappeared as a bright halo
    after alignment. A hue/dominance test is a better fit for this controlled
    screen. The retained silhouette is deliberately binary at source scale;
    the subsequent bicubic transform provides the final sub-pixel edge.
    """

    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    magenta_dominance = np.minimum(r, b) - g
    rb_balance = np.abs(r - b)
    background = (
        (r > 145) & (b > 120) & (magenta_dominance > 18)
        & (rb_balance < 115)
    )
    # Swallow the one-pixel mixed screen fringe. At 1254 px this is still
    # narrower than the final face outline and prevents chroma spill entirely.
    background = dilate(background, 3)
    rgba[:, :, 3] = np.where(background, 0, 255).astype(np.uint8)
    rgba[background, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def align_face_base_to_guide(image: Image.Image) -> Image.Image:
    # Source landmarks from the second imagegen candidate:
    # centre x ~= 627, ear line y ~= 638. Guide targets are x ~= 623.5,
    # y ~= 640. X scale aligns ear spacing; Y scale prioritises ear-to-chin.
    source_cx, source_ear_y = 627.0, 638.0
    target_cx, target_ear_y = 623.5, 640.0
    # V1 used 0.777 in X and visibly pinched the cheeks, leaving a chroma ring
    # between the face and side hair. 0.83 aligns both cheek outline and ears.
    scale_x, scale_y = 0.83, 0.66
    inverse = (
        1.0 / scale_x,
        0.0,
        source_cx - target_cx / scale_x,
        0.0,
        1.0 / scale_y,
        source_ear_y - target_ear_y / scale_y,
    )
    return image.transform(
        image.size,
        Image.Transform.AFFINE,
        inverse,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def rgba_for_mask(source: np.ndarray, mask: np.ndarray) -> Image.Image:
    output = source.copy()
    output[:, :, 3] = np.where(mask, source[:, :, 3], 0).astype(np.uint8)
    output[output[:, :, 3] == 0, :3] = 0
    return Image.fromarray(output, "RGBA")


def layer_from_rgb(source_rgb: np.ndarray, mask: np.ndarray) -> Image.Image:
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = source_rgb
    rgba[:, :, 3] = mask.astype(np.uint8) * 255
    rgba[~mask, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def transform_guide_layer_to_model(layer: Image.Image, canvas: tuple[int, int]) -> Image.Image:
    scaled_size = (
        round(layer.width * GUIDE_TO_MODEL_SCALE),
        round(layer.height * GUIDE_TO_MODEL_SCALE),
    )
    scaled = layer.resize(scaled_size, Image.Resampling.LANCZOS)
    output = Image.new("RGBA", canvas, (0, 0, 0, 0))
    output.alpha_composite(scaled, GUIDE_TO_MODEL_OFFSET)
    return output


def add_layer(parent: Group | PSDImage, name: str, image: Image.Image) -> PixelLayer:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError(f"empty V4 head production layer: {name}")
    left, top, right, bottom = bounds
    return PixelLayer.frompil(image.crop(bounds), parent, name=name, top=top, left=left)


def composite_layers(size: tuple[int, int], layers: list[tuple[str, Image.Image]]) -> Image.Image:
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    for _, image in layers:
        result.alpha_composite(image)
    return result


def build_head_layers() -> tuple[list[tuple[str, Image.Image]], Image.Image, dict[str, object]]:
    guide_image = Image.open(GUIDE_PATH).convert("RGBA")
    guide = np.asarray(guide_image, dtype=np.uint8)
    size = guide_image.size
    rgb = guide[:, :, :3]

    face_region = mask_polygon(
        size,
        [
            (418, 515), (448, 455), (500, 402), (625, 375), (750, 402),
            (802, 455), (832, 515), (815, 650), (780, 705), (720, 758),
            (625, 802), (530, 758), (470, 705), (435, 650),
        ],
    )
    ear_l_region = mask_polygon(size, [(405, 555), (454, 545), (480, 620), (470, 682), (425, 690)])
    ear_r_region = mask_polygon(size, [(800, 545), (848, 555), (830, 690), (785, 682), (775, 620)])
    # Follow the visible V-shaped neck opening instead of the V1 rectangle.
    # The old rectangle extended over the collar and exposed the source screen
    # as a hard bar at its bottom edge.
    neck_region = mask_polygon(
        size,
        [(540, 735), (710, 735), (710, 795), (685, 835),
         (625, 944), (565, 835), (540, 795)],
    )
    skin_region = face_region | ear_l_region | ear_r_region | neck_region
    protected = dilate(skin_region, 9)
    subject = guide_subject_mask(guide, protected)

    # Limit the production head to hair, face, earrings and neck. Garment
    # shoulders from the guide are deliberately excluded.
    head_extent = mask_rect(size, (235, 0, 1015, 900)) | neck_region
    subject &= head_extent

    face_base = align_face_base_to_guide(key_chroma_magenta(Image.open(FACE_BASE_CHROMA_PATH)))
    face_base_rgba = np.asarray(face_base, dtype=np.uint8).copy()
    face_base_rgba[:, :, 3] = np.where(skin_region, face_base_rgba[:, :, 3], 0).astype(np.uint8)

    # The generated clean neck ends a little above the guide's collar point.
    # Fill only that explicit neck polygon from the guide; never fill the whole
    # face this way because doing so would bake the guide's bangs into FaceBase.
    neck_fallback = neck_region & (face_base_rgba[:, :, 3] < 16)
    face_base_rgba[neck_fallback, :3] = rgb[neck_fallback]
    face_base_rgba[neck_fallback, 3] = 255
    ear_fallback = (
        (ear_l_region | ear_r_region) & (face_base_rgba[:, :, 3] < 16)
    )
    face_base_rgba[ear_fallback, :3] = rgb[ear_fallback]
    face_base_rgba[ear_fallback, 3] = 255

    # Match the candidate's skin colour to the guide using cheek/jaw patches
    # that avoid eyes, hair, mouth and earrings.
    colour_sample = (
        mask_rect(size, (505, 605, 585, 690))
        | mask_rect(size, (665, 605, 745, 690))
        | mask_rect(size, (585, 720, 665, 765))
    ) & (face_base_rgba[:, :, 3] > 220)
    if colour_sample.any():
        guide_median = np.median(rgb[colour_sample].astype(np.int16), axis=0)
        base_median = np.median(face_base_rgba[colour_sample, :3].astype(np.int16), axis=0)
        delta = np.clip(guide_median - base_median, -24, 24)
        adjusted = np.clip(face_base_rgba[:, :, :3].astype(np.int16) + delta, 0, 255)
        face_base_rgba[:, :, :3] = adjusted.astype(np.uint8)
    face_base_rgba[face_base_rgba[:, :, 3] == 0, :3] = 0

    eye_l_poly = mask_polygon(size, [(446, 565), (475, 542), (526, 540), (579, 565), (548, 600), (480, 600)])
    eye_r_poly = mask_polygon(size, [(670, 565), (708, 540), (759, 542), (806, 565), (770, 600), (701, 600)])
    # Tight horizontal brow bands. V1's tall boxes captured the vertical side
    # bangs and produced two dark rectangular blocks when the brows moved.
    brow_l_poly = mask_polygon(size, [(478, 500), (560, 497), (565, 518), (476, 520)])
    brow_r_poly = mask_polygon(size, [(690, 497), (775, 500), (778, 520), (686, 518)])
    mouth_poly = mask_rect(size, (565, 688, 685, 735))
    nose_poly = mask_rect(size, (600, 620, 650, 682))
    earring_l_poly = mask_rect(size, (335, 650, 455, 875))
    earring_r_poly = mask_rect(size, (795, 650, 915, 875))
    ornament_poly = mask_polygon(size, [(400, 65), (850, 65), (855, 270), (395, 270)])

    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    luma = (r * 30 + g * 59 + b * 11) // 100
    dark = luma < 150
    very_dark = luma < 95
    green = (g > r + 8) & (g > b + 18)
    pale_white = (r > 185) & (g > 180) & (b > 170) & ((r - b) < 48)
    warm_line = (r > g + 12) & (r > b + 18) & (luma < 225)

    eye_l = eye_l_poly & subject
    eye_r = eye_r_poly & subject
    iris_l = eye_l & green
    iris_r = eye_r & green
    highlight_l = (
        eye_l & (r > 205) & (g > 210) & (b > 185)
        & mask_rect(size, (505, 545, 545, 578))
    )
    highlight_r = (
        eye_r & (r > 205) & (g > 210) & (b > 185)
        & mask_rect(size, (705, 545, 750, 578))
    )
    pupil_l = eye_l & very_dark & mask_rect(size, (500, 548, 548, 592))
    pupil_r = eye_r & very_dark & mask_rect(size, (705, 548, 753, 592))
    white_l = eye_l & pale_white & ~iris_l
    white_r = eye_r & pale_white & ~iris_r
    upper_l = eye_l & dark & mask_rect(size, (440, 535, 585, 580))
    upper_r = eye_r & dark & mask_rect(size, (665, 535, 812, 580))
    lower_l = eye_l & warm_line & mask_rect(size, (445, 575, 580, 610))
    lower_r = eye_r & warm_line & mask_rect(size, (670, 575, 807, 610))
    brow_l = brow_l_poly & dark & subject
    brow_r = brow_r_poly & dark & subject
    mouth = mouth_poly & warm_line & subject
    nose = nose_poly & warm_line & subject
    earring_l = earring_l_poly & subject & ~skin_region
    earring_r = earring_r_poly & subject & ~skin_region
    ornament = ornament_poly & subject & ~skin_region

    # Hair is the remaining head silhouette after face, features, earrings and
    # ornament. V1 stopped here, so every bang pixel inside skin_region was
    # wrongly deleted. Recover the visible face-overlapping bangs from compact
    # spatial lanes plus a brown/dark hair test; the lanes avoid the brows and
    # eyes while retaining the central and temple strands.
    reserved = (
        skin_region | eye_l_poly | eye_r_poly | brow_l_poly | brow_r_poly
        | mouth_poly | nose_poly | earring_l | earring_r | ornament
    )
    hair = subject & ~reserved
    hair_tone = (
        ((r > g + 3) & (g > b - 8) & (luma < 192))
        | (very_dark & (r >= b - 18))
    )
    bangs_region = (
        mask_polygon(size, [(395, 345), (855, 345), (820, 495), (430, 495)])
        | mask_polygon(size, [(535, 430), (715, 430), (700, 565), (550, 565)])
        | mask_polygon(size, [(395, 430), (485, 430), (475, 650), (405, 650)])
        | mask_polygon(size, [(765, 430), (855, 430), (845, 650), (775, 650)])
    )
    # Expand from detected brown strands just enough to recover their pale
    # specular streaks. Requiring luma < 210 keeps the adjacent skin out.
    hair_face_overlay = (
        subject & bangs_region
        & (hair_tone | (dilate(hair_tone, 11) & (luma < 210)))
    )
    hair |= hair_face_overlay
    front_region = (
        mask_polygon(size, [(345, 270), (905, 270), (900, 565), (815, 690), (435, 690), (350, 565)])
        | mask_polygon(size, [(280, 430), (480, 430), (490, 820), (300, 855)])
        | mask_polygon(size, [(770, 430), (970, 430), (950, 855), (760, 820)])
    )
    hair_front = hair & front_region
    hair_back = hair & ~hair_front

    masks = {
        "ArtHairBack": hair_back,
        "ArtFaceBase": face_base_rgba[:, :, 3] > 0,
        "ArtEyeWhiteL": dilate(white_l, 3),
        "ArtIrisL": dilate(iris_l, 3),
        "ArtPupilL": dilate(pupil_l, 3),
        "ArtHighlightL": highlight_l,
        "ArtUpperLidL": dilate(upper_l, 3),
        "ArtLowerLidL": dilate(lower_l, 3),
        "ArtEyeWhiteR": dilate(white_r, 3),
        "ArtIrisR": dilate(iris_r, 3),
        "ArtPupilR": dilate(pupil_r, 3),
        "ArtHighlightR": highlight_r,
        "ArtUpperLidR": dilate(upper_r, 3),
        "ArtLowerLidR": dilate(lower_r, 3),
        "ArtBrowL": dilate(brow_l, 3),
        "ArtBrowR": dilate(brow_r, 3),
        "ArtNose": dilate(nose, 3),
        "ArtMouthClosed": dilate(mouth, 3),
        "ArtEarringL": earring_l,
        "ArtEarringR": earring_r,
        "ArtHairFront": hair_front,
        "ArtHeadOrnament": ornament,
    }

    layers: list[tuple[str, Image.Image]] = []
    for name, mask in masks.items():
        if not mask.any():
            raise RuntimeError(f"empty guide-space mask: {name}")
        if name == "ArtFaceBase":
            image = Image.fromarray(face_base_rgba, "RGBA")
        else:
            image = layer_from_rgb(rgb, mask)
        layers.append((name, image))

    neutral = composite_layers(size, layers)
    reference_mask = subject & head_extent
    neutral_array = np.asarray(neutral, dtype=np.uint8)
    solid = reference_mask & (neutral_array[:, :, 3] > 0)
    if solid.any():
        difference = np.abs(neutral_array[:, :, :3].astype(np.int16) - rgb.astype(np.int16))
        mean_abs_error = float(difference[solid].mean())
        close_ratio = float((difference.max(axis=2)[solid] <= 24).mean())
    else:
        mean_abs_error = 255.0
        close_ratio = 0.0

    visible_magenta = (
        (neutral_array[:, :, 3] > 0)
        & (neutral_array[:, :, 0] > 145)
        & (neutral_array[:, :, 2] > 120)
        & (
            np.minimum(neutral_array[:, :, 0], neutral_array[:, :, 2]).astype(np.int16)
            - neutral_array[:, :, 1].astype(np.int16)
            > 18
        )
    )
    report = {
        "guide_subject_pixels": int(reference_mask.sum()),
        "neutral_visible_pixels": int((neutral_array[:, :, 3] > 0).sum()),
        "guide_overlap_pixels": int(solid.sum()),
        "guide_overlap_rgb_mean_abs_error": mean_abs_error,
        "guide_overlap_max_channel_le_24_ratio": close_ratio,
        "visible_magenta_pixels": int(visible_magenta.sum()),
        "recovered_face_overlap_hair_pixels": int(hair_face_overlay.sum()),
        "neck_fallback_pixels": int(neck_fallback.sum()),
        "ear_fallback_pixels": int(ear_fallback.sum()),
        "layer_pixels": {name: int(mask.sum()) for name, mask in masks.items()},
    }
    return layers, neutral, report


def build() -> dict[str, object]:
    required = [MASTER_PATH, GUIDE_PATH, FACE_BASE_CHROMA_PATH]
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(path)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    master_1x = cleaned_master(Image.open(MASTER_PATH).convert("RGBA"))
    canvas = (master_1x.width * CANVAS_SCALE, master_1x.height * CANVAS_SCALE)
    master = master_1x.resize(canvas, Image.Resampling.LANCZOS)
    master_array = np.asarray(master, dtype=np.uint8)
    visible = master_array[:, :, 3] > 0
    remaining = visible.copy()

    candidates: list[tuple[str, str, np.ndarray]] = [
        ("20_BODY", "ArtHandCuffL", rect_mask(canvas, (105, 570, 255, 750))),
        ("20_BODY", "ArtHandCuffR", rect_mask(canvas, (770, 570, 920, 750))),
        ("20_BODY", "ArtFootL", rect_mask(canvas, (350, 1390, 515, 1536))),
        ("20_BODY", "ArtFootR", rect_mask(canvas, (509, 1390, 680, 1536))),
        ("_REMOVE", "ArtHeadCombined", rect_mask(canvas, (330, 0, 695, 330))),
        (
            "30_DYNAMIC_GARMENT", "ArtSleeveL",
            polygon_mask(canvas, [(260, 330), (500, 370), (490, 680), (420, 850),
                                  (320, 1080), (185, 1075), (110, 865), (100, 610)]),
        ),
        (
            "30_DYNAMIC_GARMENT", "ArtSleeveR",
            polygon_mask(canvas, [(764, 330), (524, 370), (534, 680), (604, 850),
                                  (704, 1080), (839, 1075), (914, 865), (924, 610)]),
        ),
        ("20_BODY", "ArtTorsoWaist", rect_mask(canvas, (285, 285, 739, 720))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtL", rect_mask(canvas, (0, 500, 430, 1536))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtR", rect_mask(canvas, (594, 500, 1024, 1536))),
        ("30_DYNAMIC_GARMENT", "ArtSkirtC", rect_mask(canvas, (430, 500, 594, 1536))),
    ]

    body_layers: dict[str, list[tuple[str, Image.Image]]] = {
        "20_BODY": [],
        "30_DYNAMIC_GARMENT": [],
    }
    removed_head_pixels = 0
    manifest: list[dict[str, object]] = []
    for group, name, region in candidates:
        mask = remaining & region
        remaining &= ~mask
        if not mask.any():
            continue
        if group == "_REMOVE":
            removed_head_pixels += int(mask.sum())
            continue
        layer = rgba_for_mask(master_array, mask)
        body_layers[group].append((name, layer))
        manifest.append({"group": group, "name": name, "pixels": int(mask.sum())})
    if remaining.any():
        layer = rgba_for_mask(master_array, remaining)
        body_layers["20_BODY"].append(("ArtGarmentResidual", layer))
        manifest.append({"group": "20_BODY", "name": "ArtGarmentResidual", "pixels": int(remaining.sum())})
        remaining[:] = False

    guide_layers, guide_neutral, head_report = build_head_layers()
    model_head_layers = [
        (name, transform_guide_layer_to_model(image, canvas))
        for name, image in guide_layers
    ]
    model_head_neutral = composite_layers(canvas, model_head_layers)

    body_neutral = Image.new("RGBA", canvas, (0, 0, 0, 0))
    for group_name in ("20_BODY", "30_DYNAMIC_GARMENT"):
        for _, image in body_layers[group_name]:
            body_neutral.alpha_composite(image)
    authoritative = body_neutral.copy()
    authoritative.alpha_composite(model_head_neutral)
    authoritative.save(MASTER_OUTPUT_PATH, optimize=True)
    authoritative.save(PREVIEW_PATH, optimize=True)
    guide_neutral.save(HEAD_PREVIEW_PATH, optimize=True)

    for name, image in guide_layers:
        bounds = image.getchannel("A").getbbox()
        if bounds:
            image.crop(bounds).save(LAYERS_DIR / f"{name}.png", optimize=True)

    psd = PSDImage.new("RGB", canvas, color=(0, 0, 0), depth=8)
    guide_group = Group.new(psd, name="00_GUIDE_DO_NOT_RIG", open_folder=False)
    reference = add_layer(guide_group, "ReferenceMasterHeadProduction", authoritative)
    reference.visible = False
    guide_group.visible = False

    head_group = Group.new(psd, name="10_HEAD_PRODUCTION", open_folder=True)
    for name, image in model_head_layers:
        add_layer(head_group, name, image)

    for group_name in ("20_BODY", "30_DYNAMIC_GARMENT"):
        group = Group.new(psd, name=group_name, open_folder=True)
        for name, image in body_layers[group_name]:
            add_layer(group, name, image)

    underpaint = Group.new(psd, name="90_UNDERPAINT_TODO", open_folder=True)
    underpaint.visible = False
    psd.save(MODEL_PATH)

    report: dict[str, object] = {
        "schema": "bamboo-crane-maiden-v4-head-production/v2",
        "source_master": str(MASTER_PATH.relative_to(ROOT)).replace("\\", "/"),
        "head_guide": str(GUIDE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "face_base_candidate": str(FACE_BASE_CHROMA_PATH.relative_to(ROOT)).replace("\\", "/"),
        "canvas": list(canvas),
        "guide_to_model": {"scale": GUIDE_TO_MODEL_SCALE, "offset": list(GUIDE_TO_MODEL_OFFSET)},
        "removed_old_head_pixels": removed_head_pixels,
        "head_layer_count": len(model_head_layers),
        "body_layer_count": sum(len(v) for v in body_layers.values()),
        "head": head_report,
        "body_manifest": manifest,
        "psd": str(MODEL_PATH.relative_to(ROOT)).replace("\\", "/"),
        "psd_sha256": "",
        "authoritative_master": str(MASTER_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
        "authoritative_master_sha256": sha256(MASTER_OUTPUT_PATH),
        "preview": str(PREVIEW_PATH.relative_to(ROOT)).replace("\\", "/"),
        "quality_boundary": (
            "The high-resolution head is a production candidate. It separates face, eyes, brows, "
            "mouth, hair, ornament and earrings, but still requires visual approval, Cubism mesh "
            "generation and hand-edited blink/turn keyforms. Body joint underpaint is unchanged."
        ),
    }
    report["psd_sha256"] = sha256(MODEL_PATH)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2))
