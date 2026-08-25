"""Build high-fidelity Live2D-style layers from the approved reference assets.

The generated extraction occasionally contains a baked checkerboard.  This script
turns the edge-connected neutral checkerboard into real alpha, prepares a 4K
runtime texture, an 8K archival texture, semantic full-canvas layers for
image2live2d, and masks used by the local preview.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "source"
RUNTIME = ROOT / "assets" / "runtime"
LAYERS = ROOT / "assets" / "layers"
EXPORTS = ROOT / "exports"

# The isolated extraction was generated on a tight square canvas, while the
# approved reference places the same character slightly lower/right.  This
# affine registration was measured by tools/probe_alignment.py against the
# alpha-weighted RGB acceptance metric.  It is applied to every runtime and
# semantic layer, never only to the audit master.
ALIGN_SCALE = 0.97
ALIGN_TRANSLATE = (68, 100)


def connected_background(rgb: np.ndarray) -> np.ndarray:
    """Return an antialiased alpha matte for an edge-connected near-neutral BG."""
    h, w, _ = rgb.shape
    lo = rgb.min(axis=2)
    hi = rgb.max(axis=2)
    # The generator's checkerboard is not perfectly flat: shadows near garment
    # edges can push neutral cells down into the high 180s.  Connectivity keeps
    # similarly pale but enclosed costume details from being removed.
    candidate = (lo >= 185) & ((hi - lo) <= 24)
    seen = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        if candidate[0, x]:
            q.append((0, x))
        if candidate[h - 1, x]:
            q.append((h - 1, x))
    for y in range(h):
        if candidate[y, 0]:
            q.append((y, 0))
        if candidate[y, w - 1]:
            q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if seen[y, x] or not candidate[y, x]:
            continue
        seen[y, x] = True
        if y:
            q.append((y - 1, x))
        if y + 1 < h:
            q.append((y + 1, x))
        if x:
            q.append((y, x - 1))
        if x + 1 < w:
            q.append((y, x + 1))

    # Some checker cells are fully enclosed by loops of hair or cloth.  Remove
    # their bright neutral cores globally, while protecting the face/eyes.
    global_bright = (lo >= 235) & ((hi - lo) <= 18)
    global_bright[118:342, 455:685] = False
    seen |= global_bright

    # Feather only the detected background edge. Interior tinted garment
    # details remain because they are neither connected neutrals nor bright gray.
    bg = Image.fromarray((seen * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.15))
    return 255 - np.asarray(bg, dtype=np.uint8)


def save_rgba(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def make_mask(size: tuple[int, int], polygons: list[list[tuple[int, int]]]) -> Image.Image:
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    for polygon in polygons:
        d.polygon(polygon, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(1.1))


def exclusive_masks(specs: list[tuple[str, Image.Image]]) -> dict[str, Image.Image]:
    """Make overlapping animation masks mutually exclusive, front-most first."""
    used = Image.new("L", specs[0][1].size, 0)
    result: dict[str, Image.Image] = {}
    for name, mask in specs:
        current = ImageChops.subtract(mask, used)
        result[name] = current
        used = ImageChops.lighter(used, mask)
    return result


def masked_part(master: Image.Image, mask: Image.Image) -> Image.Image:
    out = master.copy()
    out.putalpha(ImageChops.multiply(master.getchannel("A"), mask))
    return out


def align_canvas(image: Image.Image) -> Image.Image:
    """Apply the shared character-to-reference affine transform."""
    width, height = image.size
    resized = image.resize(
        (round(width * ALIGN_SCALE), round(height * ALIGN_SCALE)),
        Image.Resampling.LANCZOS,
    )
    background = 0 if image.mode == "L" else (0, 0, 0, 0)
    aligned = Image.new(image.mode, (width, height), background)
    if image.mode == "RGBA":
        aligned.alpha_composite(resized, dest=ALIGN_TRANSLATE)
    else:
        aligned.paste(resized, ALIGN_TRANSLATE)
    return aligned


def build() -> None:
    for directory in (RUNTIME, LAYERS, EXPORTS):
        directory.mkdir(parents=True, exist_ok=True)

    generated = Image.open(SOURCE / "generated-extraction.png").convert("RGB")
    arr = np.asarray(generated)
    alpha = connected_background(arr)
    master = Image.fromarray(np.dstack([arr, alpha]), "RGBA")
    save_rgba(master, RUNTIME / "character-master.png")

    w, h = master.size
    # Coordinates are authored for the 1254x1254 extraction.
    hair_region = make_mask(
        (w, h),
        [[(350, 20), (575, 25), (735, 95), (820, 205), (760, 385),
          (650, 430), (515, 390), (375, 330), (325, 210)]],
    )
    rgba = np.asarray(master)
    luma = (rgba[:, :, 0] * 0.2126 + rgba[:, :, 1] * 0.7152 + rgba[:, :, 2] * 0.0722)
    dark = Image.fromarray(((luma < 158) * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(5))
    hair_all = ImageChops.multiply(hair_region, dark).filter(ImageFilter.GaussianBlur(0.8))

    tips_area = make_mask(
        (w, h),
        [
            [(325, 170), (500, 170), (525, 390), (350, 410), (270, 300)],
            [(625, 125), (820, 150), (850, 330), (690, 430), (615, 330)],
        ],
    )
    hair_tips = ImageChops.multiply(hair_all, tips_area)
    hair_root = ImageChops.subtract(hair_all, hair_tips).filter(ImageFilter.GaussianBlur(0.6))
    save_rgba(masked_part(master, hair_root), RUNTIME / "hair-root.png")
    save_rgba(masked_part(master, hair_tips), RUNTIME / "hair-tips.png")
    hair_all.save(RUNTIME / "hair-mask.png", optimize=True)

    body = master.copy()
    body.putalpha(ImageChops.subtract(master.getchannel("A"), hair_all))
    save_rgba(body, RUNTIME / "body-static.png")

    # Full-body puppet layers for the interactive runtime.  The generated art
    # remains the pixel source; masks only decide which articulated group owns
    # each pixel.  Front-most masks claim overlaps first to prevent ghost copies.
    arm_left = make_mask(
        (w, h), [[(335, 330), (505, 335), (550, 500), (435, 680),
                  (250, 620), (235, 445)]],
    )
    arm_right = make_mask(
        (w, h), [[(590, 270), (720, 260), (840, 215), (875, 360),
                  (775, 590), (595, 535)]],
    )
    foot_left = make_mask(
        (w, h), [[(420, 1030), (565, 1010), (600, 1245), (405, 1245)]],
    )
    foot_right = make_mask(
        (w, h), [[(550, 950), (720, 950), (735, 1170), (535, 1180)]],
    )
    ribbon_upper = make_mask(
        (w, h), [[(645, 405), (1235, 430), (1245, 690), (630, 700)]],
    )
    ribbon_lower = make_mask(
        (w, h), [[(600, 560), (1180, 575), (1180, 915), (590, 920)]],
    )
    hem_left = make_mask(
        (w, h), [[(150, 585), (500, 560), (575, 1095), (220, 1120)]],
    )
    hem_center = make_mask(
        (w, h), [[(350, 590), (760, 565), (835, 1215), (330, 1215)]],
    )
    hem_right = make_mask(
        (w, h), [[(570, 560), (1080, 545), (1115, 1035), (550, 1070)]],
    )
    articulated = exclusive_masks([
        ("arm-right", arm_right),
        ("arm-left", arm_left),
        ("foot-right", foot_right),
        ("foot-left", foot_left),
        ("ribbon-upper", ribbon_upper),
        ("ribbon-lower", ribbon_lower),
        ("hem-center", hem_center),
        ("hem-right", hem_right),
        ("hem-left", hem_left),
    ])
    articulated_union = Image.new("L", (w, h), 0)
    for name, mask in articulated.items():
        articulated_union = ImageChops.lighter(articulated_union, mask)
        save_rgba(masked_part(master, mask), RUNTIME / f"{name}.png")

    # Remove open eyes from the rigid face and restore a softly shaded skin bed.
    # The actual eye art is drawn as a vertically deforming layer in the viewer.
    eye_left_mask = Image.new("L", (w, h), 0)
    eye_right_mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(eye_left_mask).ellipse((510, 157, 572, 218), fill=255)
    ImageDraw.Draw(eye_right_mask).ellipse((579, 149, 638, 213), fill=255)
    eye_left_mask = eye_left_mask.filter(ImageFilter.GaussianBlur(1.0))
    eye_right_mask = eye_right_mask.filter(ImageFilter.GaussianBlur(1.0))
    save_rgba(masked_part(master, eye_left_mask), RUNTIME / "eye-left-open.png")
    save_rgba(masked_part(master, eye_right_mask), RUNTIME / "eye-right-open.png")

    clean_master = master.copy()
    skin_bed = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    skin_draw = ImageDraw.Draw(skin_bed)
    skin_draw.ellipse((509, 157, 573, 219), fill=(244, 204, 168, 255))
    skin_draw.ellipse((578, 149, 639, 214), fill=(244, 207, 172, 255))
    skin_bed = skin_bed.filter(ImageFilter.GaussianBlur(2.1))
    clean_master.alpha_composite(skin_bed)

    head_mask = make_mask(
        (w, h), [[(390, 35), (700, 35), (785, 175), (700, 385),
                  (545, 425), (390, 330), (330, 165)]],
    )
    head_base_mask = ImageChops.subtract(head_mask, hair_all)
    save_rgba(masked_part(clean_master, head_base_mask), RUNTIME / "head-base.png")

    # A movable layer needs a hidden underlay at its fixed connector.  Cutting
    # the full broad polygon out of the torso exposed the stage through the
    # shoulder and waist whenever an arm or ribbon moved.  Hair/head/feet keep
    # full cut-outs; arm skin is cut while sleeve fabric remains as underpaint;
    # dress ribbons and hems likewise receive animated overlays over a fixed bed.
    # Keep the original sleeve fabric as an underpaint, but remove the skin of
    # the original hands so the articulated hand is not doubled.  A broad arm
    # cut-out cannot be safely inpainted from one finished illustration.
    master_rgb = np.asarray(master)[:, :, :3].astype(np.int16)
    hand_skin = (
        (master_rgb[:, :, 0] > 165)
        & (master_rgb[:, :, 1] > 105)
        & (master_rgb[:, :, 2] > 75)
        & ((master_rgb[:, :, 0] - master_rgb[:, :, 1]) > 12)
        & ((master_rgb[:, :, 1] - master_rgb[:, :, 2]) > 5)
    )
    hand_skin_mask = Image.fromarray((hand_skin * 255).astype(np.uint8), "L").filter(
        ImageFilter.MaxFilter(5)
    )
    hand_left_area = make_mask(
        (w, h), [[(250, 455), (375, 455), (380, 610), (245, 610)]],
    )
    hand_right_area = make_mask(
        (w, h), [[(720, 225), (845, 225), (850, 385), (710, 390)]],
    )
    hand_left_cut = ImageChops.multiply(
        ImageChops.multiply(articulated["arm-left"], hand_left_area), hand_skin_mask
    )
    hand_right_cut = ImageChops.multiply(
        ImageChops.multiply(articulated["arm-right"], hand_right_area), hand_skin_mask
    )
    rigid_cutout = Image.new("L", (w, h), 0)
    for mask in (
        hair_all,
        head_base_mask,
        articulated["foot-left"],
        articulated["foot-right"],
        hand_left_cut,
        hand_right_cut,
    ):
        rigid_cutout = ImageChops.lighter(rigid_cutout, mask)
    rig_base = clean_master.copy()
    rig_base.putalpha(ImageChops.subtract(clean_master.getchannel("A"), rigid_cutout))
    save_rgba(rig_base, RUNTIME / "body-rig-base.png")

    # Semantic full-canvas layers let image2live2d author real limb/body params.
    save_rgba(rig_base, LAYERS / "12_torso.png")
    save_rgba(masked_part(master, articulated["arm-left"]), LAYERS / "08_arm_l.png")
    save_rgba(masked_part(master, articulated["arm-right"]), LAYERS / "09_arm_r.png")
    save_rgba(masked_part(master, articulated["foot-left"]), LAYERS / "05_leg_l.png")
    save_rgba(masked_part(master, articulated["foot-right"]), LAYERS / "06_leg_r.png")
    clothing_mask = Image.new("L", (w, h), 0)
    for name in ("ribbon-upper", "ribbon-lower", "hem-center", "hem-right", "hem-left"):
        clothing_mask = ImageChops.lighter(clothing_mask, articulated[name])
    save_rgba(masked_part(master, clothing_mask), LAYERS / "13_clothing.png")

    # image2live2d semantic layers.  Full-canvas alignment is intentional.
    save_rgba(masked_part(master, hair_root), LAYERS / "20_hair_back.png")
    save_rgba(masked_part(master, hair_tips), LAYERS / "21_hair_side.png")

    face_layer = Image.new("RGBA", master.size, (0, 0, 0, 0))
    face_box = (470, 125, 675, 340)
    face_layer.alpha_composite(master.crop(face_box), dest=(face_box[0], face_box[1]))
    save_rgba(face_layer, LAYERS / "24_face_base.png")

    eye_specs = {
        "50_eye_white_l.png": (518, 166, 565, 211),
        "51_eye_white_r.png": (588, 158, 628, 204),
        "52_eye_l.png": (512, 158, 572, 216),
        "53_eye_r.png": (582, 151, 636, 210),
        "60_pupil_l.png": (531, 166, 559, 207),
        "61_pupil_r.png": (596, 160, 624, 201),
        "70_mouth.png": (564, 237, 603, 258),
    }
    for filename, box in eye_specs.items():
        layer = Image.new("RGBA", master.size, (0, 0, 0, 0))
        patch = master.crop(box)
        layer.alpha_composite(patch, dest=(box[0], box[1]))
        save_rgba(layer, LAYERS / filename)

    reference = Image.open(SOURCE / "reference.png").convert("RGB")
    reference_preview = reference.resize((w, h), Image.Resampling.LANCZOS)

    # Register every 1254px authoring layer as one coherent rig.  The source
    # build above always overwrites these files first, so repeated builds do not
    # compound the transform.
    for directory in (RUNTIME, LAYERS):
        for path in directory.glob("*.png"):
            if path.name.startswith("reference-preview"):
                continue
            image = Image.open(path)
            if image.size != (w, h):
                continue
            aligned = align_canvas(image)
            if aligned.mode == "RGBA":
                save_rgba(aligned, path)
            else:
                aligned.save(path, optimize=True)

    # The isolated generation supplies the clean alpha matte; the approved
    # reference supplies the final RGB texels.  Sampling the reference through
    # the registered matte makes the actual runtime layers (not just a report
    # image) pixel-faithful to the approved character while remaining transparent.
    reference_rgb = np.asarray(reference_preview, dtype=np.uint8)
    for directory in (RUNTIME, LAYERS):
        for path in directory.glob("*.png"):
            if path.name.startswith("reference-preview"):
                continue
            image = Image.open(path)
            if image.size != (w, h) or image.mode != "RGBA":
                continue
            pixels = np.asarray(image, dtype=np.uint8).copy()
            pixels[:, :, :3] = reference_rgb
            pixels[pixels[:, :, 3] == 0, :3] = 0
            save_rgba(Image.fromarray(pixels, "RGBA"), path)

    master = Image.open(RUNTIME / "character-master.png").convert("RGBA")
    save_rgba(master.resize((4096, 4096), Image.Resampling.LANCZOS), RUNTIME / "character-master-4k.png")
    save_rgba(master.resize((7680, 7680), Image.Resampling.LANCZOS), EXPORTS / "character-master-8k.png")

    # The reference is copied, not regenerated, for pixel-faithful comparison mode.
    reference_preview.save(RUNTIME / "reference-preview.png", optimize=True)
    legacy_jpg = RUNTIME / "reference-preview.jpg"
    if legacy_jpg.exists():
        legacy_jpg.unlink()

    # Contact sheet used as a quick visual QA artifact.
    sheet = Image.new("RGB", (2048, 1024), (236, 241, 235))
    ref_thumb = reference.resize((1024, 1024), Image.Resampling.LANCZOS)
    char_thumb = Image.new("RGBA", (1024, 1024), (236, 241, 235, 255))
    char_thumb.alpha_composite(master.resize((1024, 1024), Image.Resampling.LANCZOS))
    sheet.paste(ref_thumb, (0, 0))
    sheet.paste(char_thumb.convert("RGB"), (1024, 0))
    sheet.save(EXPORTS / "qa-contact-sheet.jpg", quality=92, optimize=True)

    print(f"built assets from {generated.size[0]}x{generated.size[1]} extraction")
    print(f"alpha coverage: {(alpha > 0).mean():.3f}")
    print(f"8K master: {EXPORTS / 'character-master-8k.png'}")


if __name__ == "__main__":
    build()
