"""Create the portable delivery archive without temporary directory moves."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "exports" / "bamboo-crane-maiden-live2d-delivery.zip"


def add_tree(files: list[tuple[Path, Path]], source: Path, archive_root: Path) -> None:
    for path in sorted(source.rglob("*")):
        if path.is_file() and path != OUTPUT:
            files.append((path, archive_root / path.relative_to(source)))


def main() -> None:
    files: list[tuple[Path, Path]] = []
    for name in ("README.md", "Start-Preview.ps1", "Build-All.ps1"):
        files.append((ROOT / name, Path(name)))
    for name in ("assets", "model", "viewer", "tools", "docs", "exports"):
        add_tree(files, ROOT / name, Path(name))
    upstream = ROOT / "image2live2d-upstream"
    add_tree(files, upstream / "src", Path("image2live2d-upstream") / "src")
    for name in ("pyproject.toml", "LICENSE"):
        files.append((upstream / name, Path("image2live2d-upstream") / name))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9, allowZip64=True) as zf:
        for source, archive_name in files:
            if not source.is_file():
                raise FileNotFoundError(source)
            zf.write(source, archive_name.as_posix())

    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    report = {
        "file": str(OUTPUT.relative_to(ROOT)),
        "bytes": OUTPUT.stat().st_size,
        "sha256": digest,
        "entries": len(files),
    }
    (ROOT / "exports" / "delivery-package.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
