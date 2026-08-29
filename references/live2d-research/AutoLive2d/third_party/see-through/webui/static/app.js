const form = document.querySelector("#job-form");
const imageInput = document.querySelector("#image");
const preview = document.querySelector("#input-preview");
const resultImage = document.querySelector("#result-image");
const emptyResult = document.querySelector("#empty-result");
const statusPill = document.querySelector("#status-pill");
const jobTitle = document.querySelector("#job-title");
const logEl = document.querySelector("#log");
const refreshBtn = document.querySelector("#refresh");
const submitBtn = document.querySelector(".primary");
const layerCanvas = document.querySelector("#layer-canvas");
const layerList = document.querySelector("#layer-list");
const showAllBtn = document.querySelector("#show-all");
const hideAllBtn = document.querySelector("#hide-all");
const resetLayerBtn = document.querySelector("#reset-layer");
const fullscreenLayerBtn = document.querySelector("#fullscreen-layer");
const layerPreviewPanel = document.querySelector(".layer-preview");
const themeToggle = document.querySelector("#theme-toggle");
const historyDrawer = document.querySelector("#history-drawer");
const historyToggle = document.querySelector("#history-toggle");
const historyRefresh = document.querySelector("#history-refresh");
const historyList = document.querySelector("#history-list");
const psdViewForm = document.querySelector("#psd-view-form");
const psdFile = document.querySelector("#psd-file");
const psdFileName = document.querySelector("#psd-file-name");
const bgremovePreviewBtn = document.querySelector("#bgremove-preview");
const depthSplitTags = document.querySelector("#depth_split_tags");
const componentSplitTags = document.querySelector("#component_split_tags");
const presetButtons = document.querySelectorAll(".preset-btn");
const overallBar = document.querySelector("#overall-bar");
const stageBar = document.querySelector("#stage-bar");
const overallPercent = document.querySelector("#overall-percent");
const stagePercent = document.querySelector("#stage-percent");
const stageName = document.querySelector("#stage-name");
const stageList = document.querySelector("#stage-list");
const links = {
  psd: document.querySelector("#download-psd"),
  preview: document.querySelector("#download-preview"),
  transparent: document.querySelector("#download-transparent"),
  stats: document.querySelector("#download-stats"),
};

let currentJobId = null;
let timer = null;
let selectedLayerId = null;
let dragState = null;
let renderedLayerSignature = "";
const layerOffsets = new Map();
const layerHitmaps = new Map();

const DEFAULT_STAGES = [
  { key: "load", label: "模型加载", percent: 0 },
  { key: "layer", label: "图层分解", percent: 0 },
  { key: "depth", label: "深度估计", percent: 0 },
  { key: "psd", label: "PSD 组装", percent: 0 },
];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("seeThroughTheme", theme);
  if (themeToggle) themeToggle.textContent = theme === "dark" ? "☀" : "☾";
}

const savedTheme = localStorage.getItem("seeThroughTheme");
const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(savedTheme || (systemDark ? "dark" : "light"));

function setStatus(status) {
  statusPill.textContent = status;
  statusPill.className = `pill ${status}`;
  submitBtn.disabled = status === "queued" || status === "running";
}

function fileUrl(path) {
  return `/files/${encodeURIComponent(path)}`;
}

