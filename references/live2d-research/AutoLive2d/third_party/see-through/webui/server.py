from __future__ import annotations

import cgi
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = Path(__file__).resolve().parent / "static"
RUN_ROOT = ROOT / "workspace" / "web_jobs"
PSD_VIEW_ROOT = ROOT / "workspace" / "psd_views"
PREPROCESS_ROOT = ROOT / "workspace" / "preprocess"
MODEL_ROOT = ROOT / "workspace" / "models"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
QUANTIZED_SCRIPT = ROOT / "inference" / "scripts" / "inference_psd_quantized.py"
BLOCKSWAP_SCRIPT = ROOT / "inference" / "scripts" / "inference_psd_blockswap.py"

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()

LOCAL_MODELS = {
    "blockswap": {
        "layerdiff": MODEL_ROOT / "layerdiff3d",
        "depth": MODEL_ROOT / "marigold",
    },
    "bf16": {
        "layerdiff": MODEL_ROOT / "layerdiff3d",
        "depth": MODEL_ROOT / "marigold",
    },
    "nf4": {
        "layerdiff": MODEL_ROOT / "layerdiff3d_nf4",
        "depth": MODEL_ROOT / "marigold_nf4",
    },
}


def local_model_path(engine: str, key: str) -> str | None:
    path = LOCAL_MODELS.get(engine, {}).get(key)
    if not path or not path.exists():
        return None
    if not (path / "model_index.json").exists():
        return None
    return str(path)

LAYER_ORDER = [
    "tail",
    "wings",
    "back hair",
    "footwear",
    "legwear",
    "bottomwear",
    "neck",
    "topwear",
    "neckwear",
    "handwear",
    "objects",
    "ears",
    "head",
    "face",
    "nose",
    "mouth",
    "eyewhite",
    "irides",
    "eyebrow",
    "eyelash",
    "eyewear",
    "earwear",
    "headwear",
    "front hair",
]

DEFAULT_PREPROCESS_STAGES = [
    {"key": "load", "label": "图像读取", "percent": 100},
    {"key": "layer", "label": "绿幕抠图", "percent": 100},
    {"key": "depth", "label": "边缘柔化", "percent": 100},
    {"key": "psd", "label": "透明 PNG", "percent": 100},
]


def json_response(handler: BaseHTTPRequestHandler, data: dict, status: int = 200) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_tail(path: Path, max_bytes: int = 120_000) -> str:
    if not path.exists():
        return ""
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > max_bytes:
            f.seek(-max_bytes, os.SEEK_END)
        data = f.read()
    return data.decode("utf-8", errors="replace")


def safe_name(value: str, fallback: str = "layer") -> str:
    value = re.sub(r"[^\w .()\-\u4e00-\u9fff]+", "_", value, flags=re.UNICODE).strip(" .")
    return value[:80] or fallback


def infer_input_path(job_dir: Path) -> Path | None:
    input_dir = job_dir / "input"
    if not input_dir.exists():
        return None
    for preferred in (input_dir / "input_background_removed.png", input_dir / "input_chroma.png"):
        if preferred.exists():
            return preferred
    return next((path for path in input_dir.iterdir() if path.is_file()), None)


def job_result_files(job_dir: Path, stem: str) -> dict:
    output_root = job_dir / "output"
    output_dir = output_root / stem
    if not output_root.exists() and not output_dir.exists():
        return {"output_dir": None, "psd": None, "preview": None, "stats": None}

    psd = next(output_dir.glob("*.psd"), None) if output_dir.exists() else None
    if psd is None and output_root.exists():
        psd = next(output_root.glob("*.psd"), None)
    preview = output_dir / "reconstruction.png"
    stats = output_dir / "stats.json"
    info = output_dir / "info.json"
    layers = []
    if output_dir.exists():
        candidates = {
            path.stem: path
            for path in output_dir.glob("*.png")
            if not path.stem.endswith("_depth")
            and path.stem not in {"src_img", "src_head", "reconstruction"}
        }
        ordered_names = [name for name in LAYER_ORDER if name in candidates]
        ordered_names.extend(sorted(name for name in candidates if name not in ordered_names))
        layers = [
            {"name": name, "path": str(candidates[name])}
            for name in ordered_names
        ]

    return {
        "output_dir": str(output_dir if output_dir.exists() else output_root),
        "psd": str(psd) if psd else None,
        "preview": str(preview) if preview.exists() else None,
        "stats": str(stats if stats.exists() else info) if stats.exists() or info.exists() else None,
        "layers": layers,
    }


