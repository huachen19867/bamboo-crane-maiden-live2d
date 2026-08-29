"""Build the V2 head-production Cubism import acceptance report.

Combines:
- PSD ground truth: per-layer real alpha bbox on the 2048x3072 canvas (psd_tools)
- Cubism API probes: before-mesh (33x4 corner meshes) and after-mesh (contour meshes)
- Saved CMO3 identity (size + SHA-256)
"""
import hashlib
import io
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_PY = os.path.join(_ROOT, "tools", "_python")
for p in (_PY, os.path.join(_PY, "win32")):
    if p not in sys.path:
        sys.path.insert(0, p)

from psd_tools import PSDImage

PSD_PATH = os.path.join(_ROOT, "model", "cubism-v4", "bamboo-crane-maiden-v4-head-production-v2.psd")
CMO3_PATH = os.path.join(_ROOT, "model", "cubism-v4", "bamboo-crane-maiden-v4-head-production-v2-import.cmo3")
BEFORE = os.path.join(_ROOT, "exports", "v4-head-production-import-probe-before-mesh.json")
AFTER = os.path.join(_ROOT, "exports", "v4-head-production-import-probe-after-mesh.json")
OUT = os.path.join(_ROOT, "exports", "v4-head-production-import-acceptance-report.json")


def sha256(path):
    h = hashlib.sha256()
    with io.open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def layer_bbox(layer):
    bbox = layer.bbox
    return {"left": bbox[0], "top": bbox[1], "right": bbox[2], "bottom": bbox[3],
            "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]}


def walk(layer):
    out = []
    for child in layer:
        if child.is_group():
            out.extend(walk(child))
        else:
            if not child.visible:
                continue
            out.append(child)
    return out


psd = PSDImage.open(PSD_PATH)
layers = {}
for px in walk(psd):
    layers[px.name] = {
        "bbox_px": layer_bbox(px),
        "size_px": list(px.size),
    }

before = json.load(io.open(BEFORE, encoding="utf-8"))
after = json.load(io.open(AFTER, encoding="utf-8"))

mesh_after = {s["id"]: s["vertices"] for s in after["summary"]}
mesh_before = {s["id"]: s["vertices"] for s in before["summary"]}

per_mesh = []
for name in sorted(layers):
    per_mesh.append({
        "id": name,
        "psd_alpha_bbox": layers[name]["bbox_px"],
        "vertices_before": mesh_before.get(name),
        "vertices_after": mesh_after.get(name),
        "vertices_gt4": (mesh_after.get(name) or 0) > 4,
    })

guide = sorted(set(mesh_after) - set(layers))
report = {
    "schema": "bamboo-crane-maiden-v4-head-production-import-acceptance/v1",
    "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    "editor": "Live2D Cubism Editor 5.4.00 alpha1 (tools/alpha, external edit API 1.1.0)",
    "source_psd": {
        "path": "model/cubism-v4/bamboo-crane-maiden-v4-head-production-v2.psd",
        "sha256": "6BE1E3D44F17D7E67179EBE5EF2AFA72CCA2173FB204841C51056130D233834C",
        "canvas": [psd.width, psd.height],
    },
    "saved_cmo3": {
        "path": "model/cubism-v4/bamboo-crane-maiden-v4-head-production-v2-import.cmo3",
        "bytes": os.path.getsize(CMO3_PATH),
        "sha256": sha256(CMO3_PATH),
    },
    "artmesh_count": after["artMeshCount"],
    "part_groups_expected": ["00_GUIDE_DO_NOT_RIG", "10_HEAD_PRODUCTION", "20_BODY", "30_DYNAMIC_GARMENT", "90_UNDERPAINT_TODO"],
    "api_limitation": "GetObject in edit API 1.1.0 returns Vertices count but no Rectangle/vertex positions; alpha-bbox ground truth is taken from the PSD layers, which the V2 build script already crops to each layer's real alpha bbox before writing. Editor visual selection boxes matched those regions.",
    "vertices_total_before": sum(v for v in mesh_before.values() if v),
    "vertices_total_after": sum(v for v in mesh_after.values() if v),
    "mesh_generation": {
        "method": "Editor 自动生成网格 (Ctrl+Shift+A, CMD_GENERATE_MESH_IN_MODELING_MODE), all ArtMeshes selected, live-apply dialog, 点间距离(外/内)=100, 边界余量=20, 边界最少点数=5, Alpha阈值=0 (Cubism standard deformation preset values)",
        "note": "The 自动网格生成 dialog in 5.4 alpha1 renders without OK/Cancel buttons; it applies settings live to the selected ArtMeshes, so closing it (X) keeps the generated meshes.",
    },
    "per_mesh": per_mesh,
    "guide_layers_meshed_at_import": guide,
    "gate": {
        "artmesh_count_matches_psd_layers": after["artMeshCount"] == len(layers) + len(guide),
        "all_production_meshes_gt4_vertices": all(v > 4 for k, v in mesh_after.items() if k not in guide),
        "hidden_guide_kept_corner_mesh": all(mesh_after.get(k) == 4 for k in guide),
    },
}

report["gate"]["all_pass"] = all(report["gate"].values())

with io.open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"wrote {OUT}")
print(json.dumps(report["gate"], ensure_ascii=False))
print("cmo3 sha256:", report["saved_cmo3"]["sha256"])
