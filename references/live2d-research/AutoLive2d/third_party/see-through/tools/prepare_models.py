from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "workspace" / "models"

MODELS = {
    "blockswap": [
        ("layerdifforg/seethroughv0.0.2_layerdiff3d", MODEL_ROOT / "layerdiff3d"),
        ("24yearsold/seethroughv0.0.1_marigold", MODEL_ROOT / "marigold"),
    ],
    "nf4": [
        ("24yearsold/seethroughv0.0.2_layerdiff3d_nf4", MODEL_ROOT / "layerdiff3d_nf4"),
        ("24yearsold/seethroughv0.0.1_marigold_nf4", MODEL_ROOT / "marigold_nf4"),
    ],
}


def copy_snapshot(snapshot: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(snapshot, target, dirs_exist_ok=True)


def prepare(kind: str, local_only: bool) -> None:
    selected = MODELS["blockswap"] + MODELS["nf4"] if kind == "all" else MODELS[kind]
    for repo_id, target in selected:
        print(f"\nPreparing {repo_id}")
        print(f"Target: {target}")
        snapshot = snapshot_download(repo_id, local_files_only=local_only)
        print(f"Snapshot: {snapshot}")
        copy_snapshot(Path(snapshot), target)
        print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download/copy See-through models into workspace/models.")
    parser.add_argument("--kind", choices=["blockswap", "nf4", "all"], default="all")
    parser.add_argument("--local-only", action="store_true", help="Only copy from existing HuggingFace cache.")
    args = parser.parse_args()
    prepare(args.kind, args.local_only)


if __name__ == "__main__":
    main()
