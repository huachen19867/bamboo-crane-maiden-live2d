import type { RigProject } from "../types/rig";
import { maxMouthOpenScaleLimit } from "./defaults";

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface RuntimeHtmlOptions {
  channelId?: string;
}

export function makeRuntimeHtml(project: RigProject, options: RuntimeHtmlOptions = {}): string {
  const title = `${project.name || "Auto Live2D"} Runtime`;
  const payload = escapeJsonForHtml(project);
  const optionsPayload = escapeJsonForHtml({
    channelId: options.channelId ?? ""
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, "Microsoft YaHei UI", system-ui, sans-serif;
      --bg: #101217;
      --panel: rgba(22, 26, 33, 0.86);
      --text: #eef3f8;
      --muted: #9ba7b4;
      --line: rgba(255,255,255,0.14);
      --accent: #34c6d3;
      --gold: #f5c84b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px),
        linear-gradient(0deg, rgba(255,255,255,0.045) 1px, transparent 1px),
        radial-gradient(circle at 50% 34%, rgba(52,198,211,0.22), transparent 34%),
        var(--bg);
      background-size: 44px 44px, 44px 44px, auto, auto;
      color: var(--text);
    }
    body.transparent {
      background: transparent;
    }
    body[data-bg="checker"] {
      background:
        linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255,255,255,0.08) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.08) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.08) 75%),
        var(--bg);
      background-position: 0 0, 0 12px, 12px -12px, -12px 0;
      background-size: 24px 24px;
    }
    body[data-bg="green"] { background: #00b140; }
    body[data-bg="white"] { background: #fff; color: #111820; }
    body[data-bg="black"] { background: #000; }
    body[data-bg="transparent"] { background: transparent; }
    button, input, select {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.08);
      color: var(--text);
      cursor: pointer;
    }
    button:hover { border-color: rgba(52,198,211,0.72); }
    .runtime-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 310px;
      min-height: 100vh;
    }
    .runtime-shell.panel-hidden {
      grid-template-columns: 1fr;
    }
    .runtime-shell.panel-hidden .runtime-panel {
      display: none;
    }
    .stage {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 100vh;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .stage.dragging {
      cursor: grabbing;
    }
    .avatar {
      position: relative;
      width: min(72vh, 72vw);
      aspect-ratio: var(--canvas-ratio, 1);
      transform-origin: 50% 50%;
      filter: drop-shadow(0 28px 36px rgba(0,0,0,0.32));
      overflow: visible;
      will-change: transform;
    }
    .layer {
      position: absolute;
      object-fit: contain;
      transform-origin: 50% 42%;
      pointer-events: none;
      user-select: none;
      will-change: opacity;
    }
    .widget {
      position: absolute;
      display: grid;
      place-items: center;
      border: 1px dashed rgba(245,200,75,0.74);
      border-radius: 7px;
      background: rgba(245,200,75,0.14);
      color: #fff4bd;
      font-size: 12px;
      pointer-events: none;
    }
    .runtime-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 100vh;
      overflow: auto;
      padding: 14px;
      border-left: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(12px);
    }
    .runtime-panel h1 {
      margin: 0;
      font-size: 17px;
    }
    .runtime-panel p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .panel-block {
      display: grid;
      gap: 9px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,0.055);
    }
    .slider-row {
      display: grid;
      grid-template-columns: 82px 1fr 42px;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .slider-row input { accent-color: var(--accent); }
    .slider-row output {
      color: var(--text);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge-row span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 7px;
      color: var(--muted);
      font-size: 11px;
    }
    .expression-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .expression-row button.active {
      border-color: rgba(52,198,211,0.78);
      background: rgba(52,198,211,0.16);
      color: var(--text);
    }
    .panel-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
  </style>
</head>
<body>
  <main class="runtime-shell" id="runtimeShell">
    <section class="stage" id="stage">
      <div class="avatar" id="avatar" aria-label="runtime avatar"></div>
    </section>
    <aside class="runtime-panel">
      <header class="panel-header">
        <div>
          <h1 id="modelName"></h1>
          <p>Standalone runtime export. Use transparent mode for OBS or browser source capture.</p>
        </div>
        <button id="togglePanel" type="button" title="Press H or double click the stage to show it again">隐藏</button>
      </header>
      <div class="panel-block">
        <select id="backgroundMode" aria-label="Background">
          <option value="checker">伪透明</option>
          <option value="green">绿幕</option>
          <option value="white">白幕</option>
          <option value="black">黑幕</option>
          <option value="transparent">透明</option>
        </select>
        <button id="toggleIdle" type="button">暂停 Idle</button>
      </div>
      <div class="panel-block">
        <button id="runtimeTrackingToggle" type="button">小窗面捕</button>
        <small id="runtimeTrackingStatus">等待编辑器面捕</small>
        <video id="runtimeTrackingVideo" playsinline muted hidden></video>
      </div>
      <div class="panel-block">
        <label class="slider-row">
          <span>缩放</span>
          <input id="avatarScale" type="range" min="0.35" max="2.2" step="0.01" value="1" />
          <output id="avatarScaleValue">100%</output>
        </label>
      </div>
      <div class="panel-block">
        <strong>参数</strong>
        <div id="controls"></div>
      </div>
      <div class="panel-block" id="expressionPanel" hidden>
        <strong>表情差分</strong>
        <div id="expressionControls"></div>
      </div>
      <div class="panel-block">
        <strong>模型信息</strong>
        <div class="badge-row" id="modelInfo"></div>
      </div>
    </aside>
  </main>
  <script id="rig-data" type="application/json">${payload}</script>
  <script id="runtime-options" type="application/json">${optionsPayload}</script>
  <script>
    const project = JSON.parse(document.getElementById("rig-data").textContent);
    const runtimeOptions = JSON.parse(document.getElementById("runtime-options").textContent || "{}");
    const runtimeChannelId = runtimeOptions.channelId || "";
    const runtimeShell = document.getElementById("runtimeShell");
    const stage = document.getElementById("stage");
    const avatar = document.getElementById("avatar");
    const controls = document.getElementById("controls");
    const expressionPanel = document.getElementById("expressionPanel");
    const expressionControls = document.getElementById("expressionControls");
    const modelInfo = document.getElementById("modelInfo");
    const modelName = document.getElementById("modelName");
    const backgroundMode = document.getElementById("backgroundMode");
    const avatarScaleInput = document.getElementById("avatarScale");
    const avatarScaleValue = document.getElementById("avatarScaleValue");
    const runtimeTrackingToggle = document.getElementById("runtimeTrackingToggle");
    const runtimeTrackingStatus = document.getElementById("runtimeTrackingStatus");
    const runtimeTrackingVideo = document.getElementById("runtimeTrackingVideo");
    const params = new Map(project.parameters.map((item) => [item.id, { ...item }]));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const runtimeOverscan = 0.28;
    const controlInputs = new Map();
    const expressionState = {
      active: {
        ...(project.expressionState?.active || {})
      }
    };
    let idle = true;
    let externalSyncUntil = 0;
    let runtimeEditorTrackingEnabled = Boolean(project.tracking?.enabled);
    let runtimeLastExternalStateAt = performance.now();
    let runtimeAutoTrackingRetryAt = 0;
    let localBackgroundOverride = false;
    const avatarOffset = { x: 0, y: 0 };
    let avatarScale = 1;
    const hairSpringStates = new Map();
    const initialBackground = project.stageBackground || "checker";
    setRuntimeBackground(initialBackground);

    modelName.textContent = project.name || "Auto Live2D Runtime";
    avatar.style.setProperty("--canvas-ratio", project.canvas.width + " / " + project.canvas.height);
    modelInfo.innerHTML = [
      project.canvas.width + "x" + project.canvas.height,
      project.layers.length + " layers",
      project.bones.length + " bones",
      project.physicsTemplates.length + " physics"
    ].map((text) => "<span>" + text + "</span>").join("");

    const layerImages = new Map();
    const sortedLayers = [...project.layers].sort((a, b) => a.z - b.z);
    const expressionDefaultGroup = "eye-expression";
    function expressionGroupForLayer(layer) {
      if (layer.attachment?.type !== "expression") return undefined;
      return layer.attachment.exclusiveGroup || expressionDefaultGroup;
    }
    function expressionKeyForLayer(layer) {
      return layer.attachment?.expressionKey || layer.id;
    }
    function isExpressionLayerActive(layer) {
      const group = expressionGroupForLayer(layer);
      if (!group) return true;
      return expressionState.active[group] === expressionKeyForLayer(layer);
    }
    function expressionLabel(key) {
      return String(key).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "expression";
    }
    function setParamValue(id, value, updateControl = true) {
      const parameter = params.get(id);
      const next = Number(value);
      if (!parameter || !Number.isFinite(next)) return;
      const clamped = clamp(next, Number(parameter.min), Number(parameter.max));
      parameter.value = clamped;
      if (!updateControl) return;
      const control = controlInputs.get(id);
      if (!control) return;
      control.input.value = String(clamped);
      control.output.value = Number(clamped).toFixed(2);
    }
    function setAvatarTransform() {
      avatar.style.transform =
        "translate(" + avatarOffset.x.toFixed(1) + "px, " + avatarOffset.y.toFixed(1) + "px) scale(" + avatarScale.toFixed(3) + ")";
    }
    function setAvatarScale(value) {
      avatarScale = clamp(Number(value), 0.35, 2.2);
      avatarScaleInput.value = String(avatarScale);
      avatarScaleValue.value = Math.round(avatarScale * 100) + "%";
      setAvatarTransform();
    }
    function setRuntimeBackground(value) {
      document.body.dataset.bg = value;
      backgroundMode.value = value;
    }
    const runtimeTrackingDefaults = {
      enabled: false,
      tier: "balanced",
      width: 960,
      height: 540,
      fps: 24,
      smoothing: 0.56,
      eyeYGain: 1.75,
      mouthOpenLimit: 0.72,
      poseEnabled: false,
      poseFps: 20,
      poseLimit: 1,
      armLimit: 1,
      armRotationReverse: { left: false, right: false },
      angleLimits: { x: 45, y: 45, z: 0 }
    };
    let runtimeTrackingSettings = mergeRuntimeTrackingSettings(project.tracking || {});
    let runtimeTrackingEnabled = false;
    let runtimeTrackingStarting = false;
    let runtimeTrackingSource = "";
    let runtimeTrackingFace = null;
    let runtimeTrackingPose = null;
    let runtimeTrackingPoseTier = "";
    let runtimeTrackingVisionModule = null;
    let runtimeTrackingVision = null;
    let runtimeTrackingDelegates = [];
    let runtimeTrackingConfidence = 0.4;
    let runtimeTrackingStream = null;
    let runtimeTrackingRaf = 0;
    let runtimeTrackingLastFrameAt = 0;
    let runtimeTrackingLastPoseAt = 0;
    let runtimeTrackingLastPoseEstimateAt = 0;
    let runtimeTrackingPoseBackoffUntil = 0;
    let runtimeTrackingLastPoseState = null;
    let runtimeTrackingCalibration = null;
    let runtimeTrackingArmCalibration = null;
    let runtimeTrackingArmCalibrationSamples = [];
    let runtimeTrackingSmoothed = null;
    let runtimePoseCanvas = null;
    let runtimePoseContext = null;
    const runtimeTrackingVisionUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
    const runtimeTrackingWasmRoot = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
    const runtimeTrackingFaceModelUrl = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
    const runtimeTrackingPoseModelUrls = {
      eco: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      balanced: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      quality: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
    };
    function updateRuntimeTrackingStatus(text) {
      runtimeTrackingStatus.textContent = text;
    }
    function mergeRuntimeTrackingSettings(settings) {
      const next = { ...runtimeTrackingDefaults, ...(settings || {}) };
      next.angleLimits = { ...runtimeTrackingDefaults.angleLimits, ...((settings && settings.angleLimits) || {}) };
      next.armRotationReverse = { ...runtimeTrackingDefaults.armRotationReverse, ...((settings && settings.armRotationReverse) || {}) };
      return next;
    }
    function runtimeDistance(a, b) {
      if (!a || !b) return 0;
      const dz = (a.z || 0) - (b.z || 0);
      return Math.hypot(a.x - b.x, a.y - b.y, dz);
    }
    function runtimeMidpoint(a, b) {
      return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: ((a.z || 0) + (b.z || 0)) * 0.5 };
    }
    function runtimeShouldLoadPose(settings) {
      return Boolean(settings && settings.poseEnabled && settings.tier !== "eco");
    }
    function runtimePoseIntervalMs(settings) {
      const cameraFps = clamp(settings.fps || 24, 10, 60);
      const targetPoseFps = clamp(settings.poseFps || 20, 5, 30);
      return 1000 / Math.max(1, Math.min(cameraFps, targetPoseFps));
    }
    function runtimeUsablePoseLandmark(point) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
      return point;
    }
    function runtimePreviewPosePoints(points) {
      return [11, 12, 13, 14, 15, 16, 23, 24]
        .map((index) => runtimeUsablePoseLandmark(points[index]))
        .filter(Boolean)
        .map((point) => ({ x: point.x, y: point.y }));
    }
    function runtimeArmLiftRatio(point, lowerY, verticalSpan) {
      if (!point) return 0;
      return clamp((lowerY - point.y) / Math.max(0.001, verticalSpan), 0, 1.6);
    }
    function runtimeArmRaiseFromPose(shoulder, elbow, wrist, lowerY, verticalSpan, horizontalScale) {
      const normalizedHorizontal = Math.max(0.001, horizontalScale);
      const candidates = [];
      const heightScore = (point, start, weight = 1) =>
        clamp(((runtimeArmLiftRatio(point, lowerY, verticalSpan) - start) / Math.max(0.001, 1 - start)) * weight, 0, 1);
      if (elbow) candidates.push(heightScore(elbow, 0.18, 0.78));
      if (wrist) candidates.push(heightScore(wrist, 0.08, 1));
      if (elbow && wrist) candidates.push(heightScore(runtimeMidpoint(elbow, wrist), 0.12, 0.95));
      const extendedPoint = wrist || elbow;
      if (extendedPoint) {
        const horizontalExtension = Math.abs(extendedPoint.x - shoulder.x) / normalizedHorizontal;
        const heightGate = clamp(runtimeArmLiftRatio(extendedPoint, lowerY, verticalSpan) + 0.15, 0, 1);
        candidates.push(clamp((horizontalExtension - 0.28) * 0.46, 0, 0.5) * heightGate);
      }
      return candidates.length ? clamp(Math.max(...candidates), 0, 1) : 0;
    }
    function runtimeDerivePose(points) {
      const leftShoulder = runtimeUsablePoseLandmark(points[11]);
      const rightShoulder = runtimeUsablePoseLandmark(points[12]);
      const leftElbow = runtimeUsablePoseLandmark(points[13]);
      const rightElbow = runtimeUsablePoseLandmark(points[14]);
      const leftWrist = runtimeUsablePoseLandmark(points[15]);
      const rightWrist = runtimeUsablePoseLandmark(points[16]);
      const leftHip = runtimeUsablePoseLandmark(points[23]);
      const rightHip = runtimeUsablePoseLandmark(points[24]);
      if (!leftShoulder || !rightShoulder) return { hasPose: false };
      const shoulderCenter = runtimeMidpoint(leftShoulder, rightShoulder);
      const shoulderSpan = Math.max(0.001, runtimeDistance(leftShoulder, rightShoulder));
      const hipCenter = leftHip && rightHip ? runtimeMidpoint(leftHip, rightHip) : { x: shoulderCenter.x, y: shoulderCenter.y + shoulderSpan, z: 0 };
      const torsoSpan = Math.max(shoulderSpan, runtimeDistance(shoulderCenter, hipCenter));
      const bodyLeanX = clamp((shoulderCenter.x - hipCenter.x) / torsoSpan * 2.35, -1, 1);
      const bodyLeanY = clamp(((shoulderCenter.y - hipCenter.y) / torsoSpan + 0.85) * 1.2, -1, 1);
      const lowerY = Math.max(hipCenter.y, shoulderCenter.y + shoulderSpan * 0.95);
      const verticalSpan = Math.max(shoulderSpan * 0.78, lowerY - shoulderCenter.y);
      const leftElbowLift = runtimeArmLiftRatio(leftElbow, leftShoulder.y + verticalSpan, verticalSpan);
      const leftWristLift = runtimeArmLiftRatio(leftWrist, leftShoulder.y + verticalSpan, verticalSpan);
      const rightElbowLift = runtimeArmLiftRatio(rightElbow, rightShoulder.y + verticalSpan, verticalSpan);
      const rightWristLift = runtimeArmLiftRatio(rightWrist, rightShoulder.y + verticalSpan, verticalSpan);
      const leftLiftFallback = clamp(Math.max(leftElbowLift * 0.78, leftWristLift) - 0.08, 0, 1);
      const rightLiftFallback = clamp(Math.max(rightElbowLift * 0.78, rightWristLift) - 0.08, 0, 1);
      const armLeft = Math.max(
        runtimeArmRaiseFromPose(leftShoulder, leftElbow, leftWrist, leftShoulder.y + verticalSpan, verticalSpan, shoulderSpan),
        leftLiftFallback
      );
      const armRight = Math.max(
        runtimeArmRaiseFromPose(rightShoulder, rightElbow, rightWrist, rightShoulder.y + verticalSpan, verticalSpan, shoulderSpan),
        rightLiftFallback
      );
      return {
        hasPose: true,
        bodyLeanX,
        bodyLeanY,
        armLeft,
        armRight,
        posePoints: runtimePreviewPosePoints(points)
      };
    }
    function runtimeCalibrateArmPose(poseState) {
      if (!poseState || !poseState.hasPose) return poseState;
      const rawLeft = clamp(poseState.armLeft || 0, 0, 1);
      const rawRight = clamp(poseState.armRight || 0, 0, 1);
      if (!runtimeTrackingArmCalibration) {
        runtimeTrackingArmCalibrationSamples.push({ left: rawLeft, right: rawRight });
        runtimeTrackingArmCalibrationSamples = runtimeTrackingArmCalibrationSamples.slice(-4);
        if (runtimeTrackingArmCalibrationSamples.length >= 4) {
          runtimeTrackingArmCalibration = {
            left: runtimeTrackingArmCalibrationSamples.reduce((sum, sample) => sum + sample.left, 0) / runtimeTrackingArmCalibrationSamples.length,
            right: runtimeTrackingArmCalibrationSamples.reduce((sum, sample) => sum + sample.right, 0) / runtimeTrackingArmCalibrationSamples.length
          };
        }
        return { ...poseState, armLeft: 0, armRight: 0 };
      }
      return {
        ...poseState,
        armLeft: clamp(rawLeft - runtimeTrackingArmCalibration.left, 0, 1),
        armRight: clamp(rawRight - runtimeTrackingArmCalibration.right, 0, 1)
      };
    }
    function runtimePoseFrame() {
      const sourceWidth = runtimeTrackingVideo.videoWidth || runtimeTrackingSettings.width || 960;
      const sourceHeight = runtimeTrackingVideo.videoHeight || runtimeTrackingSettings.height || 540;
      const aspect = sourceWidth / Math.max(1, sourceHeight);
      const targetWidth = runtimeTrackingSettings.tier === "quality" ? 384 : 320;
      const targetHeight = Math.round(clamp(targetWidth / Math.max(0.1, aspect), 180, runtimeTrackingSettings.tier === "quality" ? 288 : 240));
      if (!runtimePoseCanvas) {
        runtimePoseCanvas = document.createElement("canvas");
        runtimePoseContext = runtimePoseCanvas.getContext("2d", { willReadFrequently: false });
      }
      if (!runtimePoseCanvas || !runtimePoseContext) return runtimeTrackingVideo;
      if (runtimePoseCanvas.width !== targetWidth) runtimePoseCanvas.width = targetWidth;
      if (runtimePoseCanvas.height !== targetHeight) runtimePoseCanvas.height = targetHeight;
      runtimePoseContext.imageSmoothingEnabled = true;
      runtimePoseContext.imageSmoothingQuality = "medium";
      runtimePoseContext.drawImage(runtimeTrackingVideo, 0, 0, targetWidth, targetHeight);
      return runtimePoseCanvas;
    }
    function runtimeEyeAspectRatio(points, indexes) {
      const selected = indexes.map((index) => points[index]);
      const left = selected[0], upperOuter = selected[1], upperInner = selected[2], right = selected[3], lowerInner = selected[4], lowerOuter = selected[5];
      if (!left || !upperOuter || !upperInner || !right || !lowerInner || !lowerOuter) return 0.24;
      const vertical = (runtimeDistance(upperOuter, lowerOuter) + runtimeDistance(upperInner, lowerInner)) * 0.5;
      const horizontal = Math.max(0.001, runtimeDistance(left, right));
      return vertical / horizontal;
    }
    function runtimeIrisCenter(points, indexes) {
      const selected = indexes.map((index) => points[index]).filter(Boolean);
      if (!selected.length) return undefined;
      return {
        x: selected.reduce((sum, point) => sum + point.x, 0) / selected.length,
        y: selected.reduce((sum, point) => sum + point.y, 0) / selected.length
      };
    }
    function runtimeEyeVerticalDrive(iris, upper, lower, fallbackCenter) {
      if (!iris || !upper.length || !lower.length) return 0;
      const upperY = upper.reduce((sum, point) => sum + point.y, 0) / upper.length;
      const lowerY = lower.reduce((sum, point) => sum + point.y, 0) / lower.length;
      const centerY = (upperY + lowerY) * 0.5;
      const halfHeight = Math.max(0.001, (lowerY - upperY) * 0.5);
      return clamp((centerY - iris.y) / halfHeight, -1, 1) || clamp((fallbackCenter.y - iris.y) / halfHeight, -1, 1);
    }
    function deriveRuntimeFace(points, calibration) {
      const leftEyeOuter = points[33];
      const leftEyeInner = points[133];
      const rightEyeInner = points[362];
      const rightEyeOuter = points[263];
      const nose = points[1] || points[4];
      const chin = points[152];
      const forehead = points[10];
      const mouthTop = points[13];
      const mouthBottom = points[14];
      const mouthLeft = points[61];
      const mouthRight = points[291];
      if (!leftEyeOuter || !leftEyeInner || !rightEyeInner || !rightEyeOuter || !nose || !mouthTop || !mouthBottom) {
        return { hasFace: false };
      }
      const leftEye = runtimeMidpoint(leftEyeOuter, leftEyeInner);
      const rightEye = runtimeMidpoint(rightEyeInner, rightEyeOuter);
      const eyeCenter = runtimeMidpoint(leftEye, rightEye);
      const faceHeight = forehead && chin ? Math.max(0.001, runtimeDistance(forehead, chin)) : 0.35;
      const eyeSpan = Math.max(0.001, runtimeDistance(leftEyeOuter, rightEyeOuter));
      const roll = clamp(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) / 0.55, -1, 1);
      const yaw = clamp((nose.x - eyeCenter.x) / eyeSpan * 2.35, -1, 1);
      const pitch = clamp((nose.y - eyeCenter.y) / faceHeight * 3.35 - 0.66, -1, 1);
      const mouthWidth = mouthLeft && mouthRight ? Math.max(0.001, runtimeDistance(mouthLeft, mouthRight)) : eyeSpan * 0.3;
      const mouthOpen = clamp((runtimeDistance(mouthTop, mouthBottom) / mouthWidth - 0.04) / 0.52, 0, 1);
      const leftEar = runtimeEyeAspectRatio(points, [33, 160, 158, 133, 153, 144]);
      const rightEar = runtimeEyeAspectRatio(points, [362, 385, 387, 263, 373, 380]);
      const leftIris = runtimeIrisCenter(points, [468, 469, 470, 471, 472]);
      const rightIris = runtimeIrisCenter(points, [473, 474, 475, 476, 477]);
      const rawEyeX = leftIris && rightIris ? clamp(((leftIris.x - leftEye.x) + (rightIris.x - rightEye.x)) / eyeSpan * 12, -1, 1) : 0;
      const leftEyeY = runtimeEyeVerticalDrive(leftIris, [points[160], points[158]].filter(Boolean), [points[153], points[144]].filter(Boolean), leftEye);
      const rightEyeY = runtimeEyeVerticalDrive(rightIris, [points[385], points[387]].filter(Boolean), [points[373], points[380]].filter(Boolean), rightEye);
      const rawEyeY = leftIris && rightIris ? clamp((leftEyeY + rightEyeY) * 0.5, -1, 1) : 0;
      const mouthForm = mouthLeft && mouthRight ? clamp((mouthWidth / eyeSpan - 0.33) * 4, -1, 1) : 0;
      return {
        hasFace: true,
        yaw: clamp(yaw - ((calibration && calibration.yaw) || 0), -1, 1),
        pitch: clamp(pitch - ((calibration && calibration.pitch) || 0), -1, 1),
        roll: clamp(roll - ((calibration && calibration.roll) || 0), -1, 1),
        eyeX: clamp(rawEyeX - ((calibration && calibration.eyeX) || 0), -1, 1),
        eyeY: clamp(rawEyeY - ((calibration && calibration.eyeY) || 0), -1, 1),
        blinkLeft: clamp((0.23 - leftEar) / 0.12, 0, 1),
        blinkRight: clamp((0.23 - rightEar) / 0.12, 0, 1),
        mouthOpen,
        mouthForm,
        bodyLeanX: 0,
        bodyLeanY: 0,
        armLeft: 0,
        armRight: 0
      };
    }
    function smoothRuntimeTracking(next) {
      if (!runtimeTrackingSmoothed) {
        runtimeTrackingSmoothed = { ...next };
        return next;
      }
      const keep = clamp(runtimeTrackingSettings.smoothing || 0.56, 0, 0.92);
      const amount = 1 - keep;
      const fields = ["yaw", "pitch", "roll", "eyeX", "eyeY", "blinkLeft", "blinkRight", "mouthOpen", "mouthForm", "bodyLeanX", "bodyLeanY", "armLeft", "armRight"];
      const smoothed = { ...next };
      for (const field of fields) {
        smoothed[field] = (runtimeTrackingSmoothed[field] || 0) * keep + (next[field] || 0) * amount;
      }
      runtimeTrackingSmoothed = smoothed;
      return smoothed;
    }
    function applyRuntimeTrackingToParams(tracking) {
      const limits = runtimeTrackingSettings.angleLimits || runtimeTrackingDefaults.angleLimits;
      const eyeYGain = clamp(runtimeTrackingSettings.eyeYGain || 1.75, 0.5, 3);
      const mouthOpenLimit = clamp(runtimeTrackingSettings.mouthOpenLimit || 0.72, 0.05, 1);
      const poseLimit = clamp(runtimeTrackingSettings.poseLimit || 1, 0, 3);
      const armLimit = clamp(runtimeTrackingSettings.armLimit || 1, 0, 2);
      const mouthOpenDrive = Math.pow(clamp(tracking.mouthOpen || 0, 0, 1), 1.12) * 0.82;
      setParamValue("ParamAngleX", (tracking.yaw || 0) * Math.max(0, limits.x ?? 45));
      setParamValue("ParamAngleY", (tracking.pitch || 0) * Math.max(0, limits.y ?? 45));
      setParamValue("ParamAngleZ", (tracking.roll || 0) * Math.max(0, limits.z ?? 0));
      setParamValue("ParamBodyAngleX", (tracking.bodyLeanX || 0) * 6.5 * poseLimit);
      setParamValue("ParamBodyAngleY", (tracking.bodyLeanY || 0) * 4.2 * poseLimit);
      setParamValue("ParamBodyAngleZ", (tracking.roll || 0) * 1.15 * poseLimit);
      setParamValue("ParamEyeBallX", tracking.eyeX || 0);
      setParamValue("ParamEyeBallY", clamp((tracking.eyeY || 0) * eyeYGain, -1, 1));
      setParamValue("ParamEyeLOpen", 1 - (tracking.blinkLeft || 0));
      setParamValue("ParamEyeROpen", 1 - (tracking.blinkRight || 0));
      setParamValue("ParamMouthOpenY", clamp(mouthOpenDrive, 0, mouthOpenLimit));
      setParamValue("ParamMouthForm", tracking.mouthForm || 0);
      setParamValue("ParamArmLA", clamp((tracking.armLeft || 0) * armLimit, 0, 1));
      setParamValue("ParamArmRA", clamp((tracking.armRight || 0) * armLimit, 0, 1));
    }
    async function startRuntimeTracking(settings, source) {
      runtimeTrackingSettings = mergeRuntimeTrackingSettings(settings || runtimeTrackingSettings);
      const requestedSource = source || runtimeTrackingSource || "auto";
      runtimeTrackingSource = requestedSource;
      if (runtimeTrackingEnabled || runtimeTrackingStarting) return;
      runtimeTrackingStarting = true;
      runtimeTrackingToggle.textContent = "停止小窗面捕";
      updateRuntimeTrackingStatus(requestedSource === "auto" ? "编辑器后台，小窗接管面捕" : "加载小窗面捕");
      try {
        const visionModule = await import(runtimeTrackingVisionUrl);
        const vision = await visionModule.FilesetResolver.forVisionTasks(runtimeTrackingWasmRoot);
        const confidence = runtimeTrackingSettings.tier === "quality" ? 0.3 : runtimeTrackingSettings.tier === "eco" ? 0.5 : 0.4;
        const delegates = runtimeTrackingSettings.tier === "eco" ? ["CPU"] : ["GPU", "CPU"];
        runtimeTrackingVisionModule = visionModule;
        runtimeTrackingVision = vision;
        runtimeTrackingDelegates = delegates;
        runtimeTrackingConfidence = confidence;
        let lastError = undefined;
        for (const delegate of delegates) {
          try {
            runtimeTrackingFace = await visionModule.FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: runtimeTrackingFaceModelUrl, delegate },
              runningMode: "VIDEO",
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
              numFaces: 1,
              minFaceDetectionConfidence: confidence,
              minFacePresenceConfidence: confidence,
              minTrackingConfidence: confidence
            });
            break;
          } catch (error) {
            lastError = error;
            runtimeTrackingFace = null;
          }
        }
        if (!runtimeTrackingFace) throw lastError || new Error("runtime face model failed");
        runtimeTrackingStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { min: 320, ideal: runtimeTrackingSettings.width || 960, max: Math.max(runtimeTrackingSettings.width || 960, 1280) },
            height: { min: 240, ideal: runtimeTrackingSettings.height || 540, max: Math.max(runtimeTrackingSettings.height || 540, 720) },
            frameRate: { ideal: runtimeTrackingSettings.fps || 24, max: Math.max(runtimeTrackingSettings.fps || 24, 30) },
            facingMode: "user"
          },
          audio: false
        });
        runtimeTrackingVideo.srcObject = runtimeTrackingStream;
        await runtimeTrackingVideo.play();
        runtimeTrackingEnabled = true;
        runtimeTrackingStarting = false;
        runtimeTrackingCalibration = null;
        runtimeTrackingSmoothed = null;
        idle = false;
        updateRuntimeTrackingStatus(requestedSource === "auto" ? "小窗接管面捕运行中" : "小窗面捕运行中");
        if (runtimeShouldLoadPose(runtimeTrackingSettings)) {
          void loadRuntimePoseInBackground(visionModule, vision, delegates, confidence);
        }
        runtimeTrackingRaf = requestAnimationFrame(runtimeTrackingTick);
      } catch (error) {
        runtimeTrackingStarting = false;
        stopRuntimeTracking(false);
        if (requestedSource === "auto") runtimeAutoTrackingRetryAt = performance.now() + 5000;
        updateRuntimeTrackingStatus(error instanceof Error ? error.message : String(error));
      }
    }
    async function loadRuntimePoseInBackground(visionModule, vision, faceDelegates, confidence) {
      runtimeTrackingPose?.close?.();
      runtimeTrackingPose = null;
      const poseDelegates = runtimeTrackingSettings.tier === "quality" ? ["CPU", "GPU"] : faceDelegates;
      const modelAssetPath = runtimeTrackingPoseModelUrls[runtimeTrackingSettings.tier] || runtimeTrackingPoseModelUrls.balanced;
      let poseError = undefined;
      for (const delegate of poseDelegates) {
        if (!runtimeTrackingEnabled && !runtimeTrackingStarting) return;
        try {
          updateRuntimeTrackingStatus("加载小窗姿态模型（" + delegate + "）");
          runtimeTrackingPose = await visionModule.PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: confidence,
            minPosePresenceConfidence: confidence,
            minTrackingConfidence: confidence
          });
          runtimeTrackingPoseTier = runtimeTrackingSettings.tier;
          updateRuntimeTrackingStatus("小窗面捕运行中（姿态 " + delegate + "）");
          return;
        } catch (error) {
          poseError = error;
          runtimeTrackingPose?.close?.();
          runtimeTrackingPose = null;
          runtimeTrackingPoseTier = "";
        }
      }
      updateRuntimeTrackingStatus("小窗面捕运行中（姿态不可用：" + (poseError instanceof Error ? poseError.message : String(poseError)) + "）");
    }
    function stopRuntimeTracking(resetStatus = true) {
      runtimeTrackingEnabled = false;
      runtimeTrackingStarting = false;
      runtimeTrackingSource = "";
      cancelAnimationFrame(runtimeTrackingRaf);
      runtimeTrackingRaf = 0;
      runtimeTrackingFace?.close?.();
      runtimeTrackingFace = null;
      runtimeTrackingPose?.close?.();
      runtimeTrackingPose = null;
      runtimeTrackingPoseTier = "";
      runtimeTrackingVisionModule = null;
      runtimeTrackingVision = null;
      runtimeTrackingDelegates = [];
      runtimeTrackingStream?.getTracks().forEach((track) => track.stop());
      runtimeTrackingStream = null;
      runtimeTrackingVideo.srcObject = null;
      runtimeTrackingCalibration = null;
      runtimeTrackingArmCalibration = null;
      runtimeTrackingArmCalibrationSamples = [];
      runtimeTrackingLastPoseState = null;
      runtimeTrackingLastPoseAt = 0;
      runtimeTrackingLastPoseEstimateAt = 0;
      runtimeTrackingPoseBackoffUntil = 0;
      runtimeTrackingSmoothed = null;
      runtimeTrackingToggle.textContent = "小窗面捕";
      if (resetStatus) updateRuntimeTrackingStatus("已停止");
    }
    function runtimeTrackingTick(now) {
      if (!runtimeTrackingEnabled || !runtimeTrackingFace) return;
      const interval = 1000 / Math.max(1, runtimeTrackingSettings.fps || 24);
      if (now - runtimeTrackingLastFrameAt >= interval && runtimeTrackingVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        runtimeTrackingLastFrameAt = now;
        const result = runtimeTrackingFace.detectForVideo(runtimeTrackingVideo, now);
        const points = result.faceLandmarks && result.faceLandmarks[0];
        if (points) {
          const raw = deriveRuntimeFace(points);
          if (!runtimeTrackingCalibration && raw.hasFace) {
            runtimeTrackingCalibration = {
              yaw: raw.yaw || 0,
              pitch: raw.pitch || 0,
              roll: raw.roll || 0,
              eyeX: raw.eyeX || 0,
              eyeY: raw.eyeY || 0
            };
          }
          const next = deriveRuntimeFace(points, runtimeTrackingCalibration);
          if (runtimeTrackingPose && now >= runtimeTrackingPoseBackoffUntil && now - runtimeTrackingLastPoseEstimateAt >= runtimePoseIntervalMs(runtimeTrackingSettings)) {
            runtimeTrackingLastPoseEstimateAt = now;
            const poseStart = performance.now();
            try {
              const poseResult = runtimeTrackingPose.detectForVideo(runtimePoseFrame(), now);
              const poseCost = performance.now() - poseStart;
              if (poseCost > 42) runtimeTrackingPoseBackoffUntil = now + Math.min(900, Math.max(120, poseCost * 4));
              const posePoints = poseResult.landmarks && poseResult.landmarks[0];
              if (posePoints) {
                const poseState = runtimeCalibrateArmPose(runtimeDerivePose(posePoints));
                Object.assign(next, poseState);
                if (poseState.hasPose) runtimeTrackingLastPoseState = poseState;
                runtimeTrackingLastPoseAt = now;
              } else if (now - runtimeTrackingLastPoseAt < 650 && runtimeTrackingLastPoseState) {
                Object.assign(next, runtimeTrackingLastPoseState);
              }
            } catch (error) {
              runtimeTrackingPose?.close?.();
              runtimeTrackingPose = null;
              updateRuntimeTrackingStatus("小窗姿态已停用：" + (error instanceof Error ? error.message : String(error)));
            }
          } else if (runtimeTrackingPose && now - runtimeTrackingLastPoseAt < 650 && runtimeTrackingLastPoseState) {
            Object.assign(next, runtimeTrackingLastPoseState);
          }
          if (next.hasFace) {
            applyRuntimeTrackingToParams(smoothRuntimeTracking(next));
            updateRuntimeTrackingStatus(next.hasPose ? "Face/Pose OK" : "Face OK");
          }
        } else {
          updateRuntimeTrackingStatus("寻找脸部");
        }
      }
      runtimeTrackingRaf = requestAnimationFrame(runtimeTrackingTick);
    }
    function applyExternalState(state) {
      if (!state || state.type !== "auto-live2d:state") return;
      const receivedAt = performance.now();
      runtimeLastExternalStateAt = receivedAt;
      runtimeEditorTrackingEnabled = Boolean(state.tracking?.enabled);
      if (state.tracking?.settings) {
        runtimeTrackingSettings = mergeRuntimeTrackingSettings(state.tracking.settings);
        if (runtimeTrackingEnabled && runtimeTrackingVisionModule && runtimeTrackingVision) {
          if (runtimeShouldLoadPose(runtimeTrackingSettings)) {
            if (!runtimeTrackingPose || runtimeTrackingPoseTier !== runtimeTrackingSettings.tier) {
              void loadRuntimePoseInBackground(runtimeTrackingVisionModule, runtimeTrackingVision, runtimeTrackingDelegates, runtimeTrackingConfidence);
            }
          } else if (runtimeTrackingPose) {
            runtimeTrackingPose.close();
            runtimeTrackingPose = null;
            runtimeTrackingPoseTier = "";
            runtimeTrackingLastPoseState = null;
          }
        }
      }
      if (state.parameters && typeof state.parameters === "object") {
        if (state.tracking?.enabled && (runtimeTrackingEnabled || runtimeTrackingStarting)) stopRuntimeTracking(false);
        for (const [id, value] of Object.entries(state.parameters)) setParamValue(id, value);
        updateRuntimeTrackingStatus(state.tracking?.enabled ? "编辑器同步" : "参数同步");
      } else if (state.tracking?.enabled && !runtimeTrackingEnabled && !runtimeTrackingStarting) {
        updateRuntimeTrackingStatus("等待编辑器同步");
      } else if (state.tracking && runtimeTrackingSource === "auto") {
        stopRuntimeTracking(false);
      }
      if (state.expressionState?.active && typeof state.expressionState.active === "object") {
        expressionState.active = { ...state.expressionState.active };
        buildExpressionControls();
      }
      if (typeof state.stageBackground === "string" && !localBackgroundOverride) {
        setRuntimeBackground(state.stageBackground);
      }
      externalSyncUntil = receivedAt + 1200;
    }
    function buildExpressionControls() {
      const groups = new Map();
      for (const layer of sortedLayers) {
        const group = expressionGroupForLayer(layer);
        if (!group) continue;
        const key = expressionKeyForLayer(layer);
        const map = groups.get(group) || new Map();
        map.set(key, (map.get(key) || 0) + 1);
        groups.set(group, map);
      }
      if (!groups.size) return;
      expressionPanel.hidden = false;
      expressionControls.innerHTML = "";
      for (const [group, entries] of groups.entries()) {
        const row = document.createElement("div");
        row.className = "expression-row";
        const off = document.createElement("button");
        off.type = "button";
        off.textContent = "关闭";
        off.addEventListener("click", () => {
          delete expressionState.active[group];
          buildExpressionControls();
        });
        if (!expressionState.active[group]) off.classList.add("active");
        row.appendChild(off);
        for (const key of entries.keys()) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = expressionLabel(key);
          button.title = group;
          button.addEventListener("click", () => {
            expressionState.active[group] = key;
            buildExpressionControls();
          });
          if (expressionState.active[group] === key) button.classList.add("active");
          row.appendChild(button);
        }
        expressionControls.appendChild(row);
      }
    }
    for (const layer of sortedLayers) {
      const canvas = document.createElement("canvas");
      canvas.className = "layer";
      canvas.dataset.layerId = layer.id;
      canvas.dataset.kind = layer.kind;
      canvas.style.left = (-runtimeOverscan * 100) + "%";
      canvas.style.top = (-runtimeOverscan * 100) + "%";
      canvas.style.width = ((1 + runtimeOverscan * 2) * 100) + "%";
      canvas.style.height = ((1 + runtimeOverscan * 2) * 100) + "%";
      canvas.style.zIndex = Math.round(layer.z);
      avatar.appendChild(canvas);

      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        canvas.width = Math.ceil(project.canvas.width * (1 + runtimeOverscan * 2));
        canvas.height = Math.ceil(project.canvas.height * (1 + runtimeOverscan * 2));
      };
      image.src = layer.imageUrl;
      layerImages.set(layer.id, image);
    }
    buildExpressionControls();

    for (const widget of project.widgets) {
      const node = document.createElement("div");
      node.className = "widget";
      node.textContent = widget.name;
      node.style.left = widget.rect.x * 100 + "%";
      node.style.top = widget.rect.y * 100 + "%";
      node.style.width = widget.rect.width * 100 + "%";
      node.style.height = widget.rect.height * 100 + "%";
      node.style.zIndex = widget.z;
      avatar.appendChild(node);
    }

    for (const parameter of project.parameters) {
      const row = document.createElement("label");
      row.className = "slider-row";
      row.innerHTML = "<span></span><input type='range' /><output></output>";
      row.querySelector("span").textContent = parameter.label || parameter.id;
      const input = row.querySelector("input");
      const output = row.querySelector("output");
      input.min = parameter.min;
      input.max = parameter.max;
      input.step = parameter.max - parameter.min <= 2 ? "0.01" : "1";
      input.value = parameter.value;
      output.value = Number(parameter.value).toFixed(2);
      controlInputs.set(parameter.id, { input, output });
      input.addEventListener("input", () => {
        setParamValue(parameter.id, Number(input.value), false);
        output.value = Number(params.get(parameter.id)?.value ?? input.value).toFixed(2);
      });
      controls.appendChild(row);
    }

    backgroundMode.addEventListener("change", () => {
      localBackgroundOverride = true;
      setRuntimeBackground(backgroundMode.value);
    });
    avatarScaleInput.addEventListener("input", () => {
      setAvatarScale(avatarScaleInput.value);
    });
    runtimeTrackingToggle.addEventListener("click", () => {
      if (runtimeTrackingEnabled || runtimeTrackingStarting) {
        stopRuntimeTracking();
        return;
      }
      void startRuntimeTracking(runtimeTrackingSettings, "manual");
    });
    document.getElementById("toggleIdle").addEventListener("click", (event) => {
      idle = !idle;
      event.currentTarget.textContent = idle ? "暂停 Idle" : "播放 Idle";
    });

    document.getElementById("togglePanel").addEventListener("click", () => {
      runtimeShell.classList.add("panel-hidden");
    });
    stage.addEventListener("dblclick", () => {
      runtimeShell.classList.toggle("panel-hidden");
    });
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      const nextScale = avatarScale * Math.exp(-event.deltaY * 0.0012);
      setAvatarScale(nextScale);
    }, { passive: false });
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "h") runtimeShell.classList.toggle("panel-hidden");
    });

    let dragState = null;
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: avatarOffset.x,
        originY: avatarOffset.y
      };
      stage.classList.add("dragging");
      stage.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    stage.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      avatarOffset.x = dragState.originX + event.clientX - dragState.startX;
      avatarOffset.y = dragState.originY + event.clientY - dragState.startY;
      setAvatarTransform();
    });
    function endDrag(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState = null;
      stage.classList.remove("dragging");
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    if (runtimeChannelId && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel(runtimeChannelId);
      channel.addEventListener("message", (event) => applyExternalState(event.data));
      channel.postMessage({ type: "auto-live2d:runtime-ready" });
      setTimeout(() => channel.postMessage({ type: "auto-live2d:runtime-ready" }), 120);
      window.addEventListener("beforeunload", () => channel.close());
    }

    const headKinds = new Set(["backHair", "frontHair", "sideHair", "face", "eyebrow", "eyeWhite", "iris", "eyelash", "nose", "mouth", "ear", "accessory"]);
    const bodyKinds = new Set(["torso", "neck", "topWear", "bottomWear", "arm", "hand"]);
    function attachmentFamily(layer) {
      if (!layer.attachment?.type) return undefined;
      const parent = layer.parentBoneId;
      if (["head", "face", "hair", "hair-back", "hair-side", "hair-front", "accessory"].includes(parent)) return "head";
      if (["body", "neck", "cloth", "cloth-chest", "cloth-hips", "arm"].includes(parent)) return "body";
      if (parent === "root") return "root";
      return undefined;
    }
    function isLayerHeadPart(layer) {
      const family = attachmentFamily(layer);
      if (family) return family === "head";
      return headKinds.has(layer.kind);
    }
    function isLayerBodyPart(layer) {
      const family = attachmentFamily(layer);
      if (family) return family === "body";
      return bodyKinds.has(layer.kind);
    }
    const depthMode = project.depthMode || "manual";
    const depthTuning = {
      faceNeckBlend: 0.28,
      frontHairNeckBlend: 0.12,
      backHairNeckBlend: 0.18,
      frontHairCloneNeckBlend: 0.2,
      backHairCloneNeckBlend: 0.26,
      headProxyZOffset: 0,
      headProxyDepthScale: 1,
      chinShrink: 0.24,
      eyeVerticalOvershoot: 0.5,
      mouthOpenScaleLimit: 0.75,
      ...(project.depthTuning || {})
    };
    const dynamicsTuning = {
      frontHairInertia: 0.52,
      backHairInertia: 0.66,
      accessoryInertia: 0.56,
      ...(project.dynamicsTuning || {})
    };
    const headRollPivot = {
      x: clamp(project.headRollPivot?.x ?? 0.5, 0, 1),
      y: clamp(project.headRollPivot?.y ?? 0.43, 0, 1)
    };
    const normalized = (id) => {
      const p = params.get(id);
      if (!p || p.max === p.min) return 0;
      return ((p.value - p.defaultValue) / Math.max(Math.abs(p.max - p.defaultValue), Math.abs(p.min - p.defaultValue))) || 0;
    };
    const open = (id) => {
      const p = params.get(id);
      return p ? (p.value - p.min) / (p.max - p.min) : 0;
    };
    const drive = (id) => {
      const p = params.get(id);
      if (!p || p.max === p.min) return 0;
      if (p.min >= 0 && p.max <= 1) return clamp((p.value - p.min) / (p.max - p.min), 0, 1);
      return normalized(id);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (edge0, edge1, value) => {
      const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const rectCenter = (rect) => ({ x: rect.x + rect.width * 0.5, y: rect.y + rect.height * 0.5 });
    const neckPseudoDepth = 0.006;
    function isOpenMouthExpressionLayer(layer) {
      if (layer.kind !== "mouth" || layer.attachment?.type !== "expression") return false;
      const key = String(layer.attachment.expressionKey || layer.attachment.triggerKey || layer.id || layer.sourceName || "").toLowerCase();
      return layer.attachment.exclusiveGroup === "mouth-expression" || key.includes("open-mouth") || key.includes("open_mouth");
    }
    function expressionMouthOpenAmount() {
      return smoothstep(0.08, 0.28, open("ParamMouthOpenY"));
    }
    function expressionMouthOpacity(layer) {
      return isOpenMouthExpressionLayer(layer) ? smoothstep(0.06, 0.16, open("ParamMouthOpenY")) : 1;
    }
    function applyExpressionMouthClose(layer, points) {
      if (!isOpenMouthExpressionLayer(layer)) return points;
      const amount = expressionMouthOpenAmount();
      const minScale = 0.14;
      const scaleY = minScale + (1 - minScale) * amount;
      const center = rectCenter(layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 });
      return points.map((point) => ({
        x: point.x,
        y: center.y + (point.y - center.y) * scaleY
      }));
    }
    function paddedRect(rect, padXRatio, padYRatio) {
      const padX = rect.width * padXRatio;
      const padY = rect.height * padYRatio;
      const x = clamp(rect.x - padX, 0, 1);
      const y = clamp(rect.y - padY, 0, 1);
      return { x, y, width: Math.min(1 - x, rect.width + padX * 2), height: Math.min(1 - y, rect.height + padY * 2) };
    }
    function mixKey(a, b, t) {
      return {
        value: lerp(a.value, b.value, t),
        translate: { x: lerp(a.translate.x, b.translate.x, t), y: lerp(a.translate.y, b.translate.y, t) },
        rotate: lerp(a.rotate, b.rotate, t),
        scale: { x: lerp(a.scale.x, b.scale.x, t), y: lerp(a.scale.y, b.scale.y, t) },
        opacity: a.opacity !== undefined || b.opacity !== undefined ? lerp(a.opacity ?? 1, b.opacity ?? 1, t) : undefined
      };
    }
    function sampleKeyframes(keys, value) {
      if (!keys?.length) return undefined;
      const sorted = [...keys].sort((a, b) => a.value - b.value);
      if (value <= sorted[0].value) return sorted[0];
      if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1];
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = sorted[i], b = sorted[i + 1];
        if (value < a.value || value > b.value) continue;
        return mixKey(a, b, (value - a.value) / Math.max(0.0001, b.value - a.value));
      }
      return sorted[0];
    }
    function uvForPoint(layer, point) {
      const base = layer.naturalBounds || { x: 0, y: 0, width: 1, height: 1 };
      return {
        u: (point.x - base.x) / Math.max(0.0001, base.width),
        v: (point.y - base.y) / Math.max(0.0001, base.height)
      };
    }
    function proceduralDepth(kind, u, v) {
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.48) * 2;
      const dome = Math.sqrt(Math.max(0, 1 - dx * dx * 0.75 - dy * dy * 0.62));
      if (kind === "nose") return 0.082 + dome * 0.105;
      if (["iris", "eyeWhite", "eyelash", "eyebrow"].includes(kind)) return 0.056 + dome * 0.064;
      if (kind === "mouth") return 0.046 + dome * 0.054;
      if (kind === "face" || kind === "ear") return 0.04 + dome * 0.078;
      if (kind === "frontHair" || kind === "accessory") {
        const tip = Math.pow(clamp(v, 0, 1), 1.8) * (0.62 + 0.38 * Math.cos(dx * Math.PI * 0.5));
        return kind === "accessory" ? 0.034 + dome * 0.046 + tip * 0.026 : 0.035 + dome * 0.052 + tip * 0.048;
      }
      if (kind === "sideHair") return 0.025 + dome * 0.038 + Math.pow(clamp(v, 0, 1), 1.7) * 0.04;
      if (kind === "backHair") return -0.028 + dome * 0.014;
      if (["neck", "topWear", "bottomWear", "torso"].includes(kind)) return 0.006;
      return 0;
    }
    function hairNeckBlendForLayer(layer) {
      if (layer.attachment?.cloneKind === "backHair") return depthTuning.backHairCloneNeckBlend;
      if (layer.attachment?.cloneKind === "frontHair") return depthTuning.frontHairCloneNeckBlend;
      if (layer.kind === "backHair") return depthTuning.backHairNeckBlend;
      return depthTuning.frontHairNeckBlend;
    }
    function tuneHeadDepthPlacement(layer, depth) {
      if (!isLayerHeadPart(layer)) return depth;
      const thickness = clamp(depthTuning.headProxyDepthScale, 0.25, 2.5);
      const offset = clamp(depthTuning.headProxyZOffset, -0.3, 0.3);
      return neckPseudoDepth + (depth - neckPseudoDepth) * thickness + offset;
    }
    function tunedLayerDepth(layer, depth, uv) {
      const kind = layer.kind;
      if (layer.attachment?.depthAnchor === "neck") return neckPseudoDepth;
      if (kind === "face" || kind === "ear") {
        const lowerFace = 0.52 + smoothstep(0.35, 1, uv.v) * 0.48;
        return tuneHeadDepthPlacement(layer, lerp(depth, neckPseudoDepth, clamp(depthTuning.faceNeckBlend * lowerFace, 0, 0.85)));
      }
      if (kind === "backHair") {
        return tuneHeadDepthPlacement(layer, lerp(depth, neckPseudoDepth, clamp(hairNeckBlendForLayer(layer), 0, 0.85)));
      }
      if (kind === "frontHair" || kind === "sideHair" || kind === "accessory") {
        const lowerStrand = smoothstep(0.28, 1, uv.v);
        const sideStrand = 0.55 + Math.abs(uv.u - 0.5) * 0.9;
        return tuneHeadDepthPlacement(layer, lerp(depth, neckPseudoDepth, clamp(hairNeckBlendForLayer(layer) * lowerStrand * sideStrand, 0, 0.85)));
      }
      return tuneHeadDepthPlacement(layer, depth);
    }
    function chinShrinkAmount(layer, point, motionAmount) {
      if (layer.kind !== "face") return 0;
      const uv = uvForPoint(layer, point);
      return smoothstep(0.58, 1, uv.v) * clamp(depthTuning.chinShrink, 0, 1) * motionAmount * 0.32;
    }
    function applyChinShrink(layer, sourcePoint, projectedPoint, center, motionAmount) {
      const amount = chinShrinkAmount(layer, sourcePoint, motionAmount);
      if (amount <= 0) return projectedPoint;
      const bounds = layer.naturalBounds || layer.bounds || { width: 1 };
      const chinCenter = { x: center.x, y: center.y + bounds.height * 0.12 };
      return {
        x: chinCenter.x + (projectedPoint.x - chinCenter.x) * (1 - amount),
        y: chinCenter.y + (projectedPoint.y - chinCenter.y) * (1 - amount)
      };
    }
    const baseEyeSockets = { left: eyeSocketBounds("left"), right: eyeSocketBounds("right") };
    function currentHeadProxyCenter() {
      const centers = [baseEyeSockets.left, baseEyeSockets.right].filter(Boolean).map(rectCenter);
      if (!centers.length) return { x: 0.5, y: 0.34 };
      return {
        x: clamp(centers.reduce((sum, point) => sum + point.x, 0) / centers.length, 0.18, 0.82),
        y: clamp(centers.reduce((sum, point) => sum + point.y, 0) / centers.length, 0.16, 0.48)
      };
    }
    function proxyHeadDepth(layer, point) {
      const headCenter = currentHeadProxyCenter();
      const hair = ["frontHair", "backHair", "sideHair"].includes(layer.kind);
      const rx = hair ? 0.36 : 0.3;
      const ry = hair ? 0.36 : 0.34;
      const nx = (point.x - headCenter.x) / rx;
      const ny = (point.y - headCenter.y) / ry;
      const ellipsoid = Math.sqrt(Math.max(0, 1 - nx * nx * 0.56 - ny * ny * 0.64));
      const uv = uvForPoint(layer, point);
      const local = proceduralDepth(layer.kind, uv.u, uv.v);
      if (layer.kind === "frontHair" || layer.kind === "accessory") {
        const tipBoost = Math.pow(clamp(uv.v, 0, 1), 1.7) * 0.026;
        const depth = layer.kind === "accessory" ? 0.014 + ellipsoid * 0.035 + tipBoost * 0.5 : 0.016 + ellipsoid * 0.04 + tipBoost;
        return tunedLayerDepth(layer, depth, uv);
      }
      if (layer.kind === "sideHair") return tunedLayerDepth(layer, 0.012 + ellipsoid * 0.034 + Math.pow(clamp(uv.v, 0, 1), 1.6) * 0.022, uv);
      if (layer.kind === "backHair") return tunedLayerDepth(layer, -0.035 + ellipsoid * 0.014, uv);
      if (isLayerHeadPart(layer)) return tunedLayerDepth(layer, local * 0.22 + ellipsoid * 0.074, uv);
      return local;
    }
    function headShellForKind(kind) {
      if (kind === "backHair") return { rx: 0.39, ry: 0.4, zSign: -1, shell: 1.015, zOffset: -0.012, depthScale: 0.034, reliefScale: 0.008, tipScale: 0 };
      if (kind === "accessory") return { rx: 0.385, ry: 0.4, zSign: 1, shell: 1.012, zOffset: 0.004, depthScale: 0.058, reliefScale: 0.02, tipScale: 0.004 };
      if (kind === "frontHair") return { rx: 0.39, ry: 0.405, zSign: 1, shell: 1.018, zOffset: 0.004, depthScale: 0.074, reliefScale: 0.026, tipScale: 0.008 };
      if (kind === "sideHair") return { rx: 0.4, ry: 0.41, zSign: 1, shell: 1.015, zOffset: 0.001, depthScale: 0.06, reliefScale: 0.024, tipScale: 0.007 };
      if (kind === "ear") return { rx: 0.34, ry: 0.36, zSign: 1, shell: 1, zOffset: -0.003, depthScale: 0.054, reliefScale: 0.018, tipScale: 0 };
      return { rx: 0.35, ry: 0.385, zSign: 1, shell: 1, zOffset: 0.008, depthScale: 0.096, reliefScale: 0.028, tipScale: 0 };
    }
    function proxyHeadPoint3d(layer, point) {
      const center = currentHeadProxyCenter();
      const shell = headShellForKind(layer.kind);
      const rx = shell.rx * shell.shell;
      const ry = shell.ry * shell.shell;
      const localX = point.x - center.x;
      const localY = point.y - center.y;
      const nx = localX / rx;
      const ny = localY / ry;
      const surface = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const uv = uvForPoint(layer, point);
      const localRelief = proceduralDepth(layer.kind, uv.u, uv.v) * shell.reliefScale;
      const hairTipRelief = layer.kind === "frontHair" || layer.kind === "sideHair" || layer.kind === "accessory" ? Math.pow(clamp(uv.v, 0, 1), 1.55) * shell.tipScale : 0;
      const z = tunedLayerDepth(layer, shell.zSign * surface * shell.depthScale + shell.zOffset + localRelief + hairTipRelief, uv);
      return { x: localX, y: localY, z, center };
    }
    function projectProxyHeadPoint(layer, point, yaw, pitch) {
      const p = proxyHeadPoint3d(layer, point);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const z0 = p.z - neckPseudoDepth;
      const x1 = p.x * cy + z0 * sy;
      const z1 = z0 * cy - p.x * sy;
      const y1 = p.y * cp - z1 * sp;
      const z2 = z1 * cp + p.y * sp + neckPseudoDepth;
      const motionAmount = clamp((Math.abs(yaw) + Math.abs(pitch)) * 1.7, 0, 1);
      const perspective = 1 / Math.max(0.86, 1 - z2 * 0.5 * motionAmount);
      const projected = {
        x: p.center.x + x1 * perspective,
        y: p.center.y + y1 * perspective
      };
      return applyChinShrink(layer, point, projected, p.center, motionAmount);
    }
    function localDepth(layer, pointIndex, point) {
      if (depthMode === "proxyHead" && isLayerHeadPart(layer)) return proxyHeadDepth(layer, point);
      const saved = layer.mesh?.depths?.[pointIndex];
      const uv = uvForPoint(layer, point);
      if (typeof saved === "number") {
        const depth = depthMode === "manual" || !depthMode ? compactManualDepth(layer.kind, saved) : saved;
        return tunedLayerDepth(layer, depth, uv);
      }
      return tunedLayerDepth(layer, proceduralDepth(layer.kind, uv.u, uv.v), uv);
    }
    function compactManualDepth(kind, depth) {
      if (kind === "backHair") return depth * 0.42 - 0.014;
      if (kind === "frontHair" || kind === "sideHair" || kind === "accessory") return depth * 0.42 + 0.006;
      if (kind === "face" || kind === "ear") return depth * 0.58 + 0.014;
      if (kind === "nose") return depth * 0.7 + 0.02;
      if (["iris", "eyeWhite", "eyelash", "eyebrow", "mouth"].includes(kind)) return depth * 0.64 + 0.017;
      return depth * 0.42;
    }
    function sideMatches(parameter, layer) {
      if (parameter === "ParamAngleZ" && isLayerHeadPart(layer)) return false;
      if (parameter === "ParamArmLA") return layer.side !== "right";
      if (parameter === "ParamArmRA") return layer.side !== "left";
      return true;
    }
    function kindInfluence(kind, depth = 0) {
      const depthBias = clamp((depth + 0.2) / 0.4, 0, 1);
      if (kind === "frontHair" || kind === "accessory") return 0.92 + depthBias * 0.18;
      if (kind === "sideHair") return 0.84 + depthBias * 0.16;
      if (kind === "backHair") return 0.7 + depthBias * 0.08;
      if (["nose", "iris", "mouth"].includes(kind)) return 0.94 + depthBias * 0.1;
      if (["eyeWhite", "eyelash", "eyebrow"].includes(kind)) return 0.9 + depthBias * 0.1;
      if (kind === "face" || kind === "ear") return 0.82 + depthBias * 0.12;
      if (kind === "topWear" || kind === "bottomWear" || kind === "torso") return 0.4;
      if (kind === "neck") return 0;
      if (kind === "arm" || kind === "hand") return 0.28;
      return 0;
    }
    function projectPoint(point, center, depth, yaw, pitch, influence, pivotDepth = 0) {
      const x = point.x - center.x;
      const y = point.y - center.y;
      const z = depth * influence;
      const z0 = z - pivotDepth;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const rotatedX = x * cy + z0 * sy;
      const rotatedZ = z0 * cy - x * sy;
      const rotatedY = y * cp - rotatedZ * sp;
      const finalZ = rotatedZ * cp + y * sp + pivotDepth;
      const motionAmount = clamp((Math.abs(yaw) + Math.abs(pitch)) * 1.6, 0, 1);
      const perspective = 1 / Math.max(0.56, 1 - finalZ * 1.68 * motionAmount);
      return {
        x: point.x + (center.x + rotatedX * perspective - point.x) * influence,
        y: point.y + (center.y + rotatedY * perspective - point.y) * influence
      };
    }
    function transformPivot(layer) {
      if (layer.pivot) return layer.pivot;
      const bounds = layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      if (layer.kind === "arm") {
        const centerX = bounds.x + bounds.width * 0.5;
        return {
          x: centerX >= 0.5 ? bounds.x - bounds.width * 0.12 : bounds.x + bounds.width * 1.12,
          y: bounds.y + bounds.height * 0.045
        };
      }
      if (layer.kind === "hand") return { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.08 };
      return rectCenter(bounds);
    }
    function transformPointsWithMotion(layer, points, motion) {
      const width = Math.max(1, project.canvas.width);
      const height = Math.max(1, project.canvas.height);
      const bounds = layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const usePivot = Boolean(layer.pivot) || layer.kind === "arm" || layer.kind === "hand";
      const center = motion.pivotX !== undefined && motion.pivotY !== undefined ? { x: motion.pivotX, y: motion.pivotY } : usePivot ? transformPivot(layer) : rectCenter(bounds);
      const rad = motion.rotate * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const dx = motion.x / width;
      const dy = motion.y / height;
      return points.map((point) => {
        const localX = (point.x - center.x) * (motion.sx ?? 1);
        const localY = (point.y - center.y) * (motion.sy ?? 1);
        return {
          x: center.x + localX * cos - localY * sin + dx,
          y: center.y + localX * sin + localY * cos + dy
        };
      });
    }
    function topWearPhysicsWeight(layer, point) {
      if (layer.kind !== "topWear") return 1;
      const bounds = layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const v = clamp((point.y - bounds.y) / Math.max(0.0001, bounds.height), 0, 1);
      const t = clamp((v - 0.22) / 0.5, 0, 1);
      return t * t * (3 - 2 * t);
    }
    function applyMotion(layer, points, motion) {
      if (!motion) return points;
      if (layer.kind === "topWear" && motion.baseX !== undefined && motion.baseY !== undefined && motion.baseRotate !== undefined) {
        const basePoints = transformPointsWithMotion(layer, points, {
          x: motion.baseX,
          y: motion.baseY,
          rotate: motion.baseRotate,
          sx: motion.baseSx ?? motion.sx,
          sy: motion.baseSy ?? motion.sy,
          pivotX: motion.pivotX,
          pivotY: motion.pivotY
        });
        const physicsPoints = transformPointsWithMotion(layer, basePoints, {
          x: motion.physicsX ?? 0,
          y: motion.physicsY ?? 0,
          rotate: motion.physicsRotate ?? 0,
          sx: 1,
          sy: 1,
          pivotX: motion.pivotX,
          pivotY: motion.pivotY
        });
        return basePoints.map((point, index) => {
          const weight = topWearPhysicsWeight(layer, points[index]);
          return {
            x: point.x + (physicsPoints[index].x - point.x) * weight,
            y: point.y + (physicsPoints[index].y - point.y) * weight
          };
        });
      }
      return transformPointsWithMotion(layer, points, motion);
    }
    function dynamicTailStrength(kind) {
      if (kind === "frontHair" || kind === "sideHair") return clamp(dynamicsTuning.frontHairInertia, 0, 1.5);
      if (kind === "backHair") return clamp(dynamicsTuning.backHairInertia, 0, 1.5);
      if (kind === "accessory") return clamp(dynamicsTuning.accessoryInertia, 0, 1.5);
      return 0;
    }
    function layerInertiaScale(layer) {
      if (typeof layer.inertiaScale === "number") return clamp(layer.inertiaScale, 0, 2.4);
      const bounds = layer.naturalBounds || layer.bounds || { width: 0.3, height: 0.3 };
      const areaScale = Math.sqrt(Math.max(0.0001, bounds.width * bounds.height) / 0.09);
      const kindBase = layer.kind === "accessory" ? 0.82 : layer.kind === "backHair" ? 1.08 : 1;
      return clamp(areaScale * kindBase, 0.55, 1.65);
    }
    function tailWeightForKind(layer, point, rootY, pivot) {
      const bounds = layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const u = clamp((point.x - bounds.x) / Math.max(0.0001, bounds.width), 0, 1);
      const rootRatio = (rootY - bounds.y) / Math.max(0.0001, bounds.height);
      const v = clamp((point.y - rootY) / Math.max(0.0001, bounds.height * (1 - rootRatio)), 0, 1);
      const sideWeight = 0.35 + 0.65 * smoothstep(0.32, 0.98, Math.abs(u - 0.5) * 2);
      if (layer.kind === "frontHair" || layer.kind === "sideHair") {
        const tip = Math.pow(smoothstep(0.08, 1, v), layer.kind === "sideHair" ? 2.05 : 1.85);
        return tip * sideWeight;
      }
      if (layer.kind === "accessory") {
        const distanceX = Math.abs((point.x - pivot.x) / Math.max(0.0001, bounds.width * 0.5));
        return Math.pow(smoothstep(0.04, 1, v), 1.65) * (0.45 + 0.55 * clamp(distanceX, 0, 1));
      }
      const outerWeight = 0.55 + 0.45 * Math.abs((point.x - pivot.x) / Math.max(0.0001, bounds.width * 0.5));
      return Math.pow(smoothstep(0.12, 1, v), 2.25) * outerWeight;
    }
    function bendDynamicTail(layer, points, motion) {
      const strength = dynamicTailStrength(layer.kind) * layerInertiaScale(layer);
      if (!motion || strength <= 0) return points;
      const width = Math.max(1, project.canvas.width);
      const height = Math.max(1, project.canvas.height);
      const tailRotateDegrees = motion.tailRotate ?? motion.rotate * 0.18 * strength;
      const tailX = ((motion.tailX ?? motion.x * 0.16 * strength) / width) * 0.72;
      const tailY = ((motion.tailY ?? Math.abs(motion.x) * 0.04 * strength) / height) * 0.48;
      const tailRotate = tailRotateDegrees * Math.PI / 180;
      const rollStretch = clamp(Math.abs(tailRotateDegrees) / 38, 0, 1) * clamp(strength, 0, 2.4);
      if (Math.abs(tailX) < 0.00001 && Math.abs(tailY) < 0.00001 && Math.abs(tailRotate) < 0.00001 && rollStretch < 0.00001) return points;
      const bounds = layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const rootY = layer.kind === "frontHair" || layer.kind === "sideHair"
        ? bounds.y + bounds.height * 0.18
        : layer.kind === "accessory"
          ? bounds.y + bounds.height * 0.12
          : bounds.y + bounds.height * 0.2;
      const pivot = { x: bounds.x + bounds.width * 0.5, y: rootY };
      const cos = Math.cos(tailRotate), sin = Math.sin(tailRotate);
      const lagSign = tailRotateDegrees >= 0 ? -1 : 1;
      const stretchBase = rollStretch * 0.026;
      return points.map((point) => {
        const weight = tailWeightForKind(layer, point, rootY, pivot);
        const u = clamp((point.x - bounds.x) / Math.max(0.0001, bounds.width), 0, 1);
        const localX = point.x - pivot.x;
        const localY = point.y - pivot.y;
        const rotatedX = pivot.x + localX * (1 - weight) + (localX * cos - localY * sin) * weight;
        const rotatedY = pivot.y + localY * (1 - weight) + (localX * sin + localY * cos) * weight;
        const tipWeight = Math.pow(weight, 1.15);
        const sideWeight = 0.45 + 0.55 * Math.abs(u - 0.5) * 2;
        const stretchX = lagSign * stretchBase * tipWeight * sideWeight;
        const stretchY = Math.abs(stretchBase) * tipWeight * 0.42;
        const shearX = lagSign * localY * stretchBase * tipWeight * 0.45;
        return { x: rotatedX + tailX * weight + stretchX + shearX, y: rotatedY + tailY * weight + stretchY };
      });
    }
    function meshBounds(mesh) {
      const xs = mesh.points.map((point) => point.x);
      const ys = mesh.points.map((point) => point.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX, y: minY, width: Math.max(0.0001, maxX - minX), height: Math.max(0.0001, maxY - minY) };
    }
    function growEyeRect(rect) {
      if (!rect) return undefined;
      return paddedRect(rect, 0.04, 0.075);
    }
    function irisFallbackEyeRect(rect) {
      return rect ? growEyeRect(paddedRect(rect, 0.2, 0.16)) : undefined;
    }
    function eyeSocketBounds(side) {
      const source =
        project.layers.find((layer) => layer.kind === "eyeWhite" && layer.side === side) ||
        project.layers.find((layer) => layer.kind === "eyelash" && layer.side === side);
      const iris = project.layers.find((layer) => layer.kind === "iris" && layer.side === side);
      const rect = source?.naturalBounds || source?.bounds;
      return growEyeRect(rect) || irisFallbackEyeRect(iris?.naturalBounds || iris?.bounds);
    }
    function clipEyeSocket(context, rect, width, height, overscan = 0) {
      const cx = (rect.x + overscan + rect.width * 0.5) * width;
      const cy = (rect.y + overscan + rect.height * 0.5) * height;
      const rx = rect.width * width * 0.5;
      const ry = rect.height * height * 0.42;
      context.beginPath();
      context.moveTo(cx - rx, cy);
      context.bezierCurveTo(cx - rx * 0.72, cy - ry, cx + rx * 0.72, cy - ry, cx + rx, cy);
      context.bezierCurveTo(cx + rx * 0.72, cy + ry, cx - rx * 0.72, cy + ry, cx - rx, cy);
      context.closePath();
      context.clip();
    }
    let eyeSockets = { ...baseEyeSockets };
    function eyeOpenForLayer(layer) {
      if (layer.side === "left") return open("ParamEyeLOpen");
      if (layer.side === "right") return open("ParamEyeROpen");
      return Math.min(open("ParamEyeLOpen"), open("ParamEyeROpen"));
    }
    function socketForLayer(layer) {
      if (layer.side === "right") return eyeSockets.right;
      if (layer.side === "left") return eyeSockets.left;
      if (eyeSockets.left && eyeSockets.right) {
        return {
          x: Math.min(eyeSockets.left.x, eyeSockets.right.x),
          y: Math.min(eyeSockets.left.y, eyeSockets.right.y),
          width: Math.max(eyeSockets.left.x + eyeSockets.left.width, eyeSockets.right.x + eyeSockets.right.width) - Math.min(eyeSockets.left.x, eyeSockets.right.x),
          height: Math.max(eyeSockets.left.y + eyeSockets.left.height, eyeSockets.right.y + eyeSockets.right.height) - Math.min(eyeSockets.left.y, eyeSockets.right.y)
        };
      }
      return eyeSockets.left || eyeSockets.right;
    }
    function applyBlinkDeform(layer, points) {
      if (!["eyelash", "eyeWhite", "iris"].includes(layer.kind)) return points;
      const close = 1 - eyeOpenForLayer(layer);
      if (close <= 0.0001) return points;
      const socket = socketForLayer(layer) || layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 };
      const bounds = layer.naturalBounds || layer.bounds || socket;
      const upperLidY = socket.y + socket.height * 0.24;
      const lowerLidY = socket.y + socket.height * 0.76;
      const closeLine = lerp(upperLidY, lowerLidY, close);
      if (layer.kind === "iris") {
        const irisClose = smoothstep(0.58, 1, close);
        if (irisClose <= 0.0001) return points;
        const centerY = socket.y + socket.height * 0.5;
        const squash = 1 - irisClose * 0.22;
        const drop = irisClose * socket.height * 0.035;
        return points.map((point) => {
          const uv = uvForPoint(layer, point);
          const topMask = 1 - smoothstep(0.38, 0.95, uv.v);
          const y = centerY + (point.y - centerY) * squash + drop * topMask;
          return { x: point.x, y: clamp(y, bounds.y - bounds.height * 0.12, bounds.y + bounds.height * 1.12) };
        });
      }
      if (layer.kind === "eyelash") {
        return points.map((point) => {
          const uv = uvForPoint(layer, point);
          const upperWeight = 1 - smoothstep(0.42, 0.92, uv.v);
          const lowerWeight = smoothstep(0.58, 1, uv.v) * 0.18;
          return { x: point.x, y: lerp(point.y, closeLine, upperWeight * close) - lowerWeight * close * socket.height * 0.08 };
        });
      }
      const centerY = socket.y + socket.height * 0.5;
      const squash = 1 - close * 0.62;
      const drop = close * socket.height * 0.16;
      return points.map((point) => {
        const uv = uvForPoint(layer, point);
        const topMask = 1 - smoothstep(0.38, 0.95, uv.v);
        const y = centerY + (point.y - centerY) * squash + drop * topMask;
        return { x: point.x, y: clamp(y, bounds.y - bounds.height * 0.12, bounds.y + bounds.height * 1.12) };
      });
    }
    function clampIris(layer, points) {
      if (layer.kind !== "iris") return points;
      const socket = socketForLayer(layer);
      if (!socket) return points;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const irisMinX = Math.min(...xs), irisMaxX = Math.max(...xs);
      const irisMinY = Math.min(...ys), irisMaxY = Math.max(...ys);
      const irisWidth = irisMaxX - irisMinX;
      const irisHeight = irisMaxY - irisMinY;
      const irisCenterX = (irisMinX + irisMaxX) * 0.5;
      const irisCenterY = (irisMinY + irisMaxY) * 0.5;
      const socketCenter = rectCenter(socket);
      const padX = Math.min(socket.width * 0.035, 3 / Math.max(1, project.canvas.width));
      const padY = Math.min(socket.height * 0.045, 2 / Math.max(1, project.canvas.height));
      const innerWidth = Math.max(0.0001, socket.width - padX * 2);
      const innerHeight = Math.max(0.0001, socket.height - padY * 2);
      const scale = Math.min(1, (innerWidth * 1.45) / Math.max(0.0001, irisWidth), (innerHeight * 1.45) / Math.max(0.0001, irisHeight));
      const scaled = points.map((point) => ({
        x: irisCenterX + (point.x - irisCenterX) * scale,
        y: irisCenterY + (point.y - irisCenterY) * scale
      }));
      const fitWidth = irisWidth * scale;
      const fitHeight = irisHeight * scale;
      const centerRangeX = Math.max(0, innerWidth - fitWidth * 0.44);
      const centerRangeY = Math.max(0, innerHeight - fitHeight * 0.72);
      const targetCenterX = socketCenter.x + normalized("ParamEyeBallX") * centerRangeX * 0.34;
      const targetCenterY = socketCenter.y - normalized("ParamEyeBallY") * (centerRangeY * 0.42 + fitHeight * clamp(depthTuning.eyeVerticalOvershoot, 0, 1) * 0.35);
      const minCenterX = socket.x + padX + fitWidth * 0.18;
      const maxCenterX = socket.x + socket.width - padX - fitWidth * 0.18;
      const verticalOvershoot = fitHeight * clamp(depthTuning.eyeVerticalOvershoot, 0, 1) * 0.35;
      const minCenterY = socket.y + padY + fitHeight * 0.28 - verticalOvershoot;
      const maxCenterY = socket.y + socket.height - padY - fitHeight * 0.28 + verticalOvershoot;
      const nextCenterX = minCenterX <= maxCenterX ? clamp(targetCenterX, minCenterX, maxCenterX) : socketCenter.x;
      const nextCenterY = minCenterY <= maxCenterY ? clamp(targetCenterY, minCenterY, maxCenterY) : socketCenter.y;
      const dx = nextCenterX - irisCenterX;
      const dy = nextCenterY - irisCenterY;
      return scaled.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    }
    function applyLocalLayerTransform(layer, points) {
      const scale = clamp(layer.localScale ?? 1, 0.05, 4);
      const rotation = layer.localRotation ?? 0;
      const normalizedRotation = ((rotation % 360) + 360) % 360;
      if (Math.abs(scale - 1) < 0.0001 && Math.abs(normalizedRotation) < 0.0001) return points;
      const center = rectCenter(layer.naturalBounds || layer.bounds || { x: 0, y: 0, width: 1, height: 1 });
      const rad = rotation * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      return points.map((point) => {
        const localX = (point.x - center.x) * scale;
        const localY = (point.y - center.y) * scale;
        return {
          x: center.x + localX * cos - localY * sin,
          y: center.y + localX * sin + localY * cos
        };
      });
    }
    function deformedMesh(layer, motion) {
      const mesh = layer.mesh || { rows: 2, cols: 2, points: [] };
      const center = transformPivot(layer);
      const keyformed = applyLocalLayerTransform(layer, (mesh.points || []).map((point) => ({ ...point })));
      for (const deformer of layer.deformers || []) {
        if (!sideMatches(deformer.parameter, layer)) continue;
        const rawDrive = drive(deformer.parameter);
        const mouthLimit = clamp(depthTuning.mouthOpenScaleLimit, 0, ${maxMouthOpenScaleLimit});
        const isMouthOpen = layer.kind === "mouth" && deformer.parameter === "ParamMouthOpenY";
        const deformerDrive = layer.kind === "mouth" && deformer.parameter === "ParamMouthOpenY"
          ? rawDrive * Math.min(mouthLimit, 1)
          : rawDrive;
        const key = sampleKeyframes(deformer.keyframes, deformerDrive);
        if (!key) continue;
        const rad = key.rotate * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const extraMouthOpen = isMouthOpen ? Math.max(0, mouthLimit - 1) * rawDrive : 0;
        const scaleX = key.scale.x + extraMouthOpen * 0.12;
        const scaleY = key.scale.y + extraMouthOpen * 0.68;
        const translateY = isMouthOpen ? 0 : key.translate.y;
        for (let i = 0; i < keyformed.length; i += 1) {
          const point = keyformed[i];
          const localX = (point.x - center.x) * scaleX;
          const localY = (point.y - center.y) * scaleY;
          keyformed[i] = {
            x: center.x + localX * cos - localY * sin + key.translate.x,
            y: center.y + localX * sin + localY * cos + translateY
          };
        }
      }
      const mouthClosed = applyExpressionMouthClose(layer, keyformed);
      const headYaw = normalized("ParamAngleX") * 0.46;
      const headPitch = normalized("ParamAngleY") * -0.36;
      const bodyYaw = normalized("ParamBodyAngleX") * 0.07;
      const bodyPitch = normalized("ParamBodyAngleY") * -0.055;
      const followsHead = isLayerHeadPart(layer);
      const followsBody = isLayerBodyPart(layer);
      const pivot = followsHead ? currentHeadProxyCenter() : followsBody ? { x: 0.5, y: 0.58 } : center;
      const yaw = followsHead ? headYaw + bodyYaw * 0.65 : followsBody ? bodyYaw : 0;
      const pitch = followsHead ? headPitch + bodyPitch * 0.5 : followsBody ? bodyPitch : 0;
      const projected = mouthClosed.map((point, index) => {
        if (depthMode === "proxyHead" && followsHead) {
          return projectProxyHeadPoint(layer, point, yaw, pitch);
        }
        const depth = localDepth(layer, index, point);
        const projectedPoint = projectPoint(point, pivot, depth, yaw, pitch, kindInfluence(layer.kind, depth), followsHead ? neckPseudoDepth : 0);
        return applyChinShrink(layer, point, projectedPoint, pivot, clamp((Math.abs(yaw) + Math.abs(pitch)) * 1.6, 0, 1));
      });
      const moved = applyMotion(layer, projected, motion);
      const tailBent = bendDynamicTail(layer, moved, motion);
      const blinked = applyBlinkDeform(layer, tailBent);
      const constrained = clampIris(layer, blinked);
      return {
        ...mesh,
        points: constrained
      };
    }
    function effectiveBreath(t) {
      const manual = open("ParamBreath");
      return manual > 0.01 ? manual : 0.5 + Math.sin(t * 1.45) * 0.5;
    }
    function layerCenter(layer) {
      const bounds = layer.naturalBounds || { x: 0, y: 0, width: 1, height: 1 };
      return { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
    }
    function parentRotationOffset(layer, rotateDegrees) {
      if (Math.abs(rotateDegrees) < 0.0001) return { x: 0, y: 0 };
      const pivot = { x: 0.5, y: 0.52 };
      const center = layerCenter(layer);
      const localX = (center.x - pivot.x) * project.canvas.width;
      const localY = (center.y - pivot.y) * project.canvas.height;
      const rad = rotateDegrees * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return { x: localX * cos - localY * sin - localX, y: localX * sin + localY * cos - localY };
    }
    function headPivot() {
      return headRollPivot;
    }
    function inertiaForLayer(layer) {
      const layerScale = layerInertiaScale(layer);
      if (layer.kind === "frontHair" || layer.kind === "sideHair") return clamp(dynamicsTuning.frontHairInertia * layerScale, 0, 2.4);
      if (layer.kind === "backHair") return clamp(dynamicsTuning.backHairInertia * layerScale, 0, 2.4);
      if (layer.kind === "accessory") return clamp(dynamicsTuning.accessoryInertia * layerScale, 0, 2.4);
      return 1;
    }
    function tailFactorForLayer(layer) {
      const heightFactor = Math.pow(clamp((layer.naturalBounds?.height || 0.1) / 0.4, 0.28, 1), 0.5);
      const layerScale = layerInertiaScale(layer);
      if (layer.kind === "frontHair" || layer.kind === "sideHair") return heightFactor * clamp(dynamicsTuning.frontHairInertia * layerScale, 0, 2.4);
      if (layer.kind === "backHair") return heightFactor * clamp(dynamicsTuning.backHairInertia * layerScale, 0, 2.4);
      if (layer.kind === "accessory") return heightFactor * 0.82 * clamp(dynamicsTuning.accessoryInertia * layerScale, 0, 2.4);
      return 0;
    }
    function rootPhysicsScaleForLayer(layer) {
      if (layer.kind === "frontHair") return 0.14;
      if (layer.kind === "sideHair") return 0.18;
      if (layer.kind === "backHair") return 0.22;
      if (layer.kind === "accessory") return 0.2;
      return 1;
    }
    function physicsOffset(layer, t) {
      const template = project.physicsTemplates.find((item) => item.id === layer.physicsTemplateId);
      if (!template) return { x: 0, y: 0, rotate: 0, tailX: 0, tailY: 0, tailRotate: 0 };
      const inertia = inertiaForLayer(layer);
      const xDrive = template.input.reduce((sum, id) => sum + (id === "ParamBreath" ? effectiveBreath(t) * 0.35 : normalized(id)), 0) / Math.max(1, template.input.length);
      const zDrive = template.input.includes("ParamAngleZ") ? normalized("ParamAngleZ") : 0;
      const sway = Math.sin(t * (0.8 + template.stiffness * 2.4) + layer.z * 0.03) * template.wind;
      const neckDampen = layer.kind === "neck" ? 0.24 : 1;
      const tailFactor = tailFactorForLayer(layer);
      const tailSway = tailFactor ? Math.sin(t * (0.95 + (1 - template.stiffness) * 1.1) + layer.z * 0.061) * template.wind * (1 - template.drag * 0.18) : 0;
      return {
        x: (xDrive * (1 - template.stiffness) + sway) * 18 * neckDampen * inertia,
        y: (Math.abs(xDrive) * template.gravity.y + sway * 0.3) * 12 * neckDampen * inertia,
        rotate: (xDrive * 7 + sway * 9) * (1 - template.drag * 0.35) * neckDampen * inertia,
        tailX: (xDrive * 10 + zDrive * 16 + tailSway * 36) * tailFactor,
        tailY: (Math.abs(xDrive) * template.gravity.y * 3 + Math.abs(zDrive) * template.gravity.y * 3.2 + Math.abs(tailSway) * 8) * tailFactor,
        tailRotate: (xDrive * 5 + zDrive * 18 + tailSway * 18) * tailFactor
      };
    }
    function expandTriangle(points, amount) {
      const center = {
        x: (points[0].x + points[1].x + points[2].x) / 3,
        y: (points[0].y + points[1].y + points[2].y) / 3
      };
      return points.map((point) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const length = Math.hypot(dx, dy) || 1;
        return {
          x: point.x + dx / length * amount,
          y: point.y + dy / length * amount
        };
      });
    }
    function isHairDynamicLayer(layer) {
      return layer.kind === "frontHair" || layer.kind === "sideHair" || layer.kind === "backHair" || layer.kind === "accessory";
    }
    function springValue(value, velocity, target, dt, stiffness, damping) {
      const nextVelocity = (velocity + (target - value) * stiffness * dt) * Math.exp(-damping * dt);
      return { value: value + nextVelocity * dt, velocity: nextVelocity };
    }
    function applyHairSpringMotion(layer, motion, t) {
      if (!isHairDynamicLayer(layer)) return motion;
      const target = {
        tailX: motion.tailX || 0,
        tailY: motion.tailY || 0,
        tailRotate: motion.tailRotate || 0
      };
      const mass = clamp(layerInertiaScale(layer), 0.45, 2.4);
      const baseStiffness = layer.kind === "backHair" ? 58 : layer.kind === "sideHair" ? 68 : 76;
      const stiffness = baseStiffness / Math.sqrt(mass);
      const damping = (layer.kind === "backHair" ? 6.8 : 7.8) / Math.sqrt(mass);
      const current = hairSpringStates.get(layer.id);
      if (!current) {
        hairSpringStates.set(layer.id, { time: t, ...target, velocityX: 0, velocityY: 0, velocityRotate: 0 });
        return motion;
      }
      const dt = clamp(t - current.time, 1 / 120, 1 / 24);
      const x = springValue(current.tailX, current.velocityX, target.tailX, dt, stiffness, damping);
      const y = springValue(current.tailY, current.velocityY, target.tailY, dt, stiffness * 0.82, damping * 0.95);
      const rotate = springValue(current.tailRotate, current.velocityRotate, target.tailRotate, dt, stiffness * 0.72, damping * 0.9);
      const next = {
        time: t,
        tailX: x.value,
        tailY: y.value,
        tailRotate: rotate.value,
        velocityX: x.velocity,
        velocityY: y.velocity,
        velocityRotate: rotate.velocity
      };
      hairSpringStates.set(layer.id, next);
      return { ...motion, tailX: next.tailX, tailY: next.tailY, tailRotate: next.tailRotate };
    }
    function drawTriangle(context, image, source, target) {
      const expandedSource = expandTriangle(source, 0.35);
      const expandedTarget = expandTriangle(target, 0.65);
      context.save();
      context.beginPath();
      context.moveTo(expandedTarget[0].x, expandedTarget[0].y);
      context.lineTo(expandedTarget[1].x, expandedTarget[1].y);
      context.lineTo(expandedTarget[2].x, expandedTarget[2].y);
      context.closePath();
      context.clip();

      const s0 = expandedSource[0], s1 = expandedSource[1], s2 = expandedSource[2];
      const d0 = expandedTarget[0], d1 = expandedTarget[1], d2 = expandedTarget[2];
      const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
      if (Math.abs(denom) < 0.00001) {
        context.restore();
        return;
      }
      const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
      const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
      const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
      const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
      const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
      const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;
      context.transform(a, b, c, d, e, f);
      context.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
      context.restore();
    }
    function drawLayerMesh(canvas, image, layer, mesh, clipRect) {
      const imageWidth = Math.max(1, image.naturalWidth || image.width || 1);
      const imageHeight = Math.max(1, image.naturalHeight || image.height || 1);
      const baseWidth = Math.max(1, project.canvas.width);
      const baseHeight = Math.max(1, project.canvas.height);
      const width = Math.ceil(baseWidth * (1 + runtimeOverscan * 2));
      const height = Math.ceil(baseHeight * (1 + runtimeOverscan * 2));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, width, height);
      if (!image.complete || !image.naturalWidth) return;
      if (clipRect) {
        context.save();
        clipEyeSocket(context, clipRect, baseWidth, baseHeight, runtimeOverscan);
      }

      const rows = mesh?.rows || layer.mesh?.rows || 2;
      const cols = mesh?.cols || layer.mesh?.cols || 2;
      const points = mesh?.points || layer.mesh?.points || [];
      const base = layer.naturalBounds || { x: 0, y: 0, width: 1, height: 1 };
      const targetPoint = (index) => {
        const point = points[index] || { x: base.x, y: base.y };
        return {
          x: (point.x + runtimeOverscan) * baseWidth,
          y: (point.y + runtimeOverscan) * baseHeight
        };
      };
      const sourcePoint = (col, row) => ({
        x: (col / Math.max(1, cols - 1)) * imageWidth,
        y: (row / Math.max(1, rows - 1)) * imageHeight
      });
      const cellDepth = (indices) => indices.reduce((sum, index) => sum + ((mesh?.projectedDepths?.[index] ?? mesh?.depths?.[index] ?? 0)), 0) / indices.length;
      const cells = [];

      for (let row = 0; row < rows - 1; row += 1) {
        for (let col = 0; col < cols - 1; col += 1) {
          const indices = [row * cols + col, row * cols + col + 1, (row + 1) * cols + col, (row + 1) * cols + col + 1];
          cells.push({ indices, depth: cellDepth(indices) });
        }
      }
      cells.sort((a, b) => a.depth - b.depth);
      const sourceForIndex = (index) => sourcePoint(index % cols, Math.floor(index / cols));
      for (const cell of cells) {
        const [i00, i10, i01, i11] = cell.indices;
        drawTriangle(context, image, [sourceForIndex(i00), sourceForIndex(i10), sourceForIndex(i11)], [targetPoint(i00), targetPoint(i10), targetPoint(i11)]);
        drawTriangle(context, image, [sourceForIndex(i00), sourceForIndex(i11), sourceForIndex(i01)], [targetPoint(i00), targetPoint(i11), targetPoint(i01)]);
      }
      if (clipRect) context.restore();
    }
    function kindBase(layer, t) {
      const kind = layer.kind;
      const headX = normalized("ParamAngleX");
      const headY = normalized("ParamAngleY");
      const headRoll = params.get("ParamAngleZ")?.value || 0;
      const bodyX = normalized("ParamBodyAngleX");
      const bodyY = normalized("ParamBodyAngleY");
      const bodyZ = normalized("ParamBodyAngleZ");
      const breath = effectiveBreath(t);
      const mouth = open("ParamMouthOpenY");
      const armL = open("ParamArmLA");
      const armR = open("ParamArmRA");
      const followsHead = isLayerHeadPart(layer);
      const followsBody = isLayerBodyPart(layer);
      const torsoCarrier = { x: bodyX * 5, y: bodyY * -1.6 + Math.sin(breath * Math.PI) * 1.8, rotate: bodyZ * 0.8 };
      const parentArc = parentRotationOffset(layer, torsoCarrier.rotate);
      const bodyCarrier = { x: torsoCarrier.x + parentArc.x, y: torsoCarrier.y + parentArc.y, rotate: torsoCarrier.rotate };
      const pivot = headPivot();
      const headCarrier = followsHead ? { x: bodyCarrier.x + headX * 4.5, y: bodyCarrier.y + headY * -3.3, rotate: bodyCarrier.rotate + headRoll, pivotX: pivot.x, pivotY: pivot.y } : { x: 0, y: 0, rotate: 0 };
      if (layer.attachment?.type) {
        if (followsHead) return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
        if (followsBody) return { x: bodyCarrier.x, y: bodyCarrier.y, rotate: bodyCarrier.rotate, sx: 1, sy: 1 };
        return { x: 0, y: 0, rotate: 0, sx: 1, sy: 1 };
      }
      if (["face", "ear", "nose"].includes(kind)) return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (["eyeWhite", "eyelash", "eyebrow"].includes(kind)) return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (kind === "iris") return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (kind === "mouth") return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (kind === "frontHair" || kind === "accessory") return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (kind === "sideHair" || kind === "backHair") return { x: headCarrier.x, y: headCarrier.y, rotate: headCarrier.rotate, sx: 1, sy: 1, pivotX: headCarrier.pivotX, pivotY: headCarrier.pivotY };
      if (kind === "neck") return { x: bodyCarrier.x, y: bodyCarrier.y + Math.sin(breath * Math.PI) * 0.08, rotate: bodyCarrier.rotate, sx: 1, sy: 1 + Math.sin(breath * Math.PI) * 0.002 };
      if (["topWear", "bottomWear", "torso"].includes(kind)) return { x: bodyCarrier.x, y: bodyCarrier.y, rotate: bodyCarrier.rotate, sx: 1, sy: 1 + Math.sin(breath * Math.PI) * 0.012 };
      if (kind === "arm" || kind === "hand") {
        const arm = layer.side === "left" ? armL : layer.side === "right" ? armR : Math.max(armL, armR);
        const sideSign = layer.side === "right" ? -1 : layer.side === "left" ? 1 : 0;
        const armReverse = runtimeTrackingSettings.armRotationReverse || (project.tracking && project.tracking.armRotationReverse) || {};
        const reverse = (layer.side === "left" && armReverse.left) || (layer.side === "right" && armReverse.right);
        const direction = reverse ? -sideSign : sideSign;
        return { x: bodyCarrier.x, y: bodyCarrier.y, rotate: bodyCarrier.rotate + direction * arm * 40, sx: 1, sy: 1 };
      }
      return { x: 0, y: 0, rotate: 0, sx: 1, sy: 1 };
    }
    function layerMotion(layer, t) {
      const base = kindBase(layer, t);
      const phys = physicsOffset(layer, t);
      const rootPhysicsScale = rootPhysicsScaleForLayer(layer);
      return applyHairSpringMotion(layer, {
        x: base.x + phys.x * rootPhysicsScale,
        y: base.y + phys.y * rootPhysicsScale,
        rotate: base.rotate + phys.rotate * rootPhysicsScale,
        sx: base.sx,
        sy: base.sy,
        baseX: base.x,
        baseY: base.y,
        baseRotate: base.rotate,
        baseSx: base.sx,
        baseSy: base.sy,
        physicsX: phys.x * rootPhysicsScale,
        physicsY: phys.y * rootPhysicsScale,
        physicsRotate: phys.rotate * rootPhysicsScale,
        tailX: phys.tailX,
        tailY: phys.tailY,
        tailRotate: phys.tailRotate,
        pivotX: base.pivotX,
        pivotY: base.pivotY
      }, t);
    }
    function tick(now) {
      const t = now / 1000;
      const wallNow = performance.now();
      if (
        runtimeEditorTrackingEnabled &&
        !runtimeTrackingEnabled &&
        !runtimeTrackingStarting &&
        wallNow > runtimeAutoTrackingRetryAt &&
        wallNow - runtimeLastExternalStateAt > 1500
      ) {
        runtimeAutoTrackingRetryAt = wallNow + 2500;
        void startRuntimeTracking(runtimeTrackingSettings, "auto");
      }
      if (idle && !runtimeTrackingEnabled && !runtimeTrackingStarting && wallNow > externalSyncUntil) {
        setParamValue("ParamBreath", 0.5 + Math.sin(t * 1.6) * 0.5);
        setParamValue("ParamAngleX", Math.sin(t * 0.45) * 8);
        setParamValue("ParamAngleY", Math.sin(t * 0.38 + 1.4) * 5);
        setParamValue("ParamAngleZ", Math.sin(t * 0.32 + 0.3) * 4);
      }
      const mouth = open("ParamMouthOpenY");
      const socketMeshes = project.layers
        .filter((layer) => layer.kind === "eyeWhite" || layer.kind === "eyelash")
        .map((layer) => ({ layer, mesh: deformedMesh(layer, layerMotion(layer, t)) }));
      const socketForSide = (side) => {
        const item =
          socketMeshes.find((candidate) => candidate.layer.kind === "eyeWhite" && candidate.layer.side === side) ||
          socketMeshes.find((candidate) => candidate.layer.kind === "eyelash" && candidate.layer.side === side);
        return item ? growEyeRect(meshBounds(item.mesh)) : eyeSocketBounds(side);
      };
      eyeSockets = { left: socketForSide("left"), right: socketForSide("right") };
      for (const layer of project.layers) {
        const node = avatar.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"]');
        if (!node) continue;
        if (!isExpressionLayerActive(layer)) {
          node.style.opacity = 0;
          node.getContext("2d")?.clearRect(0, 0, node.width, node.height);
          continue;
        }
        const image = layerImages.get(layer.id);
        const motion = layerMotion(layer, t);
        const clipRect = layer.kind === "iris" ? (layer.side === "right" ? eyeSockets.right : layer.side === "left" ? eyeSockets.left : undefined) : undefined;
        if (image) drawLayerMesh(node, image, layer, deformedMesh(layer, motion), clipRect);
      let opacity = layer.visible ? layer.opacity : 0;
      const eyeOpen = eyeOpenForLayer(layer);
      if (layer.kind === "eyeWhite") opacity *= Math.max(0.34, 0.58 + eyeOpen * 0.42);
      if (layer.kind === "iris") opacity *= eyeOpen >= 0.16 ? 1 : 0.18 + clamp(eyeOpen / 0.16, 0, 1) * 0.82;
      if (layer.kind === "eyelash") opacity *= 1;
      if (isOpenMouthExpressionLayer(layer)) opacity *= expressionMouthOpacity(layer);
      else if (layer.kind === "mouth") opacity *= 0.72 + mouth * 0.28;
      node.style.opacity = opacity;
      node.style.transform = "none";
    }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  </script>
</body>
</html>`;
}
