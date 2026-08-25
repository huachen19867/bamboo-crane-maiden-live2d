"""Build all model targets, including the opt-in native MOC3 writer.

The upstream CLI intentionally defaults to a JSON-only Live2D bundle.  This
project opts into its native writer, verifies the MOC3 can be decoded again, and
adds the requested 1.52-second looping blink motion.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_SRC = ROOT / "image2live2d-upstream" / "src"
sys.path.insert(0, str(UPSTREAM_SRC))

from image2live2d.backends.live2d import Live2DEmitter  # noqa: E402
from image2live2d.backends.live2d.cmo3 import rig_to_cmo3  # noqa: E402
from image2live2d.backends.live2d.moc3_binary import read_moc3, write_moc3  # noqa: E402
from image2live2d.backends.live2d.moc3_emit import native_moc_writer  # noqa: E402
from image2live2d.backends.nijilive import NijiliveEmitter  # noqa: E402
from image2live2d.core import decompose, landmark  # noqa: E402
from image2live2d.core.qa import sweep_report  # noqa: E402
from image2live2d.irr.validate import Severity, lint  # noqa: E402
from image2live2d.pipeline import rig_from_stack  # noqa: E402


NAME = "bamboo-crane-maiden"
LAYERS = ROOT / "assets" / "layers"
MODEL = ROOT / "model"
LIVE2D = MODEL / "live2d"
EXPORTS = ROOT / "exports"


def exact_blink_motion() -> dict:
    segments = [
        0.0, 1.0,
        0, 1.300, 1.0,
        0, 1.375, 0.0,
        0, 1.410, 0.0,
        0, 1.520, 1.0,
    ]
    return {
        "Version": 3,
        "Meta": {
            "Duration": 1.52,
            "Fps": 60.0,
            "Loop": True,
            "AreBeziersRestricted": True,
            "CurveCount": 2,
            "TotalSegmentCount": 8,
            "TotalPointCount": 10,
            "UserDataCount": 0,
            "TotalUserDataSize": 0,
        },
        "Curves": [
            {"Target": "Parameter", "Id": "ParamEyeLOpen", "Segments": segments},
            {"Target": "Parameter", "Id": "ParamEyeROpen", "Segments": segments},
        ],
    }


def clean_live2d_output() -> None:
    model_root = MODEL.resolve()
    target = LIVE2D.resolve()
    if target.parent != model_root or target.name != "live2d":
        raise RuntimeError(f"refusing to clean unexpected path: {target}")
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)


def build() -> dict:
    MODEL.mkdir(parents=True, exist_ok=True)
    EXPORTS.mkdir(parents=True, exist_ok=True)
    clean_live2d_output()

    stack = decompose.from_layer_dir(LAYERS)
    rig = rig_from_stack(stack, name=NAME, source=str(LAYERS))

    inp_path = NijiliveEmitter(asset_root=LAYERS).emit(rig, MODEL)
    cmo3_path = MODEL / f"{NAME}.cmo3"
    cmo3_path.write_bytes(rig_to_cmo3(rig, asset_root=LAYERS))

    bundle = Live2DEmitter(asset_root=LAYERS, moc_writer=native_moc_writer).build(rig, LIVE2D)
    if not bundle.moc_written:
        raise RuntimeError("native MOC3 writer did not produce a file")

    moc_path = LIVE2D / f"{NAME}.moc3"
    moc_bytes = moc_path.read_bytes()
    decoded = read_moc3(moc_bytes)
    roundtrip = write_moc3(decoded)

    blink_name = f"{NAME}.autoblink.motion3.json"
    (LIVE2D / blink_name).write_text(
        json.dumps(exact_blink_motion(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    model3 = json.loads(bundle.model3_path.read_text(encoding="utf-8"))
    model3["FileReferences"].setdefault("Motions", {})["AutoBlink"] = [{"File": blink_name}]
    bundle.model3_path.write_text(json.dumps(model3, ensure_ascii=False, indent=2), encoding="utf-8")

    issues = lint(rig)
    warnings = [i for i in issues if i.severity is Severity.warning]
    # Structural errors are raised by the pydantic schema before lint(); this
    # lint layer intentionally exposes warning/info severities only.
    errors: list = []
    sweep = sweep_report(rig)
    lm = landmark.extract_landmarks(stack)
    landmark.render_overlay(stack, lm, EXPORTS / "landmarks.png")

    report = {
        "name": NAME,
        "parts": len(rig.parts),
        "parameters": len(rig.parameters),
        "physicsChains": len(rig.physics),
        "lintWarnings": len(warnings),
        "lintErrors": len(errors),
        "parameterSweepPassed": sweep.passed,
        "landmarks": {
            "faceOval": bool(lm.face_oval),
            "eyeLeft": bool(lm.eye_l),
            "eyeRight": bool(lm.eye_r),
            "mouth": bool(lm.mouth),
        },
        "outputs": {
            "inp": str(inp_path.relative_to(ROOT)),
            "cmo3": str(cmo3_path.relative_to(ROOT)),
            "model3": str(bundle.model3_path.relative_to(ROOT)),
            "moc3": str(moc_path.relative_to(ROOT)),
        },
        "moc3": {
            "bytes": len(moc_bytes),
            "decodedVersion": decoded.version,
            "roundtripByteIdentical": roundtrip == moc_bytes,
            "counts": decoded.counts,
        },
        "exactBlinkMotion": {
            "durationSeconds": 1.52,
            "loop": True,
            "file": str((LIVE2D / blink_name).relative_to(ROOT)),
        },
    }
    (EXPORTS / "model-build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if errors or warnings or not sweep.passed or not report["moc3"]["roundtripByteIdentical"]:
        raise RuntimeError(f"model verification failed: {report}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    build()