def job_payload_from_disk(job_dir: Path) -> dict | None:
    if not job_dir.exists() or not job_dir.is_dir():
        return None

    job_id = job_dir.name
    input_path = infer_input_path(job_dir)
    stem = input_path.stem if input_path else "input"
    stdout = read_tail(job_dir / "stdout.log")
    stderr = read_tail(job_dir / "stderr.log")
    result = job_result_files(job_dir, stem)
    returncode = None
    if result.get("psd"):
        status = "done"
        returncode = 0
    elif "Traceback" in stderr or "RuntimeError" in stderr or "ValueError" in stderr:
        status = "failed"
        returncode = 1
    else:
        status = "unknown"

    created_at = job_dir.stat().st_mtime
    if input_path and input_path.exists():
        created_at = input_path.stat().st_mtime

    payload = {
        "id": job_id,
        "status": status,
        "created_at": created_at,
        "finished_at": job_dir.stat().st_mtime,
        "original_name": input_path.name if input_path else job_id,
        "input_path": str(input_path) if input_path else None,
        "pid": None,
        "returncode": returncode,
        "result": result,
        "stdout": stdout,
        "stderr": stderr,
    }
    payload["progress"] = parse_progress(stdout, stderr, status, None)
    return payload


def history_jobs(limit: int = 80) -> list[dict]:
    with LOCK:
        memory_jobs = {job["id"]: dict(job) for job in JOBS.values()}

    discovered: dict[str, dict] = {}
    if RUN_ROOT.exists():
        for job_dir in RUN_ROOT.iterdir():
            payload = job_payload_from_disk(job_dir)
            if payload:
                discovered[payload["id"]] = payload

    for job_id, job in memory_jobs.items():
        job_dir = Path(job["job_dir"])
        payload = job_payload_from_disk(job_dir) or {}
        payload.update({k: v for k, v in job.items() if k != "job_dir"})
        payload["result"] = job_result_files(job_dir, Path(job["input_path"]).stem)
        payload["stdout"] = read_tail(job_dir / "stdout.log")
        payload["stderr"] = read_tail(job_dir / "stderr.log")
        payload["progress"] = parse_progress(
            payload["stdout"],
            payload["stderr"],
            payload.get("status", "unknown"),
            payload.get("progress"),
        )
        discovered[job_id] = payload

    jobs = sorted(discovered.values(), key=lambda item: item.get("created_at", 0), reverse=True)
    compact_jobs = []
    for job in jobs[:limit]:
        result = job.get("result", {}) or {}
        compact_jobs.append(
            {
                "id": job.get("id"),
                "status": job.get("status"),
                "created_at": job.get("created_at"),
                "finished_at": job.get("finished_at"),
                "original_name": job.get("original_name"),
                "result": {
                    "psd": result.get("psd"),
                    "preview": result.get("preview"),
                    "layer_count": len(result.get("layers", []) or []),
                },
                "progress": job.get("progress", {}),
            }
        )
    return compact_jobs


def history_job(job_id: str) -> dict | None:
    with LOCK:
        job = JOBS.get(job_id)
        if job:
            job_dir = Path(job["job_dir"])
            payload = dict(job)
            payload["stdout"] = read_tail(job_dir / "stdout.log")
            payload["stderr"] = read_tail(job_dir / "stderr.log")
            payload["result"] = job_result_files(job_dir, Path(payload["input_path"]).stem)
            payload["progress"] = parse_progress(
                payload["stdout"],
                payload["stderr"],
                payload["status"],
                payload.get("progress"),
            )
            payload.pop("job_dir", None)
            return payload

    if not re.fullmatch(r"[0-9a-fA-F]{8,32}", job_id):
        return None
    job_dir = RUN_ROOT / job_id
    return job_payload_from_disk(job_dir)


def layer_bounds(layer) -> tuple[int, int]:
    left = int(getattr(layer, "left", 0) or 0)
    top = int(getattr(layer, "top", 0) or 0)
    return left, top


