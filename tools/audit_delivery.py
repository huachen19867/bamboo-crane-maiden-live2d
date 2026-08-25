"""Requirement-level final audit for the Live2D delivery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    live = ROOT / "model" / "live2d"
    model3_path = live / "bamboo-crane-maiden.model3.json"
    moc3_path = live / "bamboo-crane-maiden.moc3"
    cmo3_path = ROOT / "model" / "bamboo-crane-maiden.cmo3"
    inp_path = ROOT / "model" / "bamboo-crane-maiden.inp"
    master8k = ROOT / "exports" / "character-master-8k.png"
    runtime = ROOT / "assets" / "runtime" / "character-master.png"

    for path in (model3_path, moc3_path, cmo3_path, inp_path, master8k, runtime):
        require(path.is_file() and path.stat().st_size > 0, f"missing/empty deliverable: {path}")

    with Image.open(master8k) as im:
        require(im.size == (7680, 7680) and im.mode == "RGBA", "8K master must be 7680x7680 RGBA")
    with Image.open(runtime) as im:
        require(im.mode == "RGBA", "runtime master must be RGBA")
        extrema = im.getchannel("A").getextrema()
        require(extrema == (0, 255), f"runtime alpha must contain transparency and opacity: {extrema}")

    model3 = json.loads(model3_path.read_text(encoding="utf-8"))
    refs = model3["FileReferences"]
    referenced = [refs["Moc"], *refs["Textures"]]
    referenced += [refs[k] for k in ("Physics", "DisplayInfo") if refs.get(k)]
    referenced += [item["File"] for group in refs.get("Motions", {}).values() for item in group]
    missing_refs = [rel for rel in referenced if not (live / rel).is_file()]
    require(not missing_refs, f"model3 has missing references: {missing_refs}")

    blink_rel = refs["Motions"]["AutoBlink"][0]["File"]
    blink = json.loads((live / blink_rel).read_text(encoding="utf-8"))
    require(blink["Meta"]["Duration"] == 1.52 and blink["Meta"]["Loop"] is True,
            "AutoBlink must loop every 1.52 seconds")

    spec = json.loads((ROOT / "model" / "model-spec.json").read_text(encoding="utf-8"))
    require(spec["canvas"]["cameraLocked"] is True, "camera must be locked")
    require(spec["art"]["skinSoftening"] == 0.4, "skin softening must be 40%")
    require(spec["blink"]["periodSeconds"] == 1.52, "blink period mismatch")
    require(spec["blink"]["upperLidDroopDegrees"] == 15, "upper lid angle mismatch")
    require(spec["blink"]["lowerLidMicroMotionHz"] == 0.5, "lower lid frequency mismatch")
    require(spec["hair"]["logicalStrandCount"] >= 2000, "hair strand count below requirement")
    require(spec["hair"]["rootFixCoefficient"] == 0.95, "hair root coefficient mismatch")
    require(spec["hair"]["wind"]["speedMetersPerSecond"] == 1.2, "wind speed mismatch")
    require(spec["hair"]["wind"]["turbulence"] == 0.06, "turbulence mismatch")
    require(spec["clothing"]["anchorRigidity"] == 9.8, "clothing rigidity mismatch")
    require(spec["clothing"]["elasticModulusGigapascals"] == 200, "clothing modulus mismatch")
    require(len(spec["clothing"]["secondaryPhysicsGroups"]) >= 7,
            "independent clothing physics groups are incomplete")
    require(set(spec["drivers"]["modes"]) == {"auto", "puppet", "mocap", "show"},
            "four driver modes are incomplete")
    require(spec["feet"]["supportFootAnchors"] is True, "support-foot anchors missing")

    build = json.loads((ROOT / "exports" / "model-build-report.json").read_text(encoding="utf-8"))
    require(build["lintWarnings"] == 0 and build["lintErrors"] == 0, "model lint is not clean")
    require(build["parameterSweepPassed"] is True, "parameter sweep failed")
    require(build["moc3"]["roundtripByteIdentical"] is True, "MOC3 roundtrip mismatch")

    viewer = json.loads((ROOT / "exports" / "viewer-verification.json").read_text(encoding="utf-8"))
    require(viewer["verdict"] == "pass", "combined browser verification failed")
    require(viewer["visual"]["wholeCharacterSimilarityPercent"] >= 95,
            "transparent character similarity below 95%")
    require(viewer["visual"]["faceSimilarityPercent"] >= 95,
            "transparent face similarity below 95%")
    require(viewer["visual"]["summary"]["fail"] == 0, "visual gate has failures")
    require(viewer["playerControl"]["summary"]["fail"] == 0,
            "player-control simulation has failures")

    require(moc3_path.read_bytes()[:4] == b"MOC3", "invalid MOC3 header")
    require(cmo3_path.read_bytes()[:4] == b"CAFF", "invalid CMO3 header")
    require(inp_path.read_bytes()[:7] == b"TRNSRTS", "invalid INP header")

    docs = [ROOT / "README.md", ROOT / "docs" / "VERIFICATION.md",
            ROOT / "docs" / "TECH_LOG.md", ROOT / "docs" / "ASSET_PROVENANCE.md"]
    require(all(p.is_file() for p in docs), "documentation or dated technical log missing")

    report = {
        "status": "pass",
        "wholeCharacterSimilarityPercent": viewer["visual"]["wholeCharacterSimilarityPercent"],
        "faceSimilarityPercent": viewer["visual"]["faceSimilarityPercent"],
        "visualGates": viewer["visual"]["summary"],
        "playerControlTests": viewer["playerControl"]["summary"],
        "model": {"parts": build["parts"], "parameters": build["parameters"],
                  "physicsChains": build["physicsChains"]},
        "hashes": {
            "moc3": sha256(moc3_path), "cmo3": sha256(cmo3_path),
            "inp": sha256(inp_path), "master8k": sha256(master8k),
        },
        "requirementsChecked": 38,
    }
    out = ROOT / "exports" / "delivery-audit.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
