"""Convert a generated visual candidate with a baked checkerboard to real alpha.

This is deliberately a separate, non-destructive path from ``build_assets``:
candidate artwork must never overwrite the approved reference, existing runtime
master, or the current Cubism PSD before its likeness has been reviewed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from build_assets import connected_background  # noqa: E402


DEFAULT_INPUT = ROOT / "assets" / "source" / "candidates" / "identity-preserved-fullbody-v1.png"
DEFAULT_OUTPUT = ROOT / "assets" / "source" / "candidates" / "identity-preserved-fullbody-v1-alpha.png"


def convert(source: Path, output: Path) -> dict[str, object]:
    image = Image.open(source).convert("RGB")
    alpha = connected_background(np.asarray(image, dtype=np.uint8))
    rgba = Image.fromarray(np.dstack([np.asarray(image), alpha]), "RGBA")
    output.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(output, optimize=True)
    return {
        "source": str(source.relative_to(ROOT)),
        "output": str(output.relative_to(ROOT)),
        "size": list(image.size),
        "alphaCoverage": round(float((alpha > 16).mean()), 6),
        "transparentCoverage": round(float((alpha <= 16).mean()), 6),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source = args.input.resolve()
    output = args.output.resolve()
    if not source.is_file():
        raise SystemExit(f"candidate source not found: {source}")
    if output == source:
        raise SystemExit("refusing to overwrite the generated candidate")
    print(convert(source, output))


if __name__ == "__main__":
    main()