function setDownload(link, path) {
  if (!path) {
    link.href = "#";
    link.classList.add("disabled");
    return;
  }
  link.href = fileUrl(path);
  link.classList.remove("disabled");
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function mergeTags(input, tags) {
  if (!input) return;
  const merged = [];
  const seen = new Set();
  [...splitTags(input.value), ...splitTags(tags)].forEach((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(tag);
  });
  input.value = merged.join(",");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function flashPresetButton(button) {
  button.classList.add("applied");
  window.setTimeout(() => button.classList.remove("applied"), 850);
}

function renderStageList(stages = DEFAULT_STAGES) {
  stageList.innerHTML = "";
  stages.forEach((stage) => {
    const percent = clampPercent(stage.percent);
    const row = document.createElement("div");
    row.className = "stage-item";
    row.innerHTML = `
      <div class="stage-item-head">
        <span>${stage.label}</span>
        <strong>${Math.round(percent)}%</strong>
      </div>
      <div class="mini-bar"><span style="width:${percent}%"></span></div>
    `;
    stageList.appendChild(row);
  });
}

function setProgress(progress = {}) {
  const overall = clampPercent(progress.overall);
  const stage = clampPercent(progress.stage_percent);
  overallBar.style.width = `${overall}%`;
  stageBar.style.width = `${stage}%`;
  overallPercent.textContent = `${Math.round(overall)}%`;
  stagePercent.textContent = `${Math.round(stage)}%`;
  stageName.textContent = progress.stage || "等待开始";
  renderStageList(progress.stages || DEFAULT_STAGES);
}

function renderLayers(layers = []) {
  const signature = JSON.stringify(layers.map((layer) => [layer.name, layer.path]));
  if (signature === renderedLayerSignature) return;
  renderedLayerSignature = signature;
  layerCanvas.innerHTML = "";
  layerList.innerHTML = "";
  selectedLayerId = null;
  layerOffsets.clear();
  layerHitmaps.clear();

  if (!layers.length) {
    layerCanvas.innerHTML = '<div class="empty">任务完成后可在这里叠加预览图层</div>';
    return;
  }

  layers.forEach((layer, index) => {
    const id = `layer-${index}`;
    const url = fileUrl(layer.path);

    const canvasImg = document.createElement("img");
    canvasImg.src = url;
    canvasImg.dataset.layer = id;
    canvasImg.style.zIndex = String(index + 1);
    canvasImg.draggable = false;
    canvasImg.addEventListener("load", () => cacheLayerHitmap(canvasImg));
    layerCanvas.appendChild(canvasImg);

    const item = document.createElement("label");
    item.className = "layer-item";
    item.dataset.layer = id;
    item.innerHTML = `
      <input type="checkbox" checked data-target="${id}">
      <img src="${url}" alt="">
      <span>${layer.name}</span>
    `;
    layerList.appendChild(item);
  });

  selectLayer(`layer-${layers.length - 1}`);
}

function renderHistory(jobs = []) {
  historyList.innerHTML = "";
  if (!jobs.length) {
    historyList.innerHTML = '<div class="empty">暂无记录</div>';
    return;
  }

  jobs.forEach((job) => {
    const item = document.createElement("button");
    item.className = "history-item";
    item.type = "button";
    item.dataset.jobId = job.id;
    item.innerHTML = `
      <span class="history-name">${job.original_name || job.id}</span>
      <span class="history-meta">
        <span class="mini-pill ${job.status || "unknown"}">${job.status || "unknown"}</span>
        <span>${formatTime(job.created_at)}</span>
      </span>
    `;
    historyList.appendChild(item);
  });
}

async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "读取记录失败");
    renderHistory(payload.jobs || []);
  } catch (error) {
    historyList.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

async function openHistoryJob(jobId) {
  const res = await fetch(`/api/history/${jobId}`);
  const payload = await res.json();
  if (!res.ok) {
    logEl.textContent = payload.error || "打开记录失败";
    return;
  }
  currentJobId = null;
  clearInterval(timer);
  timer = null;
  updateJob(payload);
}

function cacheLayerHitmap(img) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  layerHitmaps.set(img.dataset.layer, {
    width: canvas.width,
    height: canvas.height,
    alpha: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
  });
}

function selectLayer(id) {
  selectedLayerId = id;
  layerCanvas.querySelectorAll("img").forEach((img) => {
    img.classList.toggle("selected-layer", img.dataset.layer === id);
  });
  layerList.querySelectorAll(".layer-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.layer === id);
  });
}

function applyLayerOffset(id) {
  const img = layerCanvas.querySelector(`[data-layer="${id}"]`);
  if (!img) return;
  const offset = layerOffsets.get(id) || { x: 0, y: 0 };
  img.style.setProperty("--tx", `${offset.x}px`);
  img.style.setProperty("--ty", `${offset.y}px`);
}