def collect_psd_layers(container, parents: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], object]]:
    collected = []
    for layer in container:
        name = str(getattr(layer, "name", "") or "layer")
        path = (*parents, name)
        if getattr(layer, "is_group", lambda: False)():
            collected.extend(collect_psd_layers(layer, path))
        else:
            collected.append((path, layer))
    return collected


def psd_to_view(psd_path: Path, view_dir: Path) -> dict:
    try:
        from PIL import Image
        from psd_tools import PSDImage
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("缺少 PSD 解析依赖，请在虚拟环境安装 psd-tools 和 Pillow") from exc

    psd = PSDImage.open(psd_path)
    width, height = int(psd.width), int(psd.height)
    layers_dir = view_dir / "layers"
    layers_dir.mkdir(parents=True, exist_ok=True)

    preview = view_dir / "preview.png"
    composite = psd.composite()
    if composite:
        composite.convert("RGBA").save(preview)

    raw_layers = collect_psd_layers(psd)
    exported = []
    used_names: dict[str, int] = {}
    for order, (name_parts, layer) in enumerate(reversed(raw_layers)):
        try:
            image = layer.topil()
        except Exception:
            image = None
        if image is None:
            continue

        image = image.convert("RGBA")
        if image.getbbox() is None:
            continue

        display_name = " / ".join(part for part in name_parts if part)
        base = safe_name(display_name, f"layer_{order:03d}")
        used_names[base] = used_names.get(base, 0) + 1
        suffix = f"_{used_names[base]}" if used_names[base] > 1 else ""
        out_path = layers_dir / f"{order:03d}_{base}{suffix}.png"

        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        left, top = layer_bounds(layer)
        canvas.paste(image, (left, top), image)
        canvas.save(out_path)
        exported.append(
            {
                "name": display_name or base,
                "path": str(out_path),
                "visible": bool(getattr(layer, "visible", True)),
            }
        )

    return {
        "id": view_dir.name,
        "psd": str(psd_path),
        "preview": str(preview) if preview.exists() else None,
        "layers": exported,
        "stats": None,
        "width": width,
        "height": height,
    }