function resetLayers() {
  layerCanvas.querySelectorAll("img[data-layer]").forEach((img) => {
    layerOffsets.set(img.dataset.layer, { x: 0, y: 0 });
    applyLayerOffset(img.dataset.layer);
  });
}

function getImageContentRect(img) {
  const canvasRect = layerCanvas.getBoundingClientRect();
  const width = img.naturalWidth || 1;
  const height = img.naturalHeight || 1;
  const scale = Math.min(canvasRect.width / width, canvasRect.height / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offset = layerOffsets.get(img.dataset.layer) || { x: 0, y: 0 };
  return {
    left: canvasRect.left + (canvasRect.width - renderedWidth) / 2 + offset.x,
    top: canvasRect.top + (canvasRect.height - renderedHeight) / 2 + offset.y,
    width: renderedWidth,
    height: renderedHeight,
  };
}

function isOpaqueAt(img, clientX, clientY) {
  if (img.style.display === "none") return false;
  const hitmap = layerHitmaps.get(img.dataset.layer);
  if (!hitmap) return false;
  const rect = getImageContentRect(img);
  const x = Math.floor(((clientX - rect.left) / rect.width) * hitmap.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * hitmap.height);
  if (x < 0 || y < 0 || x >= hitmap.width || y >= hitmap.height) return false;
  return hitmap.alpha[(y * hitmap.width + x) * 4 + 3] > 12;
}

function pickLayerAt(clientX, clientY) {
  const imgs = Array.from(layerCanvas.querySelectorAll("img[data-layer]"));
  imgs.sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
  return imgs.find((img) => isOpaqueAt(img, clientX, clientY)) || null;
}

function updateJob(job) {
  jobTitle.textContent = job.original_name || job.id || "当前任务";
  setStatus(job.status || "idle");
  const mergedLog = [job.stdout, job.stderr].filter(Boolean).join("\n");
  logEl.textContent = mergedLog || "等待日志输出...";
  logEl.scrollTop = logEl.scrollHeight;

  const result = job.result || {};
  setProgress(job.progress || {});
  setDownload(links.psd, result.psd);
  setDownload(links.preview, result.preview);
  setDownload(links.transparent, result.transparent_png || job.preprocess?.path);
  setDownload(links.stats, result.stats);

  if (result.preview) {
    resultImage.src = `${fileUrl(result.preview)}?t=${Date.now()}`;
    resultImage.style.display = "block";
    emptyResult.style.display = "none";
  }
  renderLayers(result.layers || []);

  if (job.status === "done" || job.status === "failed") {
    clearInterval(timer);
    timer = null;
    loadHistory();
  }
}

async function poll() {
  if (!currentJobId) return;
  const res = await fetch(`/api/jobs/${currentJobId}`);
  updateJob(await res.json());
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  setStatus("queued");
  setProgress({ stage: "提交任务", stage_percent: 0, overall: 0 });
  jobTitle.textContent = "提交中...";
  logEl.textContent = "";
  renderedLayerSignature = "";
  const res = await fetch("/api/jobs", { method: "POST", body: data });
  const payload = await res.json();
  if (!res.ok) {
    setStatus("failed");
    logEl.textContent = payload.error || "提交失败";
    return;
  }
  currentJobId = payload.job.id;
  updateJob(payload.job);
  clearInterval(timer);
  timer = setInterval(poll, 2500);
  poll();
  loadHistory();
});

refreshBtn.addEventListener("click", poll);
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

historyToggle.addEventListener("click", () => {
  historyDrawer.classList.toggle("collapsed");
  if (!historyDrawer.classList.contains("collapsed")) loadHistory();
});

historyRefresh.addEventListener("click", loadHistory);

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".history-item");
  if (!item) return;
  openHistoryJob(item.dataset.jobId);
});

psdFile.addEventListener("change", () => {
  psdFileName.textContent = psdFile.files?.[0]?.name || "选择 PSD 文件";
});

psdViewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = psdFile.files?.[0];
  if (!file) return;

  const data = new FormData(psdViewForm);
  setStatus("running");
  setProgress({ stage: "读取 PSD", stage_percent: 35, overall: 35 });
  jobTitle.textContent = "正在打开 PSD...";
  logEl.textContent = "";
  renderedLayerSignature = "";

  const res = await fetch("/api/psd-view", { method: "POST", body: data });
  const payload = await res.json();
  if (!res.ok) {
    setStatus("failed");
    setProgress({ stage: "PSD 解析失败", stage_percent: 100, overall: 0 });
    logEl.textContent = payload.error || "PSD 解析失败";
    return;
  }
  currentJobId = null;
  clearInterval(timer);
  timer = null;
  updateJob(payload);
});

bgremovePreviewBtn.addEventListener("click", async () => {
  const file = imageInput.files?.[0];
  if (!file) {
    logEl.textContent = "请先上传一张图片";
    return;
  }

  const data = new FormData();
  data.append("image", file);
  ["bgremove_mode", "bgremove_color", "bgremove_threshold", "bgremove_softness", "bgremove_spill"].forEach((name) => {
    const input = form.elements[name];
    if (input) data.append(name, input.value);
  });

  setStatus("running");
  setProgress({ stage: "背景抠图", stage_percent: 35, overall: 35 });
  jobTitle.textContent = "正在预览背景抠图...";
  logEl.textContent = "";

  const res = await fetch("/api/preprocess/background", { method: "POST", body: data });
  const payload = await res.json();
  if (!res.ok) {
    setStatus("failed");
    setProgress({ stage: "背景抠图失败", stage_percent: 100, overall: 0 });
    logEl.textContent = payload.error || "背景抠图失败";
    return;
  }

  currentJobId = null;
  clearInterval(timer);
  timer = null;
  updateJob(payload);
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mergeTags(depthSplitTags, button.dataset.depthTags);
    mergeTags(componentSplitTags, button.dataset.componentTags);
    flashPresetButton(button);
    if (button.dataset.toast) {
      logEl.textContent = `${button.dataset.toast}\n深度细分：${depthSplitTags.value || "未设置"}\n连通块细分：${
        componentSplitTags.value || "未设置"
      }`;
    }
  });
});

layerList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const layer = layerCanvas.querySelector(`[data-layer="${target.dataset.target}"]`);
  if (layer) layer.style.display = target.checked ? "block" : "none";
});

layerList.addEventListener("click", (event) => {
  const item = event.target.closest(".layer-item");
  if (!item) return;
  selectLayer(item.dataset.layer);
});

layerCanvas.addEventListener("pointerdown", (event) => {
  const hitLayer = pickLayerAt(event.clientX, event.clientY);
  if (hitLayer) selectLayer(hitLayer.dataset.layer);
  if (!selectedLayerId) return;

  const selected = layerCanvas.querySelector(`[data-layer="${selectedLayerId}"]`);
  if (!selected || selected.style.display === "none" || !isOpaqueAt(selected, event.clientX, event.clientY)) return;

  const offset = layerOffsets.get(selectedLayerId) || { x: 0, y: 0 };
  dragState = {
    id: selectedLayerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: offset.x,
    baseY: offset.y,
  };
  selected.classList.add("dragging");
  layerCanvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

layerCanvas.addEventListener("pointermove", (event) => {
  if (!dragState) return;
  const next = {
    x: dragState.baseX + event.clientX - dragState.startX,
    y: dragState.baseY + event.clientY - dragState.startY,
  };
  layerOffsets.set(dragState.id, next);
  applyLayerOffset(dragState.id);
});

window.addEventListener("pointerup", () => {
  if (!dragState) return;
  const selected = layerCanvas.querySelector(`[data-layer="${dragState.id}"]`);
  selected?.classList.remove("dragging");
  dragState = null;
});

showAllBtn.addEventListener("click", () => {
  layerList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

hideAllBtn.addEventListener("click", () => {
  layerList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

resetLayerBtn.addEventListener("click", resetLayers);

fullscreenLayerBtn.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (layerPreviewPanel.requestFullscreen) {
    await layerPreviewPanel.requestFullscreen();
  } else {
    layerPreviewPanel.classList.toggle("fullscreen-fallback");
  }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenLayerBtn.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
});

setProgress();
setStatus("idle");
loadHistory();