def chroma_key_image(
    src_path: Path,
    out_path: Path,
    threshold: int = 72,
    softness: int = 42,
    spill: float = 0.35,
    mode: str = "green",
    key_color: str | None = None,
) -> dict:
    try:
        import numpy as np
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("缺少抠图依赖，请确认 Pillow 和 numpy 已安装") from exc

    threshold = max(1, min(220, int(threshold)))
    softness = max(1, min(180, int(softness)))
    spill = max(0.0, min(1.0, float(spill)))
    mode = mode if mode in {"auto", "green", "custom", "rembg"} else "auto"

    image = Image.open(src_path).convert("RGBA")
    arr = np.asarray(image).astype(np.float32)
    rgb = arr[..., :3]
    alpha = arr[..., 3]

    if mode == "rembg":
        try:
            from rembg import remove
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("智能抠图需要安装 rembg 和 onnxruntime；当前环境未安装") from exc
        out = remove(image)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out.save(out_path)
        out_alpha = np.asarray(out.convert("RGBA"))[..., 3]
        return {
            "path": str(out_path),
            "width": image.width,
            "height": image.height,
            "transparent_ratio": round(float((out_alpha < 12).mean()), 4),
            "soft_edge_ratio": round(float(((out_alpha >= 12) & (out_alpha <= 242)).mean()), 4),
            "threshold": threshold,
            "softness": softness,
            "spill": spill,
            "mode": mode,
            "key_color": None,
        }

    if mode == "green":
        key = np.array([0.0, 255.0, 0.0], dtype=np.float32)
    elif mode == "custom" and key_color:
        text = key_color.strip().lstrip("#")
        if not re.fullmatch(r"[0-9a-fA-F]{6}", text):
            raise RuntimeError("自定义背景色需要 6 位 HEX，例如 #00ff00")
        key = np.array([int(text[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)
    else:
        h, w = rgb.shape[:2]
        band = max(2, min(24, h // 20, w // 20))
        edges = np.concatenate(
            [
                rgb[:band, :, :].reshape(-1, 3),
                rgb[-band:, :, :].reshape(-1, 3),
                rgb[:, :band, :].reshape(-1, 3),
                rgb[:, -band:, :].reshape(-1, 3),
            ],
            axis=0,
        )
        key = np.median(edges, axis=0).astype(np.float32)

    dist = np.linalg.norm(rgb - key, axis=2)
    t = np.clip((dist - threshold) / softness, 0.0, 1.0)
    keep = t * t * (3.0 - 2.0 * t)

    if mode == "green":
        green = rgb[..., 1]
        red_blue_max = np.maximum(rgb[..., 0], rgb[..., 2])
        dominance = np.clip((green - red_blue_max) / 96.0, 0.0, 1.0)
        key_strength = (1.0 - keep) * dominance
    else:
        key_strength = 1.0 - keep

    new_alpha = alpha * (1.0 - key_strength)
    if spill > 0:
        neutral = np.median(rgb, axis=2, keepdims=True)
        rgb = np.clip(rgb * (1.0 - key_strength[..., None] * spill * 0.35) + neutral * (key_strength[..., None] * spill * 0.35), 0.0, 255.0)
        if mode == "green":
            green = rgb[..., 1]
            red_blue_max = np.maximum(rgb[..., 0], rgb[..., 2])
            green_excess = np.maximum(green - red_blue_max, 0.0)
            rgb[..., 1] = np.clip(green - green_excess * key_strength * spill, 0.0, 255.0)

    out = arr.copy()
    out[..., :3] = rgb
    out[..., 3] = np.clip(new_alpha, 0.0, 255.0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out.astype(np.uint8), "RGBA").save(out_path)

    transparent_ratio = float((new_alpha < 12).mean())
    soft_ratio = float(((new_alpha >= 12) & (new_alpha <= 242)).mean())
    return {
        "path": str(out_path),
        "width": image.width,
        "height": image.height,
        "transparent_ratio": round(transparent_ratio, 4),
        "soft_edge_ratio": round(soft_ratio, 4),
        "threshold": threshold,
        "softness": softness,
        "spill": spill,
        "mode": mode,
        "key_color": "#{:02x}{:02x}{:02x}".format(*[int(round(x)) for x in key]),
    }


def parse_progress(stdout: str, stderr: str, status: str, previous: dict | None = None) -> dict:
    text = f"{stdout}\n{stderr}"
    previous = previous or {}

    stage = "等待开始"
    stage_percent = 0
    overall = 0

    percents = [int(x) for x in re.findall(r"(\d+)%\|", text)]
    last_percent = percents[-1] if percents else 0

    if status == "done" or "Done." in text:
        stage = "完成"
        stage_percent = 100
        overall = 100
    elif status == "failed" or "Traceback" in text or "RuntimeError" in text:
        stage = "失败"
        stage_percent = last_percent
        overall = max(int(previous.get("overall", 0)), 0)
    elif "Running PSD assembly" in text:
        stage = "PSD 组装"
        stage_percent = 70
        overall = 96
    elif "Running Marigold depth" in text:
        stage = "深度估计"
        stage_percent = last_percent
        overall = 72 + round(last_percent * 0.22)
    elif "Building Marigold depth pipeline" in text:
        stage = "加载深度模型"
        stage_percent = last_percent
        overall = 68
    elif "Running LayerDiff3D" in text or "Running LayerDiff3D (body + head)" in text:
        stage = "图层分解"
        stage_percent = last_percent
        completed_bars = len(re.findall(r"100%\|", text))
        layer_total = min(100, completed_bars * 45 + last_percent * 0.45)
        overall = 12 + round(layer_total * 0.55)
    elif "Building LayerDiff3D pipeline" in text or "Building Blockswap pipeline" in text:
        stage = "加载分层模型"
        stage_percent = last_percent
        overall = max(4, round(last_percent * 0.10))
    elif "Fetching" in text or "Loading weights" in text:
        stage = "下载/加载模型"
        stage_percent = last_percent
        overall = max(2, round(last_percent * 0.08))

    overall = max(int(previous.get("overall", 0)), min(100, overall))
    if overall >= 100:
        stage_percent = 100

    return {
        "stage": stage,
        "stage_percent": max(0, min(100, int(stage_percent))),
        "overall": max(0, min(100, int(overall))),
    }


def parse_progress(stdout: str, stderr: str, status: str, previous: dict | None = None) -> dict:
    text = f"{stdout}\n{stderr}"
    previous = previous or {}

    def last_percent_in(segment: str) -> int:
        values = [int(x) for x in re.findall(r"(\d+)%\|", segment)]
        return values[-1] if values else 0

    def segment_after(marker: str) -> str:
        index = text.rfind(marker)
        return text[index:] if index >= 0 else ""

    loading_percent = last_percent_in(text)
    layer_segment = segment_after("Running LayerDiff3D")
    depth_segment = segment_after("Running Marigold depth")
    layer_percent = last_percent_in(layer_segment)
    depth_percent = last_percent_in(depth_segment)

    load = 0
    layer = 0
    depth = 0
    psd = 0
    stage = "等待开始"
    stage_percent = 0

    if "Building LayerDiff3D pipeline" in text or "Building Blockswap pipeline" in text:
        load = max(10, min(70, loading_percent or 10))
        stage = "加载分层模型"
        stage_percent = load
    if "Running LayerDiff3D" in text:
        load = 100
        completed_layer_bars = len(re.findall(r"100%\|", layer_segment))
        layer = min(100, completed_layer_bars * 45 + layer_percent * 0.45)
        stage = "图层分解"
        stage_percent = layer
    if "LayerDiff3D done" in text:
        layer = 100
    if "Building Marigold depth pipeline" in text:
        load = 100
        layer = 100
        depth = max(5, min(35, loading_percent // 3 if loading_percent else 5))
        stage = "加载深度模型"
        stage_percent = depth
    if "Running Marigold depth" in text:
        load = 100
        layer = 100
        depth = min(100, depth_percent)
        stage = "深度估计"
        stage_percent = depth
    if "Marigold done" in text:
        depth = 100
    if "Running PSD assembly" in text:
        load = 100
        layer = 100
        depth = 100
        psd = 70
        stage = "PSD 组装"
        stage_percent = psd
    if "PSD assembly done" in text or "psd saved to" in text:
        psd = 100

    download_failed = (
        "WinError 10060" in text
        or "LocalEntryNotFoundError" in text
        or "cannot find the requested files in the local cache" in text
        or "ConnectionError" in text
    )

    if status == "done" or "Done." in text:
        load = layer = depth = psd = 100
        stage = "完成"
        stage_percent = 100
    elif download_failed:
        stage = "模型下载失败 / 网络超时"
        stage_percent = max(0, min(100, int(stage_percent or loading_percent)))
    elif status == "failed" or "Traceback" in text or "RuntimeError" in text or "ValueError" in text:
        stage = "失败"
        stage_percent = max(0, min(100, int(stage_percent or loading_percent)))

    overall = round(load * 0.15 + layer * 0.55 + depth * 0.22 + psd * 0.08)
    overall = max(int(previous.get("overall", 0)), min(100, overall))
    stages = [
        {"key": "load", "label": "模型加载", "percent": round(load)},
        {"key": "layer", "label": "图层分解", "percent": round(layer)},
        {"key": "depth", "label": "深度估计", "percent": round(depth)},
        {"key": "psd", "label": "PSD 组装", "percent": round(psd)},
    ]

    return {
        "stage": stage,
        "stage_percent": max(0, min(100, int(stage_percent))),
        "overall": max(0, min(100, int(overall))),
        "stages": stages,
    }


def run_job(job_id: str) -> None:
    with LOCK:
        job = JOBS[job_id]
        job["status"] = "running"
        job["started_at"] = time.time()

    job_dir = Path(job["job_dir"])
    stdout_path = job_dir / "stdout.log"
    stderr_path = job_dir / "stderr.log"
    input_path = Path(job["input_path"])
    save_dir = job_dir / "output"

    script = BLOCKSWAP_SCRIPT if job["engine"] == "blockswap" else QUANTIZED_SCRIPT
    cmd = [
        str(PYTHON),
        str(script),
        "--srcp",
        str(input_path),
        "--save_dir",
        str(save_dir),
        "--save_to_psd",
        "--resolution",
        str(job["resolution"]),
        "--num_inference_steps",
        str(job["steps"]),
    ]
    if job["tblr_split"]:
        cmd.append("--tblr_split")
    if job.get("depth_split_tags"):
        cmd.extend(["--depth_split_tags", job["depth_split_tags"]])
    if job.get("component_split_tags"):
        cmd.extend([
            "--component_split_tags",
            job["component_split_tags"],
            "--component_min_area",
            str(job["component_min_area"]),
        ])
    if job["engine"] == "nf4":
        cmd.extend(["--quant_mode", "nf4"])
    elif job["engine"] == "bf16":
        cmd.extend(["--quant_mode", "none"])
    if job["cpu_offload"] and job["engine"] in {"nf4", "bf16"}:
        cmd.append("--cpu_offload")

    layerdiff_model = local_model_path(job["engine"], "layerdiff")
    depth_model = local_model_path(job["engine"], "depth")
    if layerdiff_model:
        cmd.extend(["--repo_id_layerdiff", layerdiff_model])
    if depth_model:
        cmd.extend(["--repo_id_depth", depth_model])

    env = os.environ.copy()
    env.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8:replace")

    try:
        with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
            out.write(
                (
                    f"Using local LayerDiff model: {layerdiff_model or 'no, will use HuggingFace'}\n"
                    f"Using local depth model: {depth_model or 'no, will use HuggingFace'}\n"
                ).encode("utf-8")
            )
            out.flush()
            proc = subprocess.Popen(cmd, cwd=ROOT, stdout=out, stderr=err, env=env)
            with LOCK:
                JOBS[job_id]["pid"] = proc.pid
            code = proc.wait()

        with LOCK:
            JOBS[job_id]["returncode"] = code
            JOBS[job_id]["finished_at"] = time.time()
            JOBS[job_id]["result"] = job_result_files(job_dir, input_path.stem)
            JOBS[job_id]["status"] = "done" if code == 0 else "failed"
    except Exception as exc:  # noqa: BLE001
        stderr_path.write_text(str(exc), encoding="utf-8", errors="replace")
        with LOCK:
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["finished_at"] = time.time()
            JOBS[job_id]["error"] = str(exc)


class Handler(BaseHTTPRequestHandler):
    server_version = "SeeThroughWeb/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/history":
            json_response(self, {"jobs": history_jobs()})
            return

        if path.startswith("/api/history/"):
            job_id = path.rsplit("/", 1)[-1]
            payload = history_job(job_id)
            if not payload:
                json_response(self, {"error": "history item not found"}, 404)
                return
            json_response(self, payload)
            return

        if path == "/api/jobs":
            with LOCK:
                jobs = [
                    {k: v for k, v in job.items() if k not in {"job_dir"}}
                    for job in sorted(JOBS.values(), key=lambda x: x["created_at"], reverse=True)
                ]
            json_response(self, {"jobs": jobs})
            return

        if path.startswith("/api/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            with LOCK:
                job = JOBS.get(job_id)
                if not job:
                    json_response(self, {"error": "job not found"}, 404)
                    return
                payload = dict(job)
            job_dir = Path(payload["job_dir"])
            payload["stdout"] = read_tail(job_dir / "stdout.log")
            payload["stderr"] = read_tail(job_dir / "stderr.log")
            payload["result"] = job_result_files(job_dir, Path(payload["input_path"]).stem)
            payload["progress"] = parse_progress(
                payload["stdout"],
                payload["stderr"],
                payload["status"],
                payload.get("progress"),
            )
            with LOCK:
                if job_id in JOBS:
                    JOBS[job_id]["progress"] = payload["progress"]
            payload.pop("job_dir", None)
            json_response(self, payload)
            return

        if path.startswith("/files/"):
            self.serve_workspace_file(path.removeprefix("/files/"))
            return

        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/api/preprocess/background", "/api/preprocess/greenscreen"}:
            self.handle_background_preview()
            return

        if parsed.path == "/api/psd-view":
            self.handle_psd_view()
            return

        if parsed.path != "/api/jobs":
            json_response(self, {"error": "not found"}, 404)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )

        file_item = form["image"] if "image" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            json_response(self, {"error": "请上传图片"}, 400)
            return

        with LOCK:
            busy_job = next(
                (job for job in JOBS.values() if job["status"] in {"queued", "running"}),
                None,
            )
        if busy_job:
            json_response(self, {"error": f"已有任务正在运行：{busy_job['id']}"}, 409)
            return

        job_id = uuid.uuid4().hex[:12]
        job_dir = RUN_ROOT / job_id
        input_dir = job_dir / "input"
        input_dir.mkdir(parents=True, exist_ok=True)

        original_name = Path(file_item.filename).name
        suffix = Path(original_name).suffix.lower() or ".png"
        input_path = input_dir / f"input{suffix}"
        with input_path.open("wb") as f:
            shutil.copyfileobj(file_item.file, f)

        bgremove = (
            form.getfirst("bgremove", "") or form.getfirst("greenscreen", "")
        ) in {"1", "true", "on"}
        bgremove_mode = form.getfirst("bgremove_mode", "auto")
        bgremove_threshold = int(form.getfirst("bgremove_threshold", form.getfirst("greenscreen_threshold", "72")))
        bgremove_softness = int(form.getfirst("bgremove_softness", form.getfirst("greenscreen_softness", "42")))
        bgremove_spill = float(form.getfirst("bgremove_spill", form.getfirst("greenscreen_spill", "0.35")))
        bgremove_color = form.getfirst("bgremove_color", "#00ff00")
        preprocess = None
        infer_input_path = input_path
        if bgremove:
            infer_input_path = input_dir / "input_background_removed.png"
            preprocess = chroma_key_image(
                input_path,
                infer_input_path,
                bgremove_threshold,
                bgremove_softness,
                bgremove_spill,
                bgremove_mode,
                bgremove_color,
            )

        resolution = int(form.getfirst("resolution", "1024"))
        resolution = max(512, min(1536, resolution))
        steps = int(form.getfirst("steps", "20"))
        steps = max(5, min(40, steps))
        tblr_split = form.getfirst("tblr_split", "") in {"1", "true", "on"}
        depth_split_tags = ",".join(
            tag.strip()
            for tag in form.getfirst("depth_split_tags", "").split(",")
            if tag.strip()
        )
        component_split_tags = ",".join(
            tag.strip()
            for tag in form.getfirst("component_split_tags", "").split(",")
            if tag.strip()
        )
        component_min_area = int(form.getfirst("component_min_area", "64"))
        component_min_area = max(8, min(4096, component_min_area))
        cpu_offload = form.getfirst("cpu_offload", "on") in {"1", "true", "on"}
        engine = form.getfirst("engine", "blockswap")
        if engine == "quantized":
            engine = "nf4"
        if engine not in {"nf4", "bf16", "blockswap"}:
            engine = "blockswap"

        job = {
            "id": job_id,
            "status": "queued",
            "created_at": time.time(),
            "original_name": original_name,
            "input_path": str(infer_input_path),
            "source_input_path": str(input_path),
            "preprocess": preprocess,
            "resolution": resolution,
            "steps": steps,
            "tblr_split": tblr_split,
            "depth_split_tags": depth_split_tags,
            "component_split_tags": component_split_tags,
            "component_min_area": component_min_area,
            "cpu_offload": cpu_offload,
            "engine": engine,
            "job_dir": str(job_dir),
            "pid": None,
            "returncode": None,
            "result": {},
            "progress": {"stage": "等待开始", "stage_percent": 0, "overall": 0},
        }
        with LOCK:
            JOBS[job_id] = job

        thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
        thread.start()

        json_response(self, {"job": {k: v for k, v in job.items() if k != "job_dir"}})

    def handle_background_preview(self) -> None:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )

        file_item = form["image"] if "image" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            json_response(self, {"error": "请上传图片"}, 400)
            return

        view_id = uuid.uuid4().hex[:12]
        view_dir = PREPROCESS_ROOT / view_id
        view_dir.mkdir(parents=True, exist_ok=True)

        original_name = Path(file_item.filename).name
        suffix = Path(original_name).suffix.lower() or ".png"
        source_path = view_dir / f"source{suffix}"
        out_path = view_dir / "background_removed.png"
        with source_path.open("wb") as f:
            shutil.copyfileobj(file_item.file, f)

        try:
            result = chroma_key_image(
                source_path,
                out_path,
                int(form.getfirst("bgremove_threshold", form.getfirst("greenscreen_threshold", "72"))),
                int(form.getfirst("bgremove_softness", form.getfirst("greenscreen_softness", "42"))),
                float(form.getfirst("bgremove_spill", form.getfirst("greenscreen_spill", "0.35"))),
                form.getfirst("bgremove_mode", "auto"),
                form.getfirst("bgremove_color", "#00ff00"),
            )
        except Exception as exc:  # noqa: BLE001
            json_response(self, {"error": f"背景抠图失败：{exc}"}, 500)
            return

        json_response(
            self,
            {
                "id": view_id,
                "status": "done",
                "original_name": original_name,
                "result": {
                    "preview": result["path"],
                    "transparent_png": result["path"],
                    "stats": None,
                    "layers": [],
                },
                "preprocess": result,
                "progress": {
                    "stage": "背景抠图完成",
                    "stage_percent": 100,
                    "overall": 100,
                    "stages": DEFAULT_PREPROCESS_STAGES,
                },
                "stdout": (
                    f"背景抠图完成：{original_name}\n"
                    f"模式：{result['mode']}，背景色：{result.get('key_color') or '智能抠图'}\n"
                    f"透明像素比例：{result['transparent_ratio'] * 100:.1f}%\n"
                    f"柔边像素比例：{result['soft_edge_ratio'] * 100:.1f}%"
                ),
                "stderr": "",
            },
        )

    def handle_psd_view(self) -> None:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )

        file_item = form["psd"] if "psd" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            json_response(self, {"error": "请上传 PSD 文件"}, 400)
            return

        original_name = Path(file_item.filename).name
        if Path(original_name).suffix.lower() != ".psd":
            json_response(self, {"error": "请选择 .psd 文件"}, 400)
            return

        view_id = uuid.uuid4().hex[:12]
        view_dir = PSD_VIEW_ROOT / view_id
        view_dir.mkdir(parents=True, exist_ok=True)
        psd_path = view_dir / safe_name(original_name, "input.psd")
        if psd_path.suffix.lower() != ".psd":
            psd_path = psd_path.with_suffix(".psd")

        try:
            with psd_path.open("wb") as f:
                shutil.copyfileobj(file_item.file, f)
            result = psd_to_view(psd_path, view_dir)
        except Exception as exc:  # noqa: BLE001
            json_response(self, {"error": f"PSD 解析失败：{exc}"}, 500)
            return

        json_response(
            self,
            {
                "id": view_id,
                "status": "done",
                "original_name": original_name,
                "created_at": time.time(),
                "result": result,
                "progress": {
                    "stage": "PSD 查看",
                    "stage_percent": 100,
                    "overall": 100,
                    "stages": [
                        {"key": "load", "label": "模型加载", "percent": 0},
                        {"key": "layer", "label": "图层读取", "percent": 100},
                        {"key": "depth", "label": "深度估计", "percent": 0},
                        {"key": "psd", "label": "PSD 组装", "percent": 100},
                    ],
                },
                "stdout": f"已打开 PSD：{original_name}\n读取图层：{len(result['layers'])} 个",
                "stderr": "",
            },
        )

    def serve_static(self, path: str) -> None:
        rel = "index.html" if path in {"", "/"} else path.lstrip("/")
        target = (WEB_ROOT / rel).resolve()
        if not str(target).startswith(str(WEB_ROOT.resolve())) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        self.send_file(target, inline=True)

    def serve_workspace_file(self, encoded: str) -> None:
        target = Path(unquote(encoded)).resolve()
        workspace = (ROOT / "workspace").resolve()
        if not str(target).startswith(str(workspace)) or not target.exists() or target.is_dir():
            self.send_error(404)
            return
        self.send_file(target, inline=False)

    def send_file(self, target: Path, inline: bool) -> None:
        mime, _ = mimetypes.guess_type(str(target))
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        disposition = "inline" if inline else "attachment"
        self.send_header("Content-Disposition", f'{disposition}; filename="{target.name}"')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main() -> None:
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    PSD_VIEW_ROOT.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("SEETHROUGH_WEB_PORT", "7861"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"See-through Web UI: http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
