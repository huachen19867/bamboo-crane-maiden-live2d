import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  Bone,
  Box,
  Camera,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  Layers,
  Moon,
  MousePointer2,
  PictureInPicture,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Upload,
  Wand2
} from "lucide-react";
import { boneLabel, kindLabel } from "./lib/classify";
import { deformedMeshForLayer, isLayerHeadPart } from "./lib/deform3d";
import { applyDepthCanvasToProject, readDepthMapFile, rebuildProxyDepths } from "./lib/depthMap";
import { defaultBones, defaultDepthTuning, defaultDynamicsTuning, defaultHeadRollPivot, defaultParameters, defaultPhysicsTemplates, defaultTrackingSettings, maxMouthOpenScaleLimit } from "./lib/defaults";
import { makeFinishedPack, readFinishedPack } from "./lib/finishedPack";
import { defaultPivotForKind, makeMeshWithDensity } from "./lib/mesh";
import { loadDevSamplePsd, importPsdFile, type SamplePsdPreset } from "./lib/psdImport";
import { applyTrackingToParameters, layerPreviewMotion, layerPreviewStyle } from "./lib/preview";
import { makeReplacementPack } from "./lib/replacementPack";
import { makeRuntimeHtml } from "./lib/runtimeExport";
import { applyAutoSafetyLimits } from "./lib/safetyLimits";
import { attachSampleCompanionLayers } from "./lib/sampleAttachments";
import { applyTemplateToProject, makeTemplate, readProjectFile, readTemplateFile } from "./lib/template";
import { emptyTrackingState, TrackingController } from "./lib/tracking";
import type { ImportReport, MeshBinding, ParameterId, ParameterSnapshot, PhysicsTemplate, Point, PsdLayerAsset, Rect, RigParameter, RigProject, StageBackgroundMode, TemplateApplyReport, TrackingSettings, TrackingState, Widget } from "./types/rig";

type ToolMode = "select" | "bone" | "mesh" | "physics" | "widget";
type DragState =
  | { type: "bone"; id: string }
  | { type: "mesh"; layerId: string; pointIndex: number }
  | { type: "pivot"; layerId: string }
  | { type: "headRollPivot" }
  | { type: "widget"; id: string }
  | null;

const sampleProject: RigProject = {
  version: 1,
  name: "等待导入 PSD",
  canvas: { width: 768, height: 768 },
  source: { fileName: "", importedAt: new Date().toISOString(), layerCount: 0 },
  layers: [],
  bones: structuredClone(defaultBones),
  parameters: structuredClone(defaultParameters),
  physicsTemplates: structuredClone(defaultPhysicsTemplates),
  widgets: [],
  depthMode: "manual",
  depthTuning: structuredClone(defaultDepthTuning),
  dynamicsTuning: structuredClone(defaultDynamicsTuning),
  parameterSnapshots: [],
  stageBackground: "checker",
  headRollPivot: structuredClone(defaultHeadRollPivot),
  expressionState: { active: {} },
  tracking: structuredClone(defaultTrackingSettings)
};

const localDraftKey = "auto-live2d-studio:draft:v1";

function trackingCaptureKey(settings: TrackingSettings): string {
  return [
    settings.tier,
    settings.width,
    settings.height,
    settings.fps,
    settings.poseFps ?? defaultTrackingSettings.poseFps ?? 20,
    settings.microphoneVowels ? 1 : 0,
    settings.poseEnabled ? 1 : 0
  ].join("|");
}

const parameterGroups: Array<{ title: string; ids: ParameterId[] }> = [
  { title: "头部 9 轴", ids: ["ParamAngleX", "ParamAngleY", "ParamAngleZ"] },
  { title: "身体 4 轴", ids: ["ParamBodyAngleX", "ParamBodyAngleY", "ParamBodyAngleZ", "ParamBreath"] },
  { title: "五官", ids: ["ParamEyeBallX", "ParamEyeBallY", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY", "ParamMouthForm"] },
  { title: "手臂", ids: ["ParamArmLA", "ParamArmRA"] }
];
const realtimeTrackingParameterIds = new Set<ParameterId>(parameterGroups.flatMap((group) => group.ids));

const expressionPresets: Array<{ id: string; label: string; values: Partial<Record<ParameterId, number>> }> = [
  { id: "neutral", label: "默认", values: {} },
  { id: "happy", label: "开心", values: { ParamEyeLOpen: 0.72, ParamEyeROpen: 0.72, ParamMouthOpenY: 0.42, ParamMouthForm: 0.75, ParamAngleY: 4 } },
  { id: "angry", label: "生气", values: { ParamEyeLOpen: 0.82, ParamEyeROpen: 0.82, ParamMouthOpenY: 0.08, ParamMouthForm: -0.72, ParamAngleY: -3, ParamAngleZ: -2 } },
  { id: "sleepy", label: "睡着", values: { ParamEyeLOpen: 0.04, ParamEyeROpen: 0.04, ParamMouthOpenY: 0.08, ParamMouthForm: -0.25, ParamAngleY: -5, ParamBreath: 0.7 } },
  { id: "look-left", label: "左看", values: { ParamAngleX: -12, ParamEyeBallX: -0.82, ParamEyeBallY: 0.05, ParamEyeLOpen: 1, ParamEyeROpen: 1 } },
  { id: "look-right", label: "右看", values: { ParamAngleX: 12, ParamEyeBallX: 0.82, ParamEyeBallY: 0.05, ParamEyeLOpen: 1, ParamEyeROpen: 1 } },
  { id: "surprised", label: "惊讶", values: { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0.82, ParamMouthForm: 0.18, ParamAngleY: 6 } }
];

const backgroundModes: Array<{ id: StageBackgroundMode; label: string }> = [
  { id: "checker", label: "伪透明" },
  { id: "green", label: "绿幕" },
  { id: "white", label: "白幕" },
  { id: "black", label: "黑幕" },
  { id: "transparent", label: "透明" }
];

const samplePresets: Array<{ id: SamplePsdPreset; label: string }> = [
  { id: "u3", label: "u3 默认适配" },
  { id: "u4", label: "u4 新预设" },
  { id: "u5", label: "u5 图生图角色" },
  { id: "u6", label: "u6 截图成品角色" }
];

function ActionHint({ text }: { text: string }) {
  return (
    <span className="action-hint" title={text} aria-label={text}>
      !
    </span>
  );
}

const expressionDefaultGroup = "eye-expression";
const standardParentBoneIds = ["root", "body", "neck", "head", "face", "hair-back", "hair-side", "hair-front", "cloth-chest", "cloth-hips", "accessory"];
const layerMoveOverflow = 0.35;
const formatPct = (value: number) => `${Math.round(value * 100)}%`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function layerRoleLabel(layer: PsdLayerAsset): string {
  if (layer.attachment?.type === "object") return "obj";
  if (layer.attachment?.type === "expression") return "表情";
  return "标准";
}

function expressionGroupForLayer(layer: PsdLayerAsset): string | undefined {
  if (layer.attachment?.type !== "expression") return undefined;
  return layer.attachment.exclusiveGroup || expressionDefaultGroup;
}

function expressionKeyForLayer(layer: PsdLayerAsset): string {
  return layer.attachment?.expressionKey || layer.id;
}

function isLayerActiveInExpressionState(layer: PsdLayerAsset, project: RigProject): boolean {
  const group = expressionGroupForLayer(layer);
  if (!group) return true;
  return project.expressionState?.active?.[group] === expressionKeyForLayer(layer);
}

function expressionLabel(key: string): string {
  return key
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || "expression";
}

function defaultLayerInertiaScale(kind: PsdLayerAsset["kind"], bounds: Rect): number | undefined {
  if (kind !== "frontHair" && kind !== "sideHair" && kind !== "backHair" && kind !== "accessory") return undefined;
  const areaScale = Math.sqrt(Math.max(0.0001, bounds.width * bounds.height) / 0.09);
  const base = kind === "accessory" ? 0.82 : kind === "backHair" ? 1.08 : 1;
  return Math.round(clamp(base * areaScale, 0.55, 1.55) * 100) / 100;
}

function withProjectDefaults(project: RigProject): RigProject {
  return {
    ...project,
    depthTuning: {
      ...defaultDepthTuning,
      ...project.depthTuning
    },
    dynamicsTuning: {
      ...defaultDynamicsTuning,
      ...project.dynamicsTuning
    },
    parameterSnapshots: project.parameterSnapshots ?? [],
    stageBackground: project.stageBackground ?? "checker",
    headRollPivot: {
      ...defaultHeadRollPivot,
      ...project.headRollPivot
    },
    expressionState: {
      active: {
        ...(project.expressionState?.active ?? {})
      }
    },
    tracking: {
      ...defaultTrackingSettings,
      ...project.tracking,
      angleLimits: project.tracking?.angleLimits ?? defaultTrackingSettings.angleLimits
    },
    layers: project.layers.map((layer) => ({
      ...layer,
      localScale: layer.localScale ?? 1,
      localRotation: layer.localRotation ?? 0,
      inertiaScale: layer.inertiaScale ?? defaultLayerInertiaScale(layer.kind, layer.naturalBounds ?? layer.bounds)
    }))
  };
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadText(name: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function patchParameter(parameters: RigParameter[], id: ParameterId, value: number): RigParameter[] {
  return parameters.map((parameter) => (parameter.id === id ? { ...parameter, value: clamp(value, parameter.min, parameter.max) } : parameter));
}

function layerCenter(layer: PsdLayerAsset) {
  return {
    x: layer.bounds.x + layer.bounds.width * 0.5,
    y: layer.bounds.y + layer.bounds.height * 0.5
  };
}

function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5
  };
}

function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy
  };
}

function translateLayer(layer: PsdLayerAsset, requestedDx: number, requestedDy: number): PsdLayerAsset {
  const rects = [layer.bounds, layer.naturalBounds];
  const minDx = Math.max(...rects.map((rect) => -layerMoveOverflow - rect.x));
  const maxDx = Math.min(...rects.map((rect) => 1 + layerMoveOverflow - rect.x - rect.width));
  const minDy = Math.max(...rects.map((rect) => -layerMoveOverflow - rect.y));
  const maxDy = Math.min(...rects.map((rect) => 1 + layerMoveOverflow - rect.y - rect.height));
  const dx = clamp(requestedDx, minDx, maxDx);
  const dy = clamp(requestedDy, minDy, maxDy);

  return {
    ...layer,
    bounds: shiftRect(layer.bounds, dx, dy),
    naturalBounds: shiftRect(layer.naturalBounds, dx, dy),
    pivot: layer.pivot ? { x: layer.pivot.x + dx, y: layer.pivot.y + dy } : layer.pivot,
    mesh: {
      ...layer.mesh,
      points: layer.mesh.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
    }
  };
}

function averageMeshDepth(mesh: MeshBinding): number {
  if (!mesh.points.length) return 0;
  return mesh.points.reduce((sum, _, index) => sum + (mesh.depths?.[index] ?? 0), 0) / mesh.points.length;
}

function canvasAlphaAtClientPoint(canvas: HTMLCanvasElement | null, clientX: number, clientY: number): number | undefined {
  if (!canvas) return undefined;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  const xRatio = (clientX - rect.left) / rect.width;
  const yRatio = (clientY - rect.top) / rect.height;
  if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return 0;
  const x = clamp(Math.floor(xRatio * canvas.width), 0, Math.max(0, canvas.width - 1));
  const y = clamp(Math.floor(yRatio * canvas.height), 0, Math.max(0, canvas.height - 1));
  try {
    return canvas.getContext("2d")?.getImageData(x, y, 1, 1).data[3];
  } catch {
    return undefined;
  }
}

function canvasHasVisiblePixelAtPointer(canvas: HTMLCanvasElement | null, event: React.PointerEvent, threshold = 8): boolean {
  const alpha = canvasAlphaAtClientPoint(canvas, event.clientX, event.clientY);
  return alpha === undefined ? true : alpha > threshold;
}

function meshBounds(mesh: MeshBinding): Rect {
  const xs = mesh.points.map((point) => point.x);
  const ys = mesh.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0.0001, maxX - minX),
    height: Math.max(0.0001, maxY - minY)
  };
}

function paddedRect(rect: Rect, padXRatio: number, padYRatio: number): Rect {
  const padX = rect.width * padXRatio;
  const padY = rect.height * padYRatio;
  const x = clamp(rect.x - padX, 0, 1);
  const y = clamp(rect.y - padY, 0, 1);
  return {
    x,
    y,
    width: Math.min(1 - x, rect.width + padX * 2),
    height: Math.min(1 - y, rect.height + padY * 2)
  };
}

function growEyeRect(rect?: Rect): Rect | undefined {
  if (!rect) return undefined;
  return paddedRect(rect, 0.04, 0.075);
}

function irisFallbackEyeRect(rect?: Rect): Rect | undefined {
  return rect ? growEyeRect(paddedRect(rect, 0.2, 0.16)) : undefined;
}

function rectForLayerSide(layer: PsdLayerAsset, bounds?: { left?: Rect; right?: Rect }): Rect | undefined {
  if (layer.side === "left") return bounds?.left;
  if (layer.side === "right") return bounds?.right;
  return undefined;
}

function eyeCenterFromBounds(bounds?: { left?: Rect; right?: Rect }): Point | undefined {
  const centers = [bounds?.left, bounds?.right].filter(Boolean).map((rect) => ({
    x: rect!.x + rect!.width * 0.5,
    y: rect!.y + rect!.height * 0.5
  }));
  if (!centers.length) return undefined;
  return {
    x: clamp(centers.reduce((sum, point) => sum + point.x, 0) / centers.length, 0.18, 0.82),
    y: clamp(centers.reduce((sum, point) => sum + point.y, 0) / centers.length, 0.16, 0.48)
  };
}

function clipEyeSocket(context: CanvasRenderingContext2D, rect: Rect, width: number, height: number) {
  const cx = (rect.x + rect.width * 0.5) * width;
  const cy = (rect.y + rect.height * 0.5) * height;
  const rx = (rect.width * width) / 2;
  const ry = (rect.height * height) * 0.42;
  context.beginPath();
  context.moveTo(cx - rx, cy);
  context.bezierCurveTo(cx - rx * 0.72, cy - ry, cx + rx * 0.72, cy - ry, cx + rx, cy);
  context.bezierCurveTo(cx + rx * 0.72, cy + ry, cx - rx * 0.72, cy + ry, cx - rx, cy);
  context.closePath();
  context.clip();
}

function makeWidget(parentBoneId: string, index: number): Widget {
  return {
    id: `widget-${Date.now()}-${index}`,
    name: `小部件 ${index + 1}`,
    parentBoneId,
    rect: { x: 0.42, y: 0.18 + index * 0.04, width: 0.16, height: 0.08 },
    z: 130 + index,
    triggerParameter: "ParamAngleZ"
  };
}

async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode().catch(
    () =>
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片加载失败"));
      })
  );
  return image;
}

function cropImageToDataUrl(image: HTMLImageElement, x: number, width: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
  const context = canvas.getContext("2d");
  context?.drawImage(image, x, 0, width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function splitLayerAtCenter(layer: PsdLayerAsset): Promise<[PsdLayerAsset, PsdLayerAsset]> {
  const image = await loadHtmlImage(layer.imageUrl);
  const sourceWidth = Math.max(2, image.naturalWidth || image.width || 2);
  const splitX = Math.round(sourceWidth * 0.5);
  const leftBounds = { ...layer.naturalBounds, width: layer.naturalBounds.width * 0.5 };
  const rightBounds = {
    ...layer.naturalBounds,
    x: layer.naturalBounds.x + layer.naturalBounds.width * 0.5,
    width: layer.naturalBounds.width * 0.5
  };

  return [
    {
      ...layer,
      id: `${layer.id}-manual-left`,
      sourceName: `${layer.sourceName} L`,
      side: "left",
      bounds: leftBounds,
      naturalBounds: leftBounds,
      imageUrl: cropImageToDataUrl(image, 0, splitX),
      z: layer.z - 0.002,
      pivot: defaultPivotForKind(layer.kind, leftBounds, "left"),
      mesh: makeMeshWithDensity(leftBounds, layer.mesh.rows, layer.mesh.cols, layer.kind),
      inertiaScale: defaultLayerInertiaScale(layer.kind, leftBounds)
    },
    {
      ...layer,
      id: `${layer.id}-manual-right`,
      sourceName: `${layer.sourceName} R`,
      side: "right",
      bounds: rightBounds,
      naturalBounds: rightBounds,
      imageUrl: cropImageToDataUrl(image, splitX, sourceWidth - splitX),
      z: layer.z + 0.002,
      pivot: defaultPivotForKind(layer.kind, rightBounds, "right"),
      mesh: makeMeshWithDensity(rightBounds, layer.mesh.rows, layer.mesh.cols, layer.kind),
      inertiaScale: defaultLayerInertiaScale(layer.kind, rightBounds)
    }
  ];
}

function expandTriangle(points: Array<{ x: number; y: number }>, amount: number) {
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3
  };
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * amount,
      y: point.y + (dy / length) * amount
    };
  });
}

type HairSpringState = {
  time: number;
  tailX: number;
  tailY: number;
  tailRotate: number;
  velocityX: number;
  velocityY: number;
  velocityRotate: number;
};

type PreviewMotion = ReturnType<typeof layerPreviewMotion>;

function isHairDynamicLayer(layer: PsdLayerAsset): boolean {
  return layer.kind === "frontHair" || layer.kind === "sideHair" || layer.kind === "backHair" || layer.kind === "accessory";
}

function isHeadProxyBackLayer(layer: PsdLayerAsset): boolean {
  return layer.kind === "backHair" || layer.attachment?.proxyGroup === "back";
}

function springValue(value: number, velocity: number, target: number, dt: number, stiffness: number, damping: number) {
  const nextVelocity = (velocity + (target - value) * stiffness * dt) * Math.exp(-damping * dt);
  return {
    value: value + nextVelocity * dt,
    velocity: nextVelocity
  };
}

function applyHairSpringMotion(layer: PsdLayerAsset, motion: PreviewMotion, time: number, states: Map<string, HairSpringState>): PreviewMotion {
  if (!isHairDynamicLayer(layer)) return motion;
  const target = {
    tailX: motion.tailX ?? 0,
    tailY: motion.tailY ?? 0,
    tailRotate: motion.tailRotate ?? 0
  };
  const mass = clamp(layer.inertiaScale ?? defaultLayerInertiaScale(layer.kind, layer.naturalBounds) ?? 1, 0.45, 2.4);
  const baseStiffness = layer.kind === "backHair" ? 58 : layer.kind === "sideHair" ? 68 : 76;
  const stiffness = baseStiffness / Math.sqrt(mass);
  const damping = (layer.kind === "backHair" ? 6.8 : 7.8) / Math.sqrt(mass);
  const current = states.get(layer.id);
  if (!current) {
    states.set(layer.id, { time, ...target, velocityX: 0, velocityY: 0, velocityRotate: 0 });
    return motion;
  }
  const dt = clamp(time - current.time, 1 / 120, 1 / 24);
  const x = springValue(current.tailX, current.velocityX, target.tailX, dt, stiffness, damping);
  const y = springValue(current.tailY, current.velocityY, target.tailY, dt, stiffness * 0.82, damping * 0.95);
  const rotate = springValue(current.tailRotate, current.velocityRotate, target.tailRotate, dt, stiffness * 0.72, damping * 0.9);
  const next = {
    time,
    tailX: x.value,
    tailY: y.value,
    tailRotate: rotate.value,
    velocityX: x.velocity,
    velocityY: y.velocity,
    velocityRotate: rotate.velocity
  };
  states.set(layer.id, next);
  return {
    ...motion,
    tailX: next.tailX,
    tailY: next.tailY,
    tailRotate: next.tailRotate
  };
}

function RigLayerCanvas({
  layer,
  mesh,
  canvasSize,
  className,
  style,
  clipRect,
  onPointerDown
}: {
  layer: PsdLayerAsset;
  mesh: MeshBinding;
  canvasSize: { width: number; height: number };
  className: string;
  style: React.CSSProperties;
  clipRect?: Rect;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = layer.imageUrl;
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.onerror = () => setReady(false);
  }, [layer.imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;

    const imageWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const imageHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const width = Math.max(1, canvasSize.width);
    const height = Math.max(1, canvasSize.height);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, width, height);
    if (clipRect) {
      context.save();
      clipEyeSocket(context, clipRect, width, height);
    }

    const rows = mesh.rows;
    const cols = mesh.cols;
    const targetPoint = (index: number) => {
      const point = mesh.points[index] ?? layer.mesh.points[index];
      return {
        x: point.x * width,
        y: point.y * height
      };
    };
    const sourcePoint = (col: number, row: number) => ({
      x: (col / Math.max(1, cols - 1)) * imageWidth,
      y: (row / Math.max(1, rows - 1)) * imageHeight
    });
    const cellDepth = (indices: number[]) =>
      indices.reduce((sum, index) => sum + (mesh.projectedDepths?.[index] ?? mesh.depths?.[index] ?? 0), 0) / indices.length;
    const cells: Array<{ indices: [number, number, number, number]; depth: number }> = [];
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const indices: [number, number, number, number] = [
          row * cols + col,
          row * cols + col + 1,
          (row + 1) * cols + col,
          (row + 1) * cols + col + 1
        ];
        cells.push({ indices, depth: cellDepth(indices) });
      }
    }
    cells.sort((a, b) => a.depth - b.depth);

    const sourceForIndex = (index: number) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      return sourcePoint(col, row);
    };
    const targetForIndex = (index: number) => targetPoint(index);

    const drawTriangle = (
      source: Array<{ x: number; y: number }>,
      target: Array<{ x: number; y: number }>
    ) => {
      const expandedSource = expandTriangle(source, 0.35);
      const expandedTarget = expandTriangle(target, 0.65);
      context.save();
      context.beginPath();
      context.moveTo(expandedTarget[0].x, expandedTarget[0].y);
      context.lineTo(expandedTarget[1].x, expandedTarget[1].y);
      context.lineTo(expandedTarget[2].x, expandedTarget[2].y);
      context.closePath();
      context.clip();

      const [s0, s1, s2] = expandedSource;
      const [d0, d1, d2] = expandedTarget;
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
      context.drawImage(image, 0, 0, imageWidth, imageHeight);
      context.restore();
    };

    for (const cell of cells) {
      const [i00, i10, i01, i11] = cell.indices;
      drawTriangle([sourceForIndex(i00), sourceForIndex(i10), sourceForIndex(i11)], [targetForIndex(i00), targetForIndex(i10), targetForIndex(i11)]);
      drawTriangle([sourceForIndex(i00), sourceForIndex(i11), sourceForIndex(i01)], [targetForIndex(i00), targetForIndex(i11), targetForIndex(i01)]);
    }
    if (clipRect) context.restore();
  }, [layer, mesh, canvasSize, ready, clipRect]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      data-mesh-canvas="true"
      data-layer-id={layer.id}
      data-layer-kind={layer.kind}
      data-layer-side={layer.side ?? ""}
      aria-label={layer.sourceName}
      onPointerDown={(event) => {
        if (!canvasHasVisiblePixelAtPointer(canvasRef.current, event)) return;
        onPointerDown(event);
      }}
    />
  );
}

function HeadProxyCanvas({
  layers,
  meshes,
  canvasSize,
  eyeBounds,
  className,
  style,
  onLayerPointerDown
}: {
  layers: PsdLayerAsset[];
  meshes: Map<string, MeshBinding>;
  canvasSize: { width: number; height: number };
  eyeBounds?: { left?: Rect; right?: Rect };
  className: string;
  style: React.CSSProperties;
  onLayerPointerDown: (layer: PsdLayerAsset, event: React.PointerEvent<HTMLCanvasElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [readyKey, setReadyKey] = useState(0);
  const imageKey = useMemo(() => layers.map((layer) => `${layer.id}:${layer.imageUrl}`).join("|"), [layers]);

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, HTMLImageElement>();

    Promise.all(
      layers.map(async (layer) => {
        const image = new Image();
        image.decoding = "async";
        image.src = layer.imageUrl;
        await image.decode().catch(
          () =>
            new Promise<void>((resolve, reject) => {
              image.onload = () => resolve();
              image.onerror = () => reject(new Error("图片加载失败"));
            })
        );
        next.set(layer.id, image);
      })
    )
      .then(() => {
        if (cancelled) return;
        imagesRef.current = next;
        setReadyKey((value) => value + 1);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1, canvasSize.width);
    const height = Math.max(1, canvasSize.height);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, width, height);

    const triangles: Array<{
      layer: PsdLayerAsset;
      image: HTMLImageElement;
      depth: number;
      source: Array<{ x: number; y: number }>;
      target: Array<{ x: number; y: number }>;
    }> = [];

    const targetPoint = (mesh: MeshBinding, fallback: MeshBinding, index: number) => {
      const point = mesh.points[index] ?? fallback.points[index];
      return { x: point.x * width, y: point.y * height };
    };

    const triangleArea = (target: Array<{ x: number; y: number }>) =>
      (target[1].x - target[0].x) * (target[2].y - target[0].y) - (target[1].y - target[0].y) * (target[2].x - target[0].x);

    const pushTriangle = (
      layer: PsdLayerAsset,
      image: HTMLImageElement,
      mesh: MeshBinding,
      indices: [number, number, number],
      sourceForIndex: (index: number) => { x: number; y: number }
    ) => {
      const target = indices.map((index) => targetPoint(mesh, layer.mesh, index));
      if (Math.abs(triangleArea(target)) < 0.01) return;
      const depth = indices.reduce((sum, index) => sum + (mesh.projectedDepths?.[index] ?? mesh.depths?.[index] ?? 0), 0) / indices.length;
      triangles.push({
        layer,
        image,
        depth: layer.z * 100 + depth,
        source: indices.map(sourceForIndex),
        target
      });
    };

    for (const layer of layers) {
      const image = imagesRef.current.get(layer.id);
      const mesh = meshes.get(layer.id);
      if (!image || !mesh || !image.complete || !image.naturalWidth || !layer.visible) continue;

      const imageWidth = Math.max(1, image.naturalWidth || image.width || 1);
      const imageHeight = Math.max(1, image.naturalHeight || image.height || 1);
      const rows = mesh.rows;
      const cols = mesh.cols;
      const sourcePoint = (col: number, row: number) => ({
        x: (col / Math.max(1, cols - 1)) * imageWidth,
        y: (row / Math.max(1, rows - 1)) * imageHeight
      });
      const sourceForIndex = (index: number) => sourcePoint(index % cols, Math.floor(index / cols));

      for (let row = 0; row < rows - 1; row += 1) {
        for (let col = 0; col < cols - 1; col += 1) {
          const i00 = row * cols + col;
          const i10 = row * cols + col + 1;
          const i01 = (row + 1) * cols + col;
          const i11 = (row + 1) * cols + col + 1;
          pushTriangle(layer, image, mesh, [i00, i10, i11], sourceForIndex);
          pushTriangle(layer, image, mesh, [i00, i11, i01], sourceForIndex);
        }
      }
    }

    triangles.sort((a, b) => a.depth - b.depth);

    const drawTriangle = (
      layer: PsdLayerAsset,
      image: HTMLImageElement,
      opacity: number,
      source: Array<{ x: number; y: number }>,
      target: Array<{ x: number; y: number }>
    ) => {
      const expandedSource = expandTriangle(source, 0.35);
      const expandedTarget = expandTriangle(target, 0.65);
      context.save();
      context.globalAlpha = opacity;
      const clipRect = layer.kind === "iris" ? rectForLayerSide(layer, eyeBounds) : undefined;
      if (clipRect) {
        clipEyeSocket(context, clipRect, width, height);
      }
      context.beginPath();
      context.moveTo(expandedTarget[0].x, expandedTarget[0].y);
      context.lineTo(expandedTarget[1].x, expandedTarget[1].y);
      context.lineTo(expandedTarget[2].x, expandedTarget[2].y);
      context.closePath();
      context.clip();

      const [s0, s1, s2] = expandedSource;
      const [d0, d1, d2] = expandedTarget;
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
    };

    for (const triangle of triangles) {
      drawTriangle(triangle.layer, triangle.image, triangle.layer.opacity, triangle.source, triangle.target);
    }
  }, [canvasSize, layers, meshes, readyKey, eyeBounds]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      data-head-proxy-canvas="true"
      aria-label="head proxy composite"
      onPointerDown={(event) => {
        if (!canvasHasVisiblePixelAtPointer(canvasRef.current, event)) return;
        const top = [...layers].filter((layer) => layer.visible && layer.opacity > 0.01).sort((a, b) => b.z - a.z)[0];
        if (top) onLayerPointerDown(top, event);
      }}
    />
  );
}

function CanvasStage({
  project,
  selectedLayerId,
  selectedBoneId,
  selectedWidgetId,
  mode,
  time,
  setProject,
  setSelectedLayerId,
  setSelectedBoneId,
  setSelectedWidgetId
}: {
  project: RigProject;
  selectedLayerId?: string;
  selectedBoneId?: string;
  selectedWidgetId?: string;
  mode: ToolMode;
  time: number;
  setProject: (project: RigProject) => void;
  setSelectedLayerId: (id?: string) => void;
  setSelectedBoneId: (id?: string) => void;
  setSelectedWidgetId: (id?: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const hairSpringRef = useRef<Map<string, HairSpringState>>(new Map());
  const standardLayers = useMemo(() => project.layers.filter((layer) => layer.attachment?.type !== "expression"), [project.layers]);
  const sortedLayers = useMemo(
    () => project.layers.filter((layer) => isLayerActiveInExpressionState(layer, project)).sort((a, b) => a.z - b.z),
    [project]
  );
  const headProxyBackLayers = useMemo(
    () => (project.depthMode === "proxyHead" ? sortedLayers.filter((layer) => isHeadProxyBackLayer(layer)) : []),
    [project.depthMode, sortedLayers]
  );
  const headProxyFrontLayers = useMemo(
    () => (project.depthMode === "proxyHead" ? sortedLayers.filter((layer) => isLayerHeadPart(layer) && !isHeadProxyBackLayer(layer)) : []),
    [project.depthMode, sortedLayers]
  );
  useEffect(() => {
    hairSpringRef.current.clear();
  }, [project.source.fileName, project.layers.length]);
  const baseEyeBounds = useMemo(() => {
    const pick = (side: "left" | "right") =>
      standardLayers.find((layer) => layer.kind === "eyeWhite" && layer.side === side)?.naturalBounds ??
      standardLayers.find((layer) => layer.kind === "eyelash" && layer.side === side)?.naturalBounds;
    const irisPick = (side: "left" | "right") => standardLayers.find((layer) => layer.kind === "iris" && layer.side === side)?.naturalBounds;
    return {
      left: growEyeRect(pick("left")) ?? irisFallbackEyeRect(irisPick("left")),
      right: growEyeRect(pick("right")) ?? irisFallbackEyeRect(irisPick("right"))
    };
  }, [standardLayers]);
  const eyeSocketMeshes = useMemo(() => {
    const headProxyCenter = eyeCenterFromBounds(baseEyeBounds);
    const sockets = new Map<string, MeshBinding>();
    for (const layer of standardLayers) {
      if (layer.kind !== "eyeWhite" && layer.kind !== "eyelash") continue;
      sockets.set(
        layer.id,
        deformedMeshForLayer(layer, project.parameters, project.depthMode ?? "manual", {
          motion: layerPreviewMotion(layer, project.parameters, project.physicsTemplates, time, project.canvas, project.dynamicsTuning, project.headRollPivot, project.tracking),
          canvasSize: project.canvas,
          eyeBounds: baseEyeBounds,
          depthTuning: project.depthTuning,
          dynamicsTuning: project.dynamicsTuning,
          headProxyCenter
        })
      );
    }
    return sockets;
  }, [standardLayers, project.parameters, project.physicsTemplates, project.depthMode, project.canvas, time, baseEyeBounds, project.depthTuning, project.dynamicsTuning, project.headRollPivot]);
  const eyeBounds = useMemo(() => {
    const pick = (side: "left" | "right") => {
      const source =
        standardLayers.find((layer) => layer.kind === "eyeWhite" && layer.side === side) ??
        standardLayers.find((layer) => layer.kind === "eyelash" && layer.side === side);
      const mesh = source ? eyeSocketMeshes.get(source.id) : undefined;
      return growEyeRect(mesh ? meshBounds(mesh) : undefined) ?? baseEyeBounds[side];
    };
    return {
      left: pick("left"),
      right: pick("right")
    };
  }, [baseEyeBounds, eyeSocketMeshes, standardLayers]);
  const headProxyCenter = useMemo(() => eyeCenterFromBounds(baseEyeBounds) ?? { x: 0.5, y: 0.34 }, [baseEyeBounds]);
  const previewMotionForLayer = (layer: PsdLayerAsset) =>
    applyHairSpringMotion(
      layer,
      layerPreviewMotion(layer, project.parameters, project.physicsTemplates, time, project.canvas, project.dynamicsTuning, project.headRollPivot, project.tracking),
      time,
      hairSpringRef.current
    );
  const headProxyMeshes = useMemo(() => {
    const meshes = new Map<string, MeshBinding>();
    for (const layer of [...headProxyBackLayers, ...headProxyFrontLayers]) {
      meshes.set(
        layer.id,
        deformedMeshForLayer(layer, project.parameters, project.depthMode ?? "manual", {
          motion: previewMotionForLayer(layer),
          canvasSize: project.canvas,
          eyeBounds,
          depthTuning: project.depthTuning,
          dynamicsTuning: project.dynamicsTuning,
          headProxyCenter
        })
      );
    }
    return meshes;
  }, [headProxyBackLayers, headProxyFrontLayers, project.parameters, project.physicsTemplates, project.depthMode, project.canvas, time, eyeBounds, project.depthTuning, project.dynamicsTuning, headProxyCenter, project.headRollPivot]);
  const proxyGroupOpacity = (layers: PsdLayerAsset[]) =>
    layers.reduce((max, layer) => {
        const style = layerPreviewStyle(layer, project.parameters, project.physicsTemplates, time, project.canvas, project.dynamicsTuning, project.headRollPivot);
        return Math.max(max, style.opacity);
      }, 0);
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId);
  const headRollPivot = { ...defaultHeadRollPivot, ...project.headRollPivot };

  function eventToPoint(event: PointerEvent | React.PointerEvent) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  const clearStageSelection = () => {
    setSelectedLayerId(undefined);
    setSelectedBoneId(undefined);
    setSelectedWidgetId(undefined);
  };

  const selectRenderedLayerAtPointer = (event: React.PointerEvent): boolean => {
    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    for (const element of elements) {
      if (!(element instanceof HTMLCanvasElement)) continue;
      const layerId = element.dataset.layerId;
      if (!layerId) continue;
      const alpha = canvasAlphaAtClientPoint(element, event.clientX, event.clientY);
      if (alpha !== undefined && alpha <= 8) continue;
      const layer = project.layers.find((item) => item.id === layerId);
      if (!layer || !layer.visible || !isLayerActiveInExpressionState(layer, project)) continue;
      setSelectedLayerId(layer.id);
      setSelectedBoneId(layer.parentBoneId);
      setSelectedWidgetId(undefined);
      return true;
    }
    return false;
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = eventToPoint(event);
      if (drag.type === "bone") {
        setProject({
          ...project,
          bones: project.bones.map((bone) => (bone.id === drag.id && !bone.locked ? { ...bone, position: point } : bone))
        });
      }
      if (drag.type === "mesh") {
        setProject({
          ...project,
          layers: project.layers.map((layer) =>
            layer.id === drag.layerId
              ? {
                  ...layer,
                  mesh: {
                    ...layer.mesh,
                    points: layer.mesh.points.map((meshPoint, index) => (index === drag.pointIndex ? point : meshPoint))
                  }
                }
              : layer
          )
        });
      }
      if (drag.type === "pivot") {
        setProject({
          ...project,
          layers: project.layers.map((layer) => (layer.id === drag.layerId ? { ...layer, pivot: point } : layer))
        });
      }
      if (drag.type === "headRollPivot") {
        setProject({
          ...project,
          headRollPivot: point
        });
      }
      if (drag.type === "widget") {
        setProject({
          ...project,
          widgets: project.widgets.map((widget) =>
            widget.id === drag.id
              ? {
                  ...widget,
                  rect: {
                    ...widget.rect,
                    x: clamp(point.x - widget.rect.width * 0.5, 0, 1 - widget.rect.width),
                    y: clamp(point.y - widget.rect.height * 0.5, 0, 1 - widget.rect.height)
                  }
                }
              : widget
          )
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [project, setProject]);

  const meshLines = (mesh: MeshBinding) => {
    const lines = [];
    for (let row = 0; row < mesh.rows; row += 1) {
      for (let col = 0; col < mesh.cols - 1; col += 1) {
        lines.push([row * mesh.cols + col, row * mesh.cols + col + 1]);
      }
    }
    for (let col = 0; col < mesh.cols; col += 1) {
      for (let row = 0; row < mesh.rows - 1; row += 1) {
        lines.push([row * mesh.cols + col, (row + 1) * mesh.cols + col]);
      }
    }
    return lines;
  };
  const selectedPivot = selectedLayer ? selectedLayer.pivot ?? defaultPivotForKind(selectedLayer.kind, selectedLayer.naturalBounds, selectedLayer.side) : undefined;

  return (
    <section className="stage-card" data-background={project.stageBackground ?? "checker"}>
      <div className="stage-toolbar">
        <div>
          <strong>{project.name}</strong>
          <span>{project.canvas.width} x {project.canvas.height} / {project.layers.length} layers</span>
        </div>
        <div className="stage-pills">
          <span>{mode === "mesh" ? "网格编辑" : mode === "bone" ? "骨骼对齐" : mode === "physics" ? "物理模板" : mode === "widget" ? "小部件" : "预览"}</span>
          <span>9轴/眨眼/张嘴可预览</span>
          <select
            className="stage-background-select"
            value={project.stageBackground ?? "checker"}
            onChange={(event) => setProject({ ...project, stageBackground: event.currentTarget.value as StageBackgroundMode })}
            aria-label="Background"
          >
            {backgroundModes.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="avatar-stage"
        data-background={project.stageBackground ?? "checker"}
        ref={stageRef}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (selectRenderedLayerAtPointer(event)) return;
          clearStageSelection();
        }}
      >
        <div className="axis-grid" />
        {project.layers.length === 0 ? (
          <div className="empty-stage">
            <Upload size={34} />
            <strong>导入规范 PSD 后开始绑定</strong>
            <span>支持你当前 see-through 自动拆分出的固定部位图层，并会自动修正 Z 轴。</span>
          </div>
        ) : null}

        {project.depthMode === "proxyHead" && headProxyBackLayers.length > 0 ? (
          <HeadProxyCanvas
            layers={headProxyBackLayers.map((layer) => ({
              ...layer,
              opacity: layerPreviewStyle(layer, project.parameters, project.physicsTemplates, time, project.canvas, project.dynamicsTuning, project.headRollPivot).opacity
            }))}
            meshes={headProxyMeshes}
            canvasSize={project.canvas}
            eyeBounds={eyeBounds}
            className="psd-layer mesh-layer-canvas head-proxy-canvas head-proxy-back"
            style={{
              left: "0%",
              top: "0%",
              width: "100%",
              height: "100%",
              zIndex: Math.round(Math.min(...headProxyBackLayers.map((layer) => layer.z))),
              opacity: proxyGroupOpacity(headProxyBackLayers) > 0 ? 1 : 0
            }}
            onLayerPointerDown={(layer, event) => {
              event.stopPropagation();
              setSelectedLayerId(layer.id);
              setSelectedBoneId(layer.parentBoneId);
              setSelectedWidgetId(undefined);
            }}
          />
        ) : null}

        {project.depthMode === "proxyHead" && headProxyFrontLayers.length > 0 ? (
          <HeadProxyCanvas
            layers={headProxyFrontLayers.map((layer) => ({
              ...layer,
              opacity: layerPreviewStyle(layer, project.parameters, project.physicsTemplates, time, project.canvas, project.dynamicsTuning, project.headRollPivot).opacity
            }))}
            meshes={headProxyMeshes}
            canvasSize={project.canvas}
            eyeBounds={eyeBounds}
            className="psd-layer mesh-layer-canvas head-proxy-canvas head-proxy-front"
            style={{
              left: "0%",
              top: "0%",
              width: "100%",
              height: "100%",
              zIndex: Math.round(Math.max(...headProxyFrontLayers.map((layer) => layer.z), 100)),
              opacity: proxyGroupOpacity(headProxyFrontLayers) > 0 ? 1 : 0
            }}
            onLayerPointerDown={(layer, event) => {
              event.stopPropagation();
              setSelectedLayerId(layer.id);
              setSelectedBoneId(layer.parentBoneId);
              setSelectedWidgetId(undefined);
            }}
          />
        ) : null}

        {sortedLayers.map((layer) => {
          if (project.depthMode === "proxyHead" && (isLayerHeadPart(layer) || isHeadProxyBackLayer(layer))) return null;
          const motion = previewMotionForLayer(layer);
          const previewMesh = deformedMeshForLayer(layer, project.parameters, project.depthMode ?? "manual", {
            motion,
            canvasSize: project.canvas,
            eyeBounds,
            depthTuning: project.depthTuning,
            dynamicsTuning: project.dynamicsTuning,
            headProxyCenter
          });
          const layerStyle: React.CSSProperties = {
            left: "0%",
            top: "0%",
            width: "100%",
            height: "100%",
            zIndex: Math.round(layer.z),
            opacity: motion.opacity,
            pointerEvents: layer.visible && motion.opacity > 0.01 ? "auto" : "none"
          };
          const selectLayer = (event: React.PointerEvent<HTMLElement>) => {
            if (!layer.visible || motion.opacity <= 0.01 || !isLayerActiveInExpressionState(layer, project)) return;
            event.stopPropagation();
            setSelectedLayerId(layer.id);
            setSelectedBoneId(layer.parentBoneId);
            setSelectedWidgetId(undefined);
          };
          return (
            <RigLayerCanvas
              key={layer.id}
              layer={layer}
              mesh={mode === "mesh" && selectedLayerId === layer.id ? layer.mesh : previewMesh}
              canvasSize={project.canvas}
              className={`psd-layer mesh-layer-canvas ${selectedLayerId === layer.id ? "is-selected" : ""}`}
              style={layerStyle}
              clipRect={layer.kind === "iris" ? rectForLayerSide(layer, eyeBounds) : undefined}
              onPointerDown={selectLayer}
            />
          );
        })}

        {mode === "bone" || mode === "select" ? (
          <svg className="bone-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            {project.bones.map((bone) => {
              const parent = project.bones.find((item) => item.id === bone.parentId);
              return parent ? <line key={`${bone.id}-line`} x1={parent.position.x} y1={parent.position.y} x2={bone.position.x} y2={bone.position.y} /> : null;
            })}
            {project.bones.map((bone) => (
              <g key={bone.id}>
                <circle
                  cx={bone.position.x}
                  cy={bone.position.y}
                  r={selectedBoneId === bone.id ? 0.013 : 0.009}
                  className={selectedBoneId === bone.id ? "selected-bone" : ""}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedBoneId(bone.id);
                    dragRef.current = { type: "bone", id: bone.id };
                  }}
                />
                <text x={bone.position.x + 0.012} y={bone.position.y - 0.012}>{bone.name}</text>
              </g>
            ))}
          </svg>
        ) : null}

        {mode === "bone" || mode === "select" ? (
          <svg className="head-roll-pivot-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            <line x1={headRollPivot.x - 0.024} y1={headRollPivot.y} x2={headRollPivot.x + 0.024} y2={headRollPivot.y} />
            <line x1={headRollPivot.x} y1={headRollPivot.y - 0.024} x2={headRollPivot.x} y2={headRollPivot.y + 0.024} />
            <circle
              cx={headRollPivot.x}
              cy={headRollPivot.y}
              r={0.012}
              onPointerDown={(event) => {
                event.stopPropagation();
                dragRef.current = { type: "headRollPivot" };
              }}
            />
            <text x={headRollPivot.x + 0.016} y={headRollPivot.y - 0.016}>Head Z Pivot</text>
          </svg>
        ) : null}

        {mode === "mesh" && selectedLayer ? (
          <svg className="mesh-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            {meshLines(selectedLayer.mesh).map(([a, b]) => (
              <line key={`${a}-${b}`} x1={selectedLayer.mesh.points[a].x} y1={selectedLayer.mesh.points[a].y} x2={selectedLayer.mesh.points[b].x} y2={selectedLayer.mesh.points[b].y} />
            ))}
            {selectedLayer.mesh.points.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={0.008}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  dragRef.current = { type: "mesh", layerId: selectedLayer.id, pointIndex: index };
                }}
              />
            ))}
          </svg>
        ) : null}

        {(mode === "bone" || mode === "select" || mode === "mesh") && selectedLayer && selectedPivot ? (
          <svg className="pivot-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            <line x1={selectedPivot.x - 0.018} y1={selectedPivot.y} x2={selectedPivot.x + 0.018} y2={selectedPivot.y} />
            <line x1={selectedPivot.x} y1={selectedPivot.y - 0.018} x2={selectedPivot.x} y2={selectedPivot.y + 0.018} />
            <circle
              cx={selectedPivot.x}
              cy={selectedPivot.y}
              r={0.01}
              onPointerDown={(event) => {
                event.stopPropagation();
                dragRef.current = { type: "pivot", layerId: selectedLayer.id };
              }}
            />
            <text x={selectedPivot.x + 0.014} y={selectedPivot.y - 0.014}>Pivot</text>
          </svg>
        ) : null}

        {mode === "physics"
          ? project.layers
              .filter((layer) => layer.physicsTemplateId)
              .map((layer) => {
                const center = layerCenter(layer);
                const template = project.physicsTemplates.find((item) => item.id === layer.physicsTemplateId);
                return (
                  <div
                    key={layer.id}
                    className="physics-anchor"
                    style={{
                      left: `${center.x * 100}%`,
                      top: `${center.y * 100}%`,
                      borderColor: template?.previewColor
                    }}
                  >
                    {template?.name}
                  </div>
                );
              })
          : null}

        {project.widgets.map((widget) => (
          <button
            key={widget.id}
            className={`widget-box ${selectedWidgetId === widget.id ? "is-selected" : ""}`}
            style={{
              left: `${widget.rect.x * 100}%`,
              top: `${widget.rect.y * 100}%`,
              width: `${widget.rect.width * 100}%`,
              height: `${widget.rect.height * 100}%`,
              zIndex: widget.z
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              setSelectedWidgetId(widget.id);
              dragRef.current = { type: "widget", id: widget.id };
            }}
          >
            {widget.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function ImportPanel({
  report,
  templateReport,
  samplePreset,
  setSamplePreset,
  onImport,
  onSample,
  onReplaceTextures,
  onImportDepthMap,
  onInvertDepthMap,
  onUseProxyDepth,
  depthMode,
  depthMapSource,
  onImportProject,
  onApplyTemplate,
  onExportProject,
  onExportTemplate,
  onExportRuntime,
  onOpenRuntimeWindow,
  onExportReplacementPack,
  onExportFinishedPack,
  onImportFinishedPack,
  onImportObjectPsd,
  onImportExpressionPsd,
  onSaveDraft,
  onLoadDraft,
  hasDraft,
  busy
}: {
  report?: ImportReport;
  templateReport?: TemplateApplyReport;
  samplePreset: SamplePsdPreset;
  setSamplePreset: (preset: SamplePsdPreset) => void;
  onImport: (file: File) => void;
  onSample: () => void;
  onReplaceTextures: (file: File) => void;
  onImportDepthMap: (file: File) => void;
  onInvertDepthMap: () => void;
  onUseProxyDepth: () => void;
  depthMode: RigProject["depthMode"];
  depthMapSource?: string;
  onImportProject: (file: File) => void;
  onApplyTemplate: (file: File) => void;
  onExportProject: () => void;
  onExportTemplate: () => void;
  onExportRuntime: () => void;
  onOpenRuntimeWindow: () => void;
  onExportReplacementPack: () => void;
  onExportFinishedPack: () => void;
  onImportFinishedPack: (file: File) => void;
  onImportObjectPsd: (file: File) => void;
  onImportExpressionPsd: (file: File) => void;
  onSaveDraft: () => void;
  onLoadDraft: () => void;
  hasDraft: boolean;
  busy: boolean;
}) {
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);
  return (
    <section className="panel-block">
      <div className="block-title">
        <Layers size={17} />
        <span>PSD 导入</span>
      </div>
      <label className="file-drop">
        <input
          type="file"
          accept=".psd,image/vnd.adobe.photoshop"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = "";
          }}
        />
        <Upload size={18} />
        <span>选择 PSD</span>
      </label>
      <label className="preset-select">
        <span>示例预设</span>
        <select
          value={samplePreset}
          disabled={busy}
          onChange={(event) => setSamplePreset(event.currentTarget.value as SamplePsdPreset)}
        >
          {samplePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onSample} disabled={busy}>
        <Wand2 size={16} />
        加载示例 PSD
      </button>
      <label className="file-drop secondary-drop">
        <input
          type="file"
          accept=".psd,image/vnd.adobe.photoshop"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onReplaceTextures(file);
            event.currentTarget.value = "";
          }}
        />
        <Upload size={18} />
        <span>替换材质 PSD</span>
      </label>
      <label className="compact-file-button">
        <input
          type="file"
          accept=".psd,image/*"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onImportDepthMap(file);
            event.currentTarget.value = "";
          }}
        />
        <Upload size={16} />
        导入深度图
      </label>
      <div className="button-row">
        <button type="button" onClick={onInvertDepthMap}>
          <RotateCcw size={16} />
          反转深度
        </button>
        <button type="button" onClick={onUseProxyDepth}>
          <Box size={16} />
          头模代理
        </button>
      </div>
      <div className="report compact-report">
        <strong>深度模式：{depthMode === "proxyHead" ? "头模代理" : depthMode === "depthMap" ? "深度图" : "手动"}</strong>
        <span>{depthMapSource || "使用每个顶点保存的 Z-depth。"}</span>
      </div>
      <button
        type="button"
        className="collapse-toggle"
        aria-expanded={projectToolsOpen}
        onClick={() => setProjectToolsOpen((open) => !open)}
      >
        {projectToolsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        工程 / 包管理
        <span>导入导出</span>
      </button>
      {projectToolsOpen ? (
        <div className="project-action-group">
          <div className="button-row">
            <label className="compact-file-button">
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onImportFinishedPack(file);
                  event.currentTarget.value = "";
                }}
              />
              <FolderOpen size={16} />
              导入成品包
              <ActionHint text="导入已适配的 live2d 成品 ZIP，包含 PSD 图层、绑定参数和运行配置，打开即用。" />
            </label>
            <button type="button" onClick={onExportFinishedPack}>
              <Download size={16} />
              成品包 ZIP
              <ActionHint text="导出当前已适配项目为成品 ZIP，交给别人导入后不需要重新适配。" />
            </button>
          </div>
          <div className="button-row">
            <label className="compact-file-button">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onImportProject(file);
                  event.currentTarget.value = "";
                }}
              />
              <FileJson size={16} />
              导入工程
              <ActionHint text="导入本工具导出的工程 JSON，恢复图层、参数、伪 Z、模板和物理配置。" />
            </label>
            <label className="compact-file-button">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onApplyTemplate(file);
                  event.currentTarget.value = "";
                }}
              />
              <Wand2 size={16} />
              套用模板
              <ActionHint text="把另一个已适配角色的骨骼、网格、变形、Z 轴和动态模板套用到当前 PSD。" />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={onExportProject}>
              <FileJson size={16} />
              工程 JSON
              <ActionHint text="导出当前工程参数 JSON，适合自己备份或后续继续编辑。" />
            </button>
            <button type="button" onClick={onExportTemplate}>
              <Save size={16} />
              模板 JSON
              <ActionHint text="导出可复用绑定模板，用来给相似结构的新 PSD 一键套用。" />
            </button>
          </div>
          <div className="button-row">
            <button type="button" onClick={onExportRuntime}>
              <Download size={16} />
              运行时 HTML
              <ActionHint text="导出单文件运行时 HTML，可单独打开或作为 OBS 浏览器源使用。" />
            </button>
            <button type="button" onClick={onOpenRuntimeWindow}>
              <PictureInPicture size={16} />
              小窗预览
              <ActionHint text="打开独立小窗预览，支持绿幕、透明背景、拖动和缩放，便于 OBS 捕捉。" />
            </button>
          </div>
          <button type="button" onClick={onExportReplacementPack}>
            <Download size={16} />
            替换包 ZIP
            <ActionHint text="导出 reference.png 和结构信息，方便外部 AI 按同姿态生成新角色材质。" />
          </button>
          <div className="button-row">
            <label className="compact-file-button">
              <input
                type="file"
                accept=".psd,image/vnd.adobe.photoshop"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onImportObjectPsd(file);
                  event.currentTarget.value = "";
                }}
              />
              <Plus size={16} />
              挂载 obj PSD
              <ActionHint text="导入非规范拆分部件作为 obj 小组件，绑定到某个父级部位一起运动。" />
            </label>
            <label className="compact-file-button">
              <input
                type="file"
                accept=".psd,image/vnd.adobe.photoshop"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onImportExpressionPsd(file);
                  event.currentTarget.value = "";
                }}
              />
              <Eye size={16} />
              表情差分 PSD
              <ActionHint text="导入完整表情差分拆出的眼睛、嘴、脸红等部件，挂到当前角色作为可切换表情。" />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={onSaveDraft}>
              <Save size={16} />
              保存草稿
              <ActionHint text="把当前工程暂存到浏览器本地，用于快速恢复当前机器上的编辑状态。" />
            </button>
            <button type="button" onClick={onLoadDraft} disabled={!hasDraft}>
              <FolderOpen size={16} />
              恢复草稿
              <ActionHint text="从浏览器本地草稿恢复上次保存的工程。" />
            </button>
          </div>
        </div>
      ) : null}
      {report ? (
        <div className="report">
          <strong>{report.fileName}</strong>
          <span>{report.canvasWidth} x {report.canvasHeight} / {report.visibleLayerCount} visible</span>
          <span>{report.unknownLayerCount} 个未识别图层，{report.objectLayerCount ?? 0} 个 obj，{report.expressionLayerCount ?? 0} 个表情层，{report.zFixes.length} 个图层应用推荐 Z</span>
          {report.safetyLimits ? (
            <span>
              自动上限 头 {report.safetyLimits.head.x}/{report.safetyLimits.head.y}/{report.safetyLimits.head.z} 度 · 身体 {report.safetyLimits.body.x}/{report.safetyLimits.body.y}/{report.safetyLimits.body.z} 度
            </span>
          ) : null}
        </div>
      ) : null}
      {templateReport ? (
        <div className="report">
          <strong>{templateReport.fileName}</strong>
          <span>匹配置信度 {templateReport.confidence}% / 已匹配 {templateReport.matchedLayers} 层，未匹配 {templateReport.unmatchedLayers} 层</span>
          <span>{templateReport.exactNameMatches} 个同名匹配，{templateReport.kindMatches} 个同部位匹配，{templateReport.unusedTemplateLayers} 个模板层未使用</span>
          {templateReport.criticalMissing.length ? (
            <span className="report-warning">缺少关键层：{templateReport.criticalMissing.map(kindLabel).join("、")}</span>
          ) : null}
          {templateReport.warnings.slice(0, 3).map((warning) => (
            <span className="report-warning" key={warning}>{warning}</span>
          ))}
          <div className="match-list">
            {templateReport.layerMatches.slice(0, 10).map((item) => (
              <div className={`match-row ${item.match === "none" ? "bad" : item.match === "kind" ? "soft" : ""}`} key={item.layerId}>
                <span>{item.sourceName}</span>
                <b>{item.match === "exact" ? "同名" : item.match === "kind" ? "部位" : "未匹配"}</b>
                <em>{Math.round(item.confidence * 100)}%</em>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ToolPanel({ mode, setMode, dark, setDark }: { mode: ToolMode; setMode: (mode: ToolMode) => void; dark: boolean; setDark: (dark: boolean) => void }) {
  const tools: Array<{ id: ToolMode; icon: React.ReactNode; label: string }> = [
    { id: "select", icon: <MousePointer2 size={16} />, label: "选择" },
    { id: "bone", icon: <Bone size={16} />, label: "骨骼" },
    { id: "mesh", icon: <Box size={16} />, label: "网格" },
    { id: "physics", icon: <Activity size={16} />, label: "物理" },
    { id: "widget", icon: <Plus size={16} />, label: "小部件" }
  ];
  return (
    <section className="panel-block">
      <div className="block-title">
        <SlidersHorizontal size={17} />
        <span>工具</span>
      </div>
      <div className="segmented">
        {tools.map((tool) => (
          <button key={tool.id} className={mode === tool.id ? "active" : ""} type="button" onClick={() => setMode(tool.id)}>
            {tool.icon}
            {tool.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setDark(!dark)}>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
        {dark ? "白天模式" : "夜间模式"}
      </button>
    </section>
  );
}

function LayerPanel({
  layers,
  selectedLayerId,
  setSelectedLayerId,
  setProject,
  physicsTemplates
}: {
  layers: PsdLayerAsset[];
  selectedLayerId?: string;
  setSelectedLayerId: (id: string) => void;
  setProject: (patch: (layers: PsdLayerAsset[]) => PsdLayerAsset[]) => void;
  physicsTemplates: PhysicsTemplate[];
}) {
  return (
    <section className="panel-block layer-panel">
      <div className="block-title">
        <Eye size={17} />
        <span>图层 / Z 轴</span>
      </div>
      <div className="layer-list">
        {[...layers].sort((a, b) => b.z - a.z).map((layer) => (
          <div
            key={layer.id}
            role="button"
            tabIndex={0}
            data-layer-id={layer.id}
            className={`layer-row ${selectedLayerId === layer.id ? "active" : ""} ${layer.visible ? "" : "is-hidden"}`}
            onPointerDown={() => setSelectedLayerId(layer.id)}
            onClick={() => setSelectedLayerId(layer.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedLayerId(layer.id);
              }
            }}
          >
            <button
              type="button"
              className="layer-visibility-button"
              title={layer.visible ? "隐藏此部件" : "显示此部件"}
              aria-label={`${layer.visible ? "隐藏" : "显示"} ${layer.sourceName}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setProject((items) => items.map((item) => (item.id === layer.id ? { ...item, visible: !item.visible } : item)));
              }}
            >
              {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <span className="layer-name">{layer.sourceName}</span>
            <span className="layer-kind">{kindLabel(layer.kind)} · {layerRoleLabel(layer)}</span>
            <input
              aria-label={`${layer.sourceName} z`}
              type="number"
              value={Math.round(layer.z * 100) / 100}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const z = Number(event.currentTarget.value);
                setProject((items) => items.map((item) => (item.id === layer.id ? { ...item, z } : item)));
              }}
            />
          </div>
        ))}
      </div>
      {selectedLayerId ? (
        <div className="field-grid">
          <label>
            父骨骼
            <select
              value={layers.find((layer) => layer.id === selectedLayerId)?.parentBoneId}
              onChange={(event) => {
                const parentBoneId = event.currentTarget.value;
                setProject((items) => items.map((item) => (item.id === selectedLayerId ? { ...item, parentBoneId } : item)));
              }}
            >
              {standardParentBoneIds.map((id) => (
                <option key={id} value={id}>{boneLabel(id)}</option>
              ))}
            </select>
          </label>
          <label>
            物理模板
            <select
              value={layers.find((layer) => layer.id === selectedLayerId)?.physicsTemplateId ?? ""}
              onChange={(event) => {
                const physicsTemplateId = event.currentTarget.value || undefined;
                setProject((items) => items.map((item) => (item.id === selectedLayerId ? { ...item, physicsTemplateId } : item)));
              }}
            >
              <option value="">无</option>
              {physicsTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}

function applyExpressionPreset(parameters: RigParameter[], values: Partial<Record<ParameterId, number>>): RigParameter[] {
  return parameters.map((parameter) => ({
    ...parameter,
    value: clamp(values[parameter.id] ?? parameter.defaultValue, parameter.min, parameter.max)
  }));
}

function ParameterPanel({ project, setProject }: { project: RigProject; setProject: Dispatch<SetStateAction<RigProject>> }) {
  const [lookAround, setLookAround] = useState(false);
  const parameters = project.parameters;
  const snapshots = project.parameterSnapshots ?? [];
  const setParameters = (nextParameters: RigParameter[]) => setProject((current) => ({ ...current, parameters: nextParameters }));
  const saveSnapshot = () => {
    setLookAround(false);
    setProject((current) => {
      const currentSnapshots = current.parameterSnapshots ?? [];
      const createdAt = new Date();
      const name = `参数记录 ${currentSnapshots.length + 1} ${createdAt.toLocaleTimeString([], { hour12: false })}`;
      const snapshot: ParameterSnapshot = {
        id: `snapshot-${Date.now()}`,
        name,
        createdAt: createdAt.toISOString(),
        parameters: structuredClone(current.parameters.filter((parameter) => !realtimeTrackingParameterIds.has(parameter.id))),
        depthTuning: structuredClone({ ...defaultDepthTuning, ...current.depthTuning }),
        dynamicsTuning: structuredClone({ ...defaultDynamicsTuning, ...current.dynamicsTuning }),
        stageBackground: current.stageBackground ?? "checker",
        headRollPivot: structuredClone({ ...defaultHeadRollPivot, ...current.headRollPivot })
      };
      return {
        ...current,
        parameterSnapshots: [snapshot, ...currentSnapshots]
      };
    });
  };
  const restoreSnapshot = (snapshot: ParameterSnapshot) => {
    setLookAround(false);
    setProject((current) =>
      withProjectDefaults({
        ...current,
        parameters: current.parameters.map((parameter) => {
          if (realtimeTrackingParameterIds.has(parameter.id)) return parameter;
          const saved = snapshot.parameters.find((item) => item.id === parameter.id);
          return saved ? structuredClone(saved) : parameter;
        }),
        depthTuning: structuredClone(snapshot.depthTuning ?? current.depthTuning),
        dynamicsTuning: structuredClone(snapshot.dynamicsTuning ?? current.dynamicsTuning),
        stageBackground: snapshot.stageBackground ?? current.stageBackground ?? "checker",
        headRollPivot: structuredClone(snapshot.headRollPivot ?? current.headRollPivot)
      })
    );
  };
  const deleteSnapshot = (id: string) => {
    setProject((current) => ({
      ...current,
      parameterSnapshots: (current.parameterSnapshots ?? []).filter((snapshot) => snapshot.id !== id)
    }));
  };

  useEffect(() => {
    if (!lookAround) return;
    let raf = 0;
    const startedAt = performance.now();
    const tick = () => {
      const t = (performance.now() - startedAt) / 1000;
      const x = Math.sin(t * 1.35);
      const y = Math.sin(t * 0.92 + 1.1);
      setProject((current) => ({
        ...current,
        parameters: current.parameters.map((parameter) => {
          const patch: Partial<Record<ParameterId, number>> = {
            ParamAngleX: x * 10,
            ParamAngleY: y * 4,
            ParamEyeBallX: x * 0.82,
            ParamEyeBallY: y * 0.36,
            ParamEyeLOpen: 1,
            ParamEyeROpen: 1
          };
          const next = patch[parameter.id];
          return next === undefined ? parameter : { ...parameter, value: clamp(next, parameter.min, parameter.max) };
        })
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lookAround, setProject]);
  return (
    <section className="right-block">
      <div className="block-title">
        <SlidersHorizontal size={17} />
        <span>参数预览</span>
      </div>
      <div className="preset-grid">
        {expressionPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              setLookAround(false);
              setParameters(applyExpressionPreset(parameters, preset.values));
            }}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className={lookAround ? "active" : ""} onClick={() => setLookAround((value) => !value)}>
          左顾右盼
        </button>
      </div>
      <div className="parameter-group snapshot-group">
        <strong>参数记录</strong>
        <button type="button" onClick={saveSnapshot}>
          <Save size={16} />
          保存当前调节
        </button>
        {snapshots.length ? (
          <div className="snapshot-list">
            {snapshots.slice(0, 8).map((snapshot) => (
              <div className="snapshot-row" key={snapshot.id}>
                <span title={new Date(snapshot.createdAt).toLocaleString()}>{snapshot.name}</span>
                <button type="button" onClick={() => restoreSnapshot(snapshot)}>恢复</button>
                <button type="button" onClick={() => deleteSnapshot(snapshot.id)}>删除</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">暂无记录。保存后会随工程 JSON 一起导出。</p>
        )}
      </div>
      {parameterGroups.map((group) => (
        <div className="parameter-group" key={group.title}>
          <strong>{group.title}</strong>
          {group.ids.map((id) => {
            const parameter = parameters.find((item) => item.id === id);
            if (!parameter) return null;
            return (
              <label className="slider-row" key={id}>
                <span>{parameter.label}</span>
                <input
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={(parameter.max - parameter.min) <= 2 ? 0.01 : 1}
                  value={parameter.value}
                  onChange={(event) => {
                    setLookAround(false);
                    setParameters(patchParameter(parameters, id, Number(event.currentTarget.value)));
                  }}
                />
                <em>{Math.round(parameter.value * 100) / 100}</em>
              </label>
            );
          })}
        </div>
      ))}
      <button type="button" onClick={() => {
        setLookAround(false);
        setParameters(parameters.map((parameter) => ({ ...parameter, value: parameter.defaultValue })));
      }}>
        <RotateCcw size={16} />
        重置参数
      </button>
    </section>
  );
}

function ExpressionDiffPanel({ project, setProject }: { project: RigProject; setProject: (project: RigProject) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Map<string, { label: string; count: number }>>();
    for (const layer of project.layers) {
      const group = expressionGroupForLayer(layer);
      if (!group) continue;
      const key = expressionKeyForLayer(layer);
      const groupMap = map.get(group) ?? new Map<string, { label: string; count: number }>();
      const current = groupMap.get(key);
      groupMap.set(key, {
        label: current?.label ?? expressionLabel(key),
        count: (current?.count ?? 0) + 1
      });
      map.set(group, groupMap);
    }
    return [...map.entries()].map(([group, entries]) => ({
      group,
      entries: [...entries.entries()].map(([key, value]) => ({ key, ...value }))
    }));
  }, [project.layers]);

  const active = project.expressionState?.active ?? {};
  const setActive = (group: string, key?: string) => {
    const nextActive = { ...active };
    if (key) nextActive[group] = key;
    else delete nextActive[group];
    setProject({
      ...project,
      expressionState: {
        active: nextActive
      }
    });
  };

  return (
    <section className="right-block">
      <div className="block-title">
        <Eye size={17} />
        <span>表情差分</span>
      </div>
      {groups.length ? (
        groups.map((item) => (
          <div className="parameter-group expression-diff-group" key={item.group}>
            <strong>{item.group}</strong>
            <div className="expression-switch-grid">
              <button type="button" className={!active[item.group] ? "active" : ""} onClick={() => setActive(item.group)}>
                关闭
              </button>
              {item.entries.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  className={active[item.group] === entry.key ? "active" : ""}
                  onClick={() => setActive(item.group, entry.key)}
                  title={`${entry.count} layers`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="muted">还没有导入表情差分 PSD。导入后同一竞争组一次只会显示一个表情。</p>
      )}
    </section>
  );
}

function TrackingPanel({
  settings,
  setSettings,
  tracking,
  running,
  status,
  videoRef,
  onStart,
  onStop
}: {
  settings: TrackingSettings;
  setSettings: (settings: TrackingSettings) => void;
  tracking: TrackingState;
  running: boolean;
  status: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onStart: () => void;
  onStop: () => void;
}) {
  const angleLimits = settings.angleLimits ?? defaultTrackingSettings.angleLimits ?? { x: 45, y: 45, z: 0 };
  const poseEnabled = Boolean(settings.poseEnabled) && settings.tier !== "eco";
  const previewMode = settings.previewMode ?? "video";
  const eyeYGain = settings.eyeYGain ?? defaultTrackingSettings.eyeYGain ?? 1.75;
  const mouthOpenLimit = settings.mouthOpenLimit ?? defaultTrackingSettings.mouthOpenLimit ?? 0.72;
  const poseLimit = settings.poseLimit ?? defaultTrackingSettings.poseLimit ?? 1;
  const armLimit = settings.armLimit ?? defaultTrackingSettings.armLimit ?? 1;
  const poseFps = settings.poseFps ?? defaultTrackingSettings.poseFps ?? 20;
  const armRotationReverse = {
    left: Boolean(settings.armRotationReverse?.left),
    right: Boolean(settings.armRotationReverse?.right)
  };
  const interpolationMultiplier = settings.interpolationMultiplier ?? defaultTrackingSettings.interpolationMultiplier ?? 2;
  const forceSmoothing = settings.forceSmoothing ?? defaultTrackingSettings.forceSmoothing ?? true;
  const antiJitter = settings.antiJitter ?? defaultTrackingSettings.antiJitter ?? true;
  const setAngleLimit = (axis: "x" | "y" | "z", value: number) => {
    setSettings({
      ...settings,
      angleLimits: {
        ...angleLimits,
        [axis]: clamp(value, 0, 90)
      }
    });
  };

  return (
    <section className="right-block">
      <div className="block-title">
        <Camera size={17} />
        <span>摄像头面捕</span>
      </div>
      <div className={`camera-preview ${previewMode === "points" ? "points-mode" : ""}`}>
        <video ref={videoRef} playsInline muted />
        {previewMode === "points" ? (
          <svg className="tracking-points" viewBox="0 0 1 1" preserveAspectRatio="none">
            {(tracking.facePoints ?? []).map((point, index) => (
              <circle className="face-point" key={`face-${index}`} cx={1 - point.x} cy={point.y} r={index < 14 ? 0.006 : 0.0038} />
            ))}
            {(tracking.posePoints ?? []).map((point, index) => (
              <circle className="pose-point" key={`pose-${index}`} cx={1 - point.x} cy={point.y} r={index < 2 ? 0.012 : 0.014} />
            ))}
          </svg>
        ) : null}
        <span>{status}</span>
      </div>
      <div className="field-grid">
        <label>
          预览
          <select
            value={previewMode}
            onChange={(event) => setSettings({ ...settings, previewMode: event.currentTarget.value as TrackingSettings["previewMode"] })}
          >
            <option value="video">摄像头</option>
            <option value="points">追踪点</option>
          </select>
        </label>
        <label>
          性能档
          <select
            value={settings.tier}
            onChange={(event) => {
              const tier = event.currentTarget.value as TrackingSettings["tier"];
              setSettings({ ...settings, tier, poseEnabled: tier !== "eco" ? Boolean(settings.poseEnabled) : false });
            }}
          >
            <option value="eco">省电：脸部低频</option>
            <option value="balanced">均衡：脸部稳定</option>
            <option value="quality">质量：脸部高频</option>
          </select>
        </label>
        <label>
          分辨率
          <select
            value={`${settings.width}x${settings.height}`}
            onChange={(event) => {
              const [width, height] = event.currentTarget.value.split("x").map(Number);
              setSettings({ ...settings, width, height });
            }}
          >
            <option value="320x240">320 x 240</option>
            <option value="640x480">640 x 480</option>
            <option value="960x540">960 x 540</option>
            <option value="1280x720">1280 x 720</option>
          </select>
        </label>
        <label>
          FPS
          <input
            type="number"
            min={10}
            max={60}
            value={settings.fps}
            onChange={(event) => setSettings({ ...settings, fps: clamp(Number(event.currentTarget.value) || defaultTrackingSettings.fps, 10, 60) })}
          />
        </label>
        <label>
          姿态FPS
          <select value={poseFps} onChange={(event) => setSettings({ ...settings, poseFps: Number(event.currentTarget.value) })}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </label>
        <label>
          平滑
          <input type="range" min={0} max={0.85} step={0.01} value={settings.smoothing} onChange={(event) => setSettings({ ...settings, smoothing: Number(event.currentTarget.value) })} />
        </label>
        <label>
          补帧
          <select
            value={interpolationMultiplier}
            onChange={(event) => setSettings({ ...settings, interpolationMultiplier: Number(event.currentTarget.value) })}
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={settings.microphoneVowels} onChange={(event) => setSettings({ ...settings, microphoneVowels: event.currentTarget.checked })} />
        麦克风元音口型预留
      </label>
      <label className="check-row">
        <input type="checkbox" checked={forceSmoothing} onChange={(event) => setSettings({ ...settings, forceSmoothing: event.currentTarget.checked })} />
        强制平滑面捕参数
      </label>
      <label className="check-row">
        <input type="checkbox" checked={antiJitter} onChange={(event) => setSettings({ ...settings, antiJitter: event.currentTarget.checked })} />
        防抽搐：丢弃瞬时漂移帧
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={poseEnabled}
          disabled={settings.tier === "eco"}
          onChange={(event) => setSettings({ ...settings, poseEnabled: event.currentTarget.checked })}
        />
        启用姿态/手臂识别（均衡/质量）
      </label>
      <div className="parameter-group compact-parameter-group">
        <strong>面捕头部上限</strong>
        {(["x", "y", "z"] as const).map((axis) => (
          <label className="slider-row" key={axis}>
            <span>{axis.toUpperCase()}</span>
            <input
              type="range"
              min={0}
              max={90}
              step={1}
              value={angleLimits[axis]}
              onChange={(event) => setAngleLimit(axis, Number(event.currentTarget.value))}
            />
            <em>{Math.round(angleLimits[axis])}°</em>
          </label>
        ))}
        <label className="slider-row">
          <span>嘴巴</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={mouthOpenLimit}
            onChange={(event) => setSettings({ ...settings, mouthOpenLimit: clamp(Number(event.currentTarget.value), 0.05, 1) })}
          />
          <em>{Math.round(mouthOpenLimit * 100)}%</em>
        </label>
        <label className="slider-row">
          <span>姿态</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={poseLimit}
            onChange={(event) => setSettings({ ...settings, poseLimit: clamp(Number(event.currentTarget.value), 0, 3) })}
          />
          <em>{Math.round(poseLimit * 100)}%</em>
        </label>
        <label className="slider-row">
          <span>手臂</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={armLimit}
            onChange={(event) => setSettings({ ...settings, armLimit: clamp(Number(event.currentTarget.value), 0, 2) })}
          />
          <em>{Math.round(armLimit * 100)}%</em>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={armRotationReverse.left}
            onChange={(event) =>
              setSettings({
                ...settings,
                armRotationReverse: { ...armRotationReverse, left: event.currentTarget.checked }
              })
            }
          />
          左臂旋转反转
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={armRotationReverse.right}
            onChange={(event) =>
              setSettings({
                ...settings,
                armRotationReverse: { ...armRotationReverse, right: event.currentTarget.checked }
              })
            }
          />
          右臂旋转反转
        </label>
      </div>
      <div className="parameter-group compact-parameter-group">
        <strong>眼球追踪</strong>
        <label className="slider-row">
          <span>上下灵敏</span>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.05}
            value={eyeYGain}
            onChange={(event) => setSettings({ ...settings, eyeYGain: Number(event.currentTarget.value) })}
          />
          <em>{Math.round(eyeYGain * 100)}%</em>
        </label>
      </div>
      <button type="button" onClick={running ? onStop : onStart}>
        <Play size={16} />
        {running ? "停止面捕" : "启动面捕"}
      </button>
      <div className="tracking-readout">
        <span>Face {tracking.hasFace ? "OK" : "--"}</span>
        <span>Pose {tracking.hasPose ? "OK" : "--"}</span>
        <span>{tracking.fps} fps</span>
        <span>Yaw {tracking.yaw.toFixed(2)}</span>
        <span>Mouth {tracking.mouthOpen.toFixed(2)}</span>
        <span>Arm {tracking.armLeft.toFixed(2)} / {tracking.armRight.toFixed(2)}</span>
        <span>Body {tracking.bodyLeanX.toFixed(2)} / {tracking.bodyLeanY.toFixed(2)}</span>
        <span>Pts F{tracking.facePoints?.length ?? 0} / P{tracking.posePoints?.length ?? 0}</span>
        <span>ArmRaw {tracking.poseDebug?.armLeftRaw.toFixed(2) ?? "--"} / {tracking.poseDebug?.armRightRaw.toFixed(2) ?? "--"}</span>
        <span>
          EW L{tracking.poseDebug?.leftElbow ? "E" : "-"}{tracking.poseDebug?.leftWrist ? "W" : "-"} R{tracking.poseDebug?.rightElbow ? "E" : "-"}{tracking.poseDebug?.rightWrist ? "W" : "-"}
        </span>
        <span>Lift L {tracking.poseDebug?.leftElbowLift.toFixed(1) ?? "--"} / {tracking.poseDebug?.leftWristLift.toFixed(1) ?? "--"}</span>
        <span>Lift R {tracking.poseDebug?.rightElbowLift.toFixed(1) ?? "--"} / {tracking.poseDebug?.rightWristLift.toFixed(1) ?? "--"}</span>
      </div>
    </section>
  );
}

function BindingPanel({
  project,
  selectedLayerId,
  selectedBoneId,
  selectedWidgetId,
  setProject,
  setSelectedLayerId,
  setSelectedWidgetId
}: {
  project: RigProject;
  selectedLayerId?: string;
  selectedBoneId?: string;
  selectedWidgetId?: string;
  setProject: (project: RigProject) => void;
  setSelectedLayerId: (id?: string) => void;
  setSelectedWidgetId: (id?: string) => void;
}) {
  const selectedBone = project.bones.find((bone) => bone.id === selectedBoneId);
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId);
  const selectedWidget = project.widgets.find((widget) => widget.id === selectedWidgetId);
  const selectedLayerPivot = selectedLayer ? selectedLayer.pivot ?? defaultPivotForKind(selectedLayer.kind, selectedLayer.naturalBounds, selectedLayer.side) : undefined;
  const selectedLayerCenter = selectedLayer ? rectCenter(selectedLayer.naturalBounds) : undefined;
  const selectedLayerAverageDepth = selectedLayer ? averageMeshDepth(selectedLayer.mesh) : 0;
  const selectedLayerLocalScale = selectedLayer ? selectedLayer.localScale ?? 1 : 1;
  const selectedLayerLocalRotation = selectedLayer ? selectedLayer.localRotation ?? 0 : 0;
  const depthTuning = { ...defaultDepthTuning, ...project.depthTuning };
  const dynamicsTuning = { ...defaultDynamicsTuning, ...project.dynamicsTuning };
  const headRollPivot = { ...defaultHeadRollPivot, ...project.headRollPivot };
  const depthTuningRangeFor = (key: keyof typeof depthTuning) => {
    if (key === "mouthOpenScaleLimit") return { min: 0, max: maxMouthOpenScaleLimit, step: 0.01 };
    if (key === "headProxyZOffset") return { min: -0.18, max: 0.18, step: 0.005 };
    if (key === "headProxyDepthScale") return { min: 0.35, max: 1.8, step: 0.01 };
    return { min: 0, max: 1, step: 0.01 };
  };
  const formatDepthTuningValue = (key: keyof typeof depthTuning) => {
    const value = depthTuning[key];
    if (key === "headProxyZOffset") return value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
    return `${Math.round(value * 100)}%`;
  };
  const setDepthTuningValue = (key: keyof typeof depthTuning, value: number) => {
    const range = depthTuningRangeFor(key);
    setProject({
      ...project,
      depthTuning: {
        ...depthTuning,
        [key]: clamp(value, range.min, range.max)
      }
    });
  };
  const setDynamicsTuningValue = (key: keyof typeof dynamicsTuning, value: number) => {
    setProject({
      ...project,
      dynamicsTuning: {
        ...dynamicsTuning,
        [key]: clamp(value, 0, 1.5)
      }
    });
  };
  const setHeadRollPivotValue = (axis: keyof Point, value: number) => {
    setProject({
      ...project,
      headRollPivot: {
        ...headRollPivot,
        [axis]: clamp(value, 0, 1)
      }
    });
  };
  const patchSelectedPivot = (patch: Partial<Point>) => {
    if (!selectedLayer || !selectedLayerPivot) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === selectedLayer.id
          ? {
              ...layer,
              pivot: {
                ...selectedLayerPivot,
                ...patch
              }
            }
          : layer
      )
    });
  };
  const resetSelectedPivot = () => {
    if (!selectedLayer) return;
    const pivot = defaultPivotForKind(selectedLayer.kind, selectedLayer.naturalBounds, selectedLayer.side);
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, pivot } : layer))
    });
  };
  const moveSelectedLayerCenter = (axis: keyof Point, value: number) => {
    if (!selectedLayer || !selectedLayerCenter || !Number.isFinite(value)) return;
    const dx = axis === "x" ? value - selectedLayerCenter.x : 0;
    const dy = axis === "y" ? value - selectedLayerCenter.y : 0;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? translateLayer(layer, dx, dy) : layer))
    });
  };
  const nudgeSelectedLayer = (dx: number, dy: number) => {
    if (!selectedLayer) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? translateLayer(layer, dx, dy) : layer))
    });
  };
  const setSelectedLayerZ = (z: number) => {
    if (!selectedLayer || !Number.isFinite(z)) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, z } : layer))
    });
  };
  const setSelectedLayerVisibility = (visible: boolean) => {
    if (!selectedLayer) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, visible } : layer))
    });
  };
  const setSelectedLayerAverageDepth = (value: number) => {
    if (!selectedLayer || !Number.isFinite(value)) return;
    const delta = value - selectedLayerAverageDepth;
    setProject({
      ...project,
      depthMode: "manual",
      layers: project.layers.map((layer) =>
        layer.id === selectedLayer.id
          ? {
              ...layer,
              mesh: {
                ...layer.mesh,
                depths: layer.mesh.points.map((_, index) => clamp((layer.mesh.depths?.[index] ?? 0) + delta, -1, 1))
              }
            }
          : layer
      )
    });
  };
  const setSelectedLayerLocalScale = (value: number) => {
    if (!selectedLayer || !Number.isFinite(value)) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, localScale: clamp(value, 0.05, 4) } : layer))
    });
  };
  const setSelectedLayerLocalRotation = (value: number) => {
    if (!selectedLayer || !Number.isFinite(value)) return;
    const rotation = ((value % 360) + 360) % 360;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, localRotation: rotation } : layer))
    });
  };
  const isDynamicLayer =
    selectedLayer?.kind === "frontHair" ||
    selectedLayer?.kind === "sideHair" ||
    selectedLayer?.kind === "backHair" ||
    selectedLayer?.kind === "accessory";
  const selectedInertiaScale = selectedLayer
    ? selectedLayer.inertiaScale ?? defaultLayerInertiaScale(selectedLayer.kind, selectedLayer.naturalBounds) ?? 1
    : 1;
  const [partLibrary, setPartLibrary] = useState<{ fileName: string; layers: PsdLayerAsset[]; selectedLayerId?: string }>();
  const standardParentLayers = project.layers.filter((layer) => layer.id !== selectedLayer?.id && layer.attachment?.type !== "expression");
  const selectedLayerRole = selectedLayer?.attachment?.type ?? "standard";
  const compatiblePartLayers = useMemo(() => {
    if (!selectedLayer || !partLibrary) return [];
    return partLibrary.layers
      .filter((layer) => layer.attachment?.type !== "expression")
      .map((layer) => {
        const sameKind = layer.kind === selectedLayer.kind;
        const sameSide = !selectedLayer.side || !layer.side || layer.side === selectedLayer.side;
        const score = (sameKind ? 2 : 0) + (sameSide ? 1 : 0);
        return { layer, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.layer.z - a.layer.z)
      .map((item) => item.layer);
  }, [partLibrary, selectedLayer]);
  const setSelectedLayerInertia = (value: number) => {
    if (!selectedLayer) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => (layer.id === selectedLayer.id ? { ...layer, inertiaScale: clamp(value, 0, 2.4) } : layer))
    });
  };
  const patchSelectedAttachment = (patch: NonNullable<PsdLayerAsset["attachment"]>) => {
    if (!selectedLayer) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === selectedLayer.id
          ? {
              ...layer,
              attachment: {
                ...layer.attachment,
                ...patch
              }
            }
          : layer
      )
    });
  };
  const setSelectedLayerRole = (role: "standard" | "object" | "expression") => {
    if (!selectedLayer) return;
    setProject({
      ...project,
      layers: project.layers.map((layer) => {
        if (layer.id !== selectedLayer.id) return layer;
        if (role === "standard") {
          const { attachment, ...rest } = layer;
          return rest;
        }
        if (role === "object") {
          return {
            ...layer,
            attachment: {
              type: "object",
              parentLayerId: layer.attachment?.parentLayerId,
              notes: layer.attachment?.notes
            }
          };
        }
        return {
          ...layer,
          attachment: {
            type: "expression",
            parentLayerId: layer.attachment?.parentLayerId,
            exclusiveGroup: layer.attachment?.exclusiveGroup || expressionDefaultGroup,
            expressionKey: layer.attachment?.expressionKey || expressionLabel(layer.sourceName)
          }
        };
      })
    });
  };
  const loadPartLibrary = async (file: File) => {
    try {
      const imported = await readProjectFile(file);
      const candidates = imported.layers.filter((layer) => layer.imageUrl && layer.kind !== "unknown");
      setPartLibrary({
        fileName: file.name,
        layers: candidates,
        selectedLayerId: candidates[0]?.id
      });
    } catch (error) {
      console.error(error);
      alert(`部件工程读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const replaceSelectedLayerTexture = () => {
    if (!selectedLayer || !partLibrary) return;
    const source = partLibrary.layers.find((layer) => layer.id === partLibrary.selectedLayerId) ?? compatiblePartLayers[0];
    if (!source) {
      alert("没有可替换的同类部件。");
      return;
    }
    setProject({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === selectedLayer.id
          ? {
              ...layer,
              imageUrl: source.imageUrl,
              opacity: source.opacity,
              blendMode: source.blendMode,
              sourceName: `${layer.sourceName} ← ${source.sourceName}`
            }
          : layer
      )
    });
  };

  return (
    <section className="right-block">
      <div className="block-title">
        <Bone size={17} />
        <span>绑定细节</span>
      </div>
      <div className="parameter-group compact-parameter-group">
        <strong>伪 Z 调节</strong>
        {[
          ["脸盘贴近脖子", "faceNeckBlend"],
          ["前发贴近脖子", "frontHairNeckBlend"],
          ["后发贴近脖子", "backHairNeckBlend"],
          ["克隆前发贴近脖子", "frontHairCloneNeckBlend"],
          ["克隆后发贴近脖子", "backHairCloneNeckBlend"],
          ["下巴缩放增强", "chinShrink"],
          ["眼球上下越界", "eyeVerticalOvershoot"],
          ["嘴张开上限", "mouthOpenScaleLimit"]
        ].map(([label, key]) => (
          <label className="slider-row" key={key}>
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={key === "mouthOpenScaleLimit" ? maxMouthOpenScaleLimit : 1}
              step={0.01}
              value={depthTuning[key as keyof typeof depthTuning]}
              onChange={(event) => setDepthTuningValue(key as keyof typeof depthTuning, Number(event.currentTarget.value))}
            />
            <em>{Math.round(depthTuning[key as keyof typeof depthTuning] * 100)}%</em>
          </label>
        ))}
        {(["headProxyZOffset", "headProxyDepthScale"] as const).map((key) => {
          const range = depthTuningRangeFor(key);
          return (
            <label className="slider-row" key={key}>
              <span>{key === "headProxyZOffset" ? "模拟头模伪 Z 位置" : "模拟头模伪 Z 厚度"}</span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={depthTuning[key]}
                onChange={(event) => setDepthTuningValue(key, Number(event.currentTarget.value))}
              />
              <em>{formatDepthTuningValue(key)}</em>
            </label>
          );
        })}
      </div>
      <div className="parameter-group compact-parameter-group">
        <strong>头部 Z 旋转支点</strong>
        {[
          ["支点 X", "x"],
          ["支点 Y", "y"]
        ].map(([label, axis]) => (
          <label className="slider-row" key={axis}>
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={headRollPivot[axis as keyof Point]}
              onChange={(event) => setHeadRollPivotValue(axis as keyof Point, Number(event.currentTarget.value))}
            />
            <em>{Math.round(headRollPivot[axis as keyof Point] * 100)}%</em>
          </label>
        ))}
      </div>
      <div className="parameter-group compact-parameter-group">
        <strong>动态调节</strong>
        {[
          ["前发惯性", "frontHairInertia"],
          ["后发惯性", "backHairInertia"],
          ["发饰惯性", "accessoryInertia"]
        ].map(([label, key]) => (
          <label className="slider-row" key={key}>
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={dynamicsTuning[key as keyof typeof dynamicsTuning]}
              onChange={(event) => setDynamicsTuningValue(key as keyof typeof dynamicsTuning, Number(event.currentTarget.value))}
            />
            <em>{Math.round(dynamicsTuning[key as keyof typeof dynamicsTuning] * 100)}%</em>
          </label>
        ))}
      </div>
      {selectedBone ? (
        <div className="detail-card">
          <strong>{selectedBone.name}</strong>
          <span>{selectedBone.kind} / {formatPct(selectedBone.position.x)}, {formatPct(selectedBone.position.y)}</span>
          <div className="field-grid">
            <label>
              父级
              <select
                value={selectedBone.parentId ?? ""}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, parentId: event.currentTarget.value || undefined } : bone))
                  })
                }
              >
                <option value="">无</option>
                {project.bones
                  .filter((bone) => bone.id !== selectedBone.id)
                  .map((bone) => (
                    <option key={bone.id} value={bone.id}>{bone.name}</option>
                  ))}
              </select>
            </label>
            <label>
              长度
              <input
                type="number"
                step={0.01}
                value={selectedBone.length}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, length: Number(event.currentTarget.value) } : bone))
                  })
                }
              />
            </label>
            <label>
              X
              <input
                type="number"
                step={0.01}
                value={selectedBone.position.x}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, position: { ...bone.position, x: Number(event.currentTarget.value) } } : bone))
                  })
                }
              />
            </label>
            <label>
              Y
              <input
                type="number"
                step={0.01}
                value={selectedBone.position.y}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, position: { ...bone.position, y: Number(event.currentTarget.value) } } : bone))
                  })
                }
              />
            </label>
            <label>
              旋转
              <input
                type="number"
                step={1}
                value={selectedBone.rotation}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, rotation: Number(event.currentTarget.value) } : bone))
                  })
                }
              />
            </label>
            <label>
              缩放
              <input
                type="number"
                step={0.01}
                value={selectedBone.scale}
                disabled={selectedBone.locked}
                onChange={(event) =>
                  setProject({
                    ...project,
                    bones: project.bones.map((bone) => (bone.id === selectedBone.id ? { ...bone, scale: Number(event.currentTarget.value) } : bone))
                  })
                }
              />
            </label>
          </div>
        </div>
      ) : (
        <p className="muted">选择骨骼后可手动输入坐标，也可以直接在画布拖动。</p>
      )}

      {selectedLayer ? (
        <div className="detail-card">
          <strong>{selectedLayer.sourceName}</strong>
          {selectedLayerCenter ? (
            <div className="parameter-group compact-parameter-group layer-coordinate-editor">
              <strong>部件坐标 / 显示</strong>
              <div className="field-grid">
                <label>
                  中心 X
                  <input
                    type="number"
                    min={-layerMoveOverflow}
                    max={1 + layerMoveOverflow}
                    step={0.001}
                    value={Number(selectedLayerCenter.x.toFixed(4))}
                    onChange={(event) => moveSelectedLayerCenter("x", Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  中心 Y
                  <input
                    type="number"
                    min={-layerMoveOverflow}
                    max={1 + layerMoveOverflow}
                    step={0.001}
                    value={Number(selectedLayerCenter.y.toFixed(4))}
                    onChange={(event) => moveSelectedLayerCenter("y", Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  图层 Z
                  <input
                    type="number"
                    step={1}
                    value={Math.round(selectedLayer.z * 100) / 100}
                    onChange={(event) => setSelectedLayerZ(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  平均伪 Z
                  <input
                    type="number"
                    min={-1}
                    max={1}
                    step={0.005}
                    value={Number(selectedLayerAverageDepth.toFixed(3))}
                    onChange={(event) => setSelectedLayerAverageDepth(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  Scale
                  <input
                    type="number"
                    min={0.05}
                    max={4}
                    step={0.01}
                    value={Number(selectedLayerLocalScale.toFixed(3))}
                    onChange={(event) => setSelectedLayerLocalScale(Number(event.currentTarget.value))}
                  />
                </label>
                <label>
                  Rotation
                  <input
                    type="number"
                    min={0}
                    max={360}
                    step={1}
                    value={Math.round(selectedLayerLocalRotation * 100) / 100}
                    onChange={(event) => setSelectedLayerLocalRotation(Number(event.currentTarget.value))}
                  />
                </label>
              </div>
              <div className="button-row coordinate-nudge-row">
                <button type="button" onClick={() => nudgeSelectedLayer(-0.005, 0)}>左移</button>
                <button type="button" onClick={() => nudgeSelectedLayer(0.005, 0)}>右移</button>
                <button type="button" onClick={() => nudgeSelectedLayer(0, -0.005)}>上移</button>
                <button type="button" onClick={() => nudgeSelectedLayer(0, 0.005)}>下移</button>
              </div>
              <label className="visibility-toggle">
                <input
                  type="checkbox"
                  checked={selectedLayer.visible}
                  onChange={(event) => setSelectedLayerVisibility(event.currentTarget.checked)}
                />
                显示此部件
              </label>
            </div>
          ) : null}
          <span>{kindLabel(selectedLayer.kind)} / {selectedLayer.mesh.rows} x {selectedLayer.mesh.cols} 网格 / {selectedLayer.deformers.length} 个变形器</span>
          <div className="field-grid">
            <label>
              图层角色
              <select
                value={selectedLayerRole}
                onChange={(event) => setSelectedLayerRole(event.currentTarget.value as "standard" | "object" | "expression")}
              >
                <option value="standard">标准部件</option>
                <option value="object">obj 小组件</option>
                <option value="expression">表情差分</option>
              </select>
            </label>
            <label>
              父级标准层
              <select
                value={selectedLayer.attachment?.parentLayerId ?? ""}
                disabled={selectedLayerRole === "standard"}
                onChange={(event) => {
                  const parentLayerId = event.currentTarget.value || undefined;
                  const parentLayer = project.layers.find((layer) => layer.id === parentLayerId);
                  patchSelectedAttachment({
                    type: selectedLayerRole === "expression" ? "expression" : "object",
                    parentLayerId,
                    ...(parentLayer ? { notes: `Attached to ${parentLayer.sourceName}` } : {})
                  });
                  if (parentLayer) {
                    setProject({
                      ...project,
                      layers: project.layers.map((layer) =>
                        layer.id === selectedLayer.id
                          ? {
                              ...layer,
                              parentBoneId: parentLayer.parentBoneId,
                              attachment: {
                                ...layer.attachment,
                                type: selectedLayerRole === "expression" ? "expression" : "object",
                                parentLayerId,
                                notes: `Attached to ${parentLayer.sourceName}`
                              }
                            }
                          : layer
                      )
                    });
                  }
                }}
              >
                <option value="">按父骨骼</option>
                {standardParentLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>{layer.sourceName} · {kindLabel(layer.kind)}</option>
                ))}
              </select>
            </label>
          </div>
          {selectedLayerRole === "expression" ? (
            <div className="field-grid">
              <label>
                竞争组
                <input
                  value={selectedLayer.attachment?.exclusiveGroup ?? expressionDefaultGroup}
                  onChange={(event) =>
                    patchSelectedAttachment({
                      type: "expression",
                      exclusiveGroup: event.currentTarget.value || expressionDefaultGroup
                    })
                  }
                />
              </label>
              <label>
                表情 Key
                <input
                  value={selectedLayer.attachment?.expressionKey ?? expressionLabel(selectedLayer.sourceName)}
                  onChange={(event) =>
                    patchSelectedAttachment({
                      type: "expression",
                      expressionKey: event.currentTarget.value || expressionLabel(selectedLayer.sourceName)
                    })
                  }
                />
              </label>
            </div>
          ) : null}
          <div className="parameter-group compact-parameter-group">
            <strong>跨工程部件复用</strong>
            <label className="compact-file-button">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void loadPartLibrary(file);
                  event.currentTarget.value = "";
                }}
              />
              <FolderOpen size={16} />
              加载部件工程
            </label>
            {partLibrary ? (
              <>
                <label>
                  候选部件（{partLibrary.fileName}）
                  <select
                    value={partLibrary.selectedLayerId ?? compatiblePartLayers[0]?.id ?? ""}
                    onChange={(event) =>
                      setPartLibrary({
                        ...partLibrary,
                        selectedLayerId: event.currentTarget.value
                      })
                    }
                  >
                    {compatiblePartLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.sourceName} · {kindLabel(layer.kind)}{layer.side ? ` ${layer.side}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={replaceSelectedLayerTexture} disabled={!compatiblePartLayers.length}>
                  <Wand2 size={16} />
                  替换当前贴图
                </button>
              </>
            ) : (
              <p className="muted">可从其它已适配工程借用同类标准部件，例如把另一个角色的眼珠替换到当前层。</p>
            )}
          </div>
          <div className="field-grid">
            <label>
              网格行
              <input
                type="number"
                min={2}
                max={16}
                value={selectedLayer.mesh.rows}
                onChange={(event) => {
                  const rows = Number(event.currentTarget.value);
                  setProject({
                    ...project,
                    layers: project.layers.map((layer) =>
                      layer.id === selectedLayer.id ? { ...layer, mesh: makeMeshWithDensity(layer.naturalBounds, rows, layer.mesh.cols, layer.kind) } : layer
                    )
                  });
                }}
              />
            </label>
            <label>
              网格列
              <input
                type="number"
                min={2}
                max={12}
                value={selectedLayer.mesh.cols}
                onChange={(event) => {
                  const cols = Number(event.currentTarget.value);
                  setProject({
                    ...project,
                    layers: project.layers.map((layer) =>
                      layer.id === selectedLayer.id ? { ...layer, mesh: makeMeshWithDensity(layer.naturalBounds, layer.mesh.rows, cols, layer.kind) } : layer
                    )
                  });
                }}
              />
            </label>
          </div>
          {isDynamicLayer ? (
            <div className="parameter-group compact-parameter-group">
              <strong>当前层惯性</strong>
              <label className="slider-row">
                <span>倍率</span>
                <input
                  type="range"
                  min={0}
                  max={2.4}
                  step={0.01}
                  value={selectedInertiaScale}
                  onChange={(event) => setSelectedLayerInertia(Number(event.currentTarget.value))}
                />
                <em>{Math.round(selectedInertiaScale * 100)}%</em>
              </label>
            </div>
          ) : null}
          {selectedLayerPivot ? (
            <>
              <div className="field-grid pivot-field-grid">
                <label>
                  Pivot X
                  <input
                    type="number"
                    step={0.01}
                    value={Math.round(selectedLayerPivot.x * 1000) / 1000}
                    onChange={(event) => patchSelectedPivot({ x: Number(event.currentTarget.value) })}
                  />
                </label>
                <label>
                  Pivot Y
                  <input
                    type="number"
                    step={0.01}
                    value={Math.round(selectedLayerPivot.y * 1000) / 1000}
                    onChange={(event) => patchSelectedPivot({ y: Number(event.currentTarget.value) })}
                  />
                </label>
              </div>
              {selectedLayer.kind === "arm" ? (
                <div className="button-row pivot-nudge-row">
                  <button type="button" onClick={() => patchSelectedPivot({ x: selectedLayerPivot.x + (selectedLayer.side === "right" ? -0.01 : 0.01) })}>
                    肩根外扩
                  </button>
                  <button type="button" onClick={() => patchSelectedPivot({ x: selectedLayerPivot.x + (selectedLayer.side === "right" ? 0.01 : -0.01) })}>
                    肩根内收
                  </button>
                  <button type="button" onClick={() => patchSelectedPivot({ y: selectedLayerPivot.y - 0.01 })}>
                    上移
                  </button>
                  <button type="button" onClick={() => patchSelectedPivot({ y: selectedLayerPivot.y + 0.01 })}>
                    下移
                  </button>
                  <button type="button" onClick={resetSelectedPivot}>
                    重置
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() =>
              setProject({
                ...project,
                layers: project.layers.map((layer) =>
                  layer.id === selectedLayer.id ? { ...layer, mesh: makeMeshWithDensity(layer.naturalBounds, layer.mesh.rows, layer.mesh.cols, layer.kind) } : layer
                )
              })
            }
          >
            <RotateCcw size={16} />
            重建当前网格
          </button>
          <div className="depth-editor">
            <div className="mini-title">顶点 Z-depth</div>
            <div className="depth-grid">
              {selectedLayer.mesh.points.map((_, index) => {
                const depth = selectedLayer.mesh.depths?.[index] ?? 0;
                return (
                  <label key={index}>
                    <span>{index + 1}</span>
                    <input
                      type="range"
                      min={-0.32}
                      max={0.32}
                      step={0.005}
                      value={depth}
                      onChange={(event) => {
                        const nextDepth = Number(event.currentTarget.value);
                        setProject({
                          ...project,
                          depthMode: "manual",
                          layers: project.layers.map((layer) =>
                            layer.id === selectedLayer.id
                              ? {
                                  ...layer,
                                  mesh: {
                                    ...layer.mesh,
                                    depths: layer.mesh.points.map((__, depthIndex) =>
                                      depthIndex === index ? nextDepth : layer.mesh.depths?.[depthIndex] ?? 0
                                    )
                                  }
                                }
                              : layer
                          )
                        });
                      }}
                    />
                    <em>{depth.toFixed(2)}</em>
                  </label>
                );
              })}
            </div>
            <div className="button-row">
              <button
                type="button"
                onClick={() =>
                  setProject({
                    ...project,
                    depthMode: "manual",
                    layers: project.layers.map((layer) =>
                      layer.id === selectedLayer.id
                        ? {
                            ...layer,
                            mesh: {
                              ...layer.mesh,
                              depths: layer.mesh.points.map((_, index) => (layer.mesh.depths?.[index] ?? 0) + 0.03)
                            }
                          }
                        : layer
                    )
                  })
                }
              >
                推近
              </button>
              <button
                type="button"
                onClick={() =>
                  setProject({
                    ...project,
                    depthMode: "manual",
                    layers: project.layers.map((layer) =>
                      layer.id === selectedLayer.id
                        ? {
                            ...layer,
                            mesh: {
                              ...layer.mesh,
                              depths: layer.mesh.points.map((_, index) => (layer.mesh.depths?.[index] ?? 0) - 0.03)
                            }
                          }
                        : layer
                    )
                  })
                }
              >
                推远
              </button>
            </div>
          </div>
          <div className="keyform-editor">
            <div className="mini-title">参数 Keyform</div>
            {selectedLayer.deformers.map((deformer) => (
              <div className="keyform-row" key={deformer.id}>
                <span>{deformer.parameter}</span>
                <div>
                  {deformer.keyframes.map((keyframe) => (
                    <i key={keyframe.value}>{keyframe.value}</i>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              splitLayerAtCenter(selectedLayer)
                .then(([left, right]) => {
                  setProject({
                    ...project,
                    layers: project.layers.flatMap((layer) => (layer.id === selectedLayer.id ? [left, right] : [layer]))
                  });
                  setSelectedLayerId(left.id);
                })
                .catch((error) => {
                  console.error(error);
                  alert(`左右拆分失败：${error instanceof Error ? error.message : String(error)}`);
                });
            }}
          >
            <Wand2 size={16} />
            左右拆分当前层
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          const widget = makeWidget(selectedBoneId ?? "head", project.widgets.length);
          setProject({ ...project, widgets: [...project.widgets, widget] });
          setSelectedWidgetId(widget.id);
        }}
      >
        <Plus size={16} />
        添加小部件
      </button>

      {selectedWidget ? (
        <div className="detail-card">
          <strong>{selectedWidget.name}</strong>
          <div className="field-grid">
            <label>
              名称
              <input
                value={selectedWidget.name}
                onChange={(event) =>
                  setProject({
                    ...project,
                    widgets: project.widgets.map((widget) => (widget.id === selectedWidget.id ? { ...widget, name: event.currentTarget.value } : widget))
                  })
                }
              />
            </label>
            <label>
              Z
              <input
                type="number"
                value={selectedWidget.z}
                onChange={(event) =>
                  setProject({
                    ...project,
                    widgets: project.widgets.map((widget) => (widget.id === selectedWidget.id ? { ...widget, z: Number(event.currentTarget.value) } : widget))
                  })
                }
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function App() {
  const [project, setProject] = useState<RigProject>(sampleProject);
  const [report, setReport] = useState<ImportReport>();
  const [templateReport, setTemplateReport] = useState<TemplateApplyReport>();
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [selectedBoneId, setSelectedBoneId] = useState<string | undefined>("head");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string>();
  const [mode, setMode] = useState<ToolMode>("select");
  const [busy, setBusy] = useState(false);
  const [samplePreset, setSamplePreset] = useState<SamplePsdPreset>("u3");
  const [dark, setDark] = useState(true);
  const [time, setTime] = useState(0);
  const [tracking, setTracking] = useState<TrackingState>(emptyTrackingState);
  const [trackingStatus, setTrackingStatus] = useState("未启动");
  const [trackingRunning, setTrackingRunning] = useState(false);
  const [hasDraft, setHasDraft] = useState(() => typeof localStorage !== "undefined" && Boolean(localStorage.getItem(localDraftKey)));
  const trackingController = useRef<TrackingController | null>(null);
  const trackingSessionRef = useRef(0);
  const trackingRestartTimer = useRef<number | undefined>(undefined);
  const trackingApplyFrame = useRef<number | undefined>(undefined);
  const pendingTrackingState = useRef<TrackingState | null>(null);
  const activeTrackingCaptureKey = useRef(trackingCaptureKey(sampleProject.tracking));
  const runtimeSyncRef = useRef<{ channel: BroadcastChannel; popup: Window | null; channelId: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const depthInvertRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      setTime(now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      if (trackingApplyFrame.current !== undefined) window.cancelAnimationFrame(trackingApplyFrame.current);
      trackingApplyFrame.current = undefined;
      pendingTrackingState.current = null;
      runtimeSyncRef.current?.channel.close();
      runtimeSyncRef.current = null;
    };
  }, []);

  function runtimeStatePayload(current: RigProject) {
    return {
      type: "auto-live2d:state",
      parameters: Object.fromEntries(current.parameters.map((parameter) => [parameter.id, parameter.value])),
      expressionState: current.expressionState ?? { active: {} },
      stageBackground: current.stageBackground ?? "checker",
      tracking: {
        enabled: current.tracking.enabled,
        settings: current.tracking
      }
    };
  }

  function postRuntimeState(current: RigProject = project) {
    const runtime = runtimeSyncRef.current;
    if (!runtime) return;
    if (runtime.popup?.closed) {
      runtime.channel.close();
      runtimeSyncRef.current = null;
      return;
    }
    runtime.channel.postMessage(runtimeStatePayload(current));
  }

  function cancelPendingTrackingApply() {
    if (trackingApplyFrame.current !== undefined) window.cancelAnimationFrame(trackingApplyFrame.current);
    trackingApplyFrame.current = undefined;
    pendingTrackingState.current = null;
  }

  function queueTrackingState(state: TrackingState, session: number) {
    pendingTrackingState.current = state;
    if (trackingApplyFrame.current !== undefined) return;
    trackingApplyFrame.current = window.requestAnimationFrame(() => {
      trackingApplyFrame.current = undefined;
      const nextState = pendingTrackingState.current;
      pendingTrackingState.current = null;
      if (!nextState || trackingSessionRef.current !== session) return;
      setTracking(nextState);
      setProject((current) => {
        if (!current.tracking.enabled) return current;
        const next = {
          ...current,
          parameters: applyTrackingToParameters(current.parameters, nextState, current.tracking)
        };
        postRuntimeState(next);
        return next;
      });
    });
  }

  useEffect(() => {
    postRuntimeState(project);
  }, [project.parameters, project.expressionState, project.stageBackground, project.tracking]);

  async function importFile(file: File) {
    setBusy(true);
    try {
      const result = await importPsdFile(file);
      const limited = applyAutoSafetyLimits(result.project);
      setProject(limited.project);
      setReport({ ...result.report, safetyLimits: limited.report });
      setTemplateReport(undefined);
      setSelectedLayerId(limited.project.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`PSD 导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    try {
      const file = await loadDevSamplePsd(samplePreset);
      const result = await importPsdFile(file);
      const withCompanions = await attachSampleCompanionLayers(result.project, samplePreset);
      const limited = applyAutoSafetyLimits(withCompanions);
      setProject(limited.project);
      setReport({ ...reportFromProject(limited.project, result.report.fileName), safetyLimits: limited.report });
      setTemplateReport(undefined);
      setSelectedLayerId(limited.project.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`示例 PSD 加载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function updateProject(next: RigProject) {
    setProject(withProjectDefaults(next));
  }

  function reportFromProject(nextProject: RigProject, fileName = nextProject.source.fileName): ImportReport {
    return {
      fileName: fileName || nextProject.name,
      canvasWidth: nextProject.canvas.width,
      canvasHeight: nextProject.canvas.height,
      layerCount: nextProject.layers.length,
      visibleLayerCount: nextProject.layers.filter((layer) => layer.visible).length,
      unknownLayerCount: nextProject.layers.filter((layer) => layer.kind === "unknown").length,
      objectLayerCount: nextProject.layers.filter((layer) => layer.attachment?.type === "object").length,
      expressionLayerCount: nextProject.layers.filter((layer) => layer.attachment?.type === "expression").length,
      zFixes: []
    };
  }

  function saveDraft() {
    localStorage.setItem(localDraftKey, JSON.stringify(project));
    setHasDraft(true);
  }

  function loadDraft() {
    const raw = localStorage.getItem(localDraftKey);
    if (!raw) return;
    try {
      const nextProject = withProjectDefaults(JSON.parse(raw) as RigProject);
      if (nextProject.version !== 1 || !Array.isArray(nextProject.layers)) {
        throw new Error("草稿格式不正确。");
      }
      setProject(nextProject);
      setReport(reportFromProject(nextProject, nextProject.source.fileName || "local draft"));
      setTemplateReport(undefined);
      setSelectedLayerId(nextProject.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`草稿恢复失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importProject(file: File) {
    setBusy(true);
    try {
      const nextProject = withProjectDefaults(await readProjectFile(file));
      setProject(nextProject);
      setReport(reportFromProject(nextProject, nextProject.source.fileName || file.name));
      setTemplateReport(undefined);
      setSelectedLayerId(nextProject.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`工程导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(file: File) {
    setBusy(true);
    try {
      if (project.layers.length === 0) {
        throw new Error("请先导入一个 PSD，再套用模板。");
      }
      const template = await readTemplateFile(file);
      const result = applyTemplateToProject(project, template, file.name);
      setProject(result.project);
      setTemplateReport(result.report);
      setSelectedLayerId(result.project.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`模板套用失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function replaceTextures(file: File) {
    setBusy(true);
    try {
      if (project.layers.length === 0) {
        throw new Error("请先导入或恢复一个已经绑定好的模板角色，再导入新 PSD 替换材质。");
      }
      const template = makeTemplate(project);
      const imported = await importPsdFile(file);
      const result = applyTemplateToProject(imported.project, template, `当前模板 -> ${file.name}`);
      const limited = applyAutoSafetyLimits(result.project);
      setProject(limited.project);
      setReport({ ...imported.report, safetyLimits: limited.report });
      setTemplateReport(result.report);
      setSelectedLayerId(limited.project.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`材质替换失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importDepthMap(file: File) {
    setBusy(true);
    try {
      if (project.layers.length === 0) {
        throw new Error("请先导入 PSD，再导入深度图。");
      }
      const canvas = await readDepthMapFile(file);
      depthCanvasRef.current = canvas;
      depthInvertRef.current = false;
      setProject(applyDepthCanvasToProject(project, canvas, false));
    } catch (error) {
      console.error(error);
      alert(`深度图导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function invertDepthMap() {
    const canvas = depthCanvasRef.current;
    if (!canvas) {
      setProject({
        ...project,
        layers: project.layers.map((layer) => ({
          ...layer,
          mesh: {
            ...layer.mesh,
            depths: layer.mesh.depths?.map((depth) => -depth)
          }
        })),
        depthMode: "manual",
        depthMapSource: "manual inverted depths"
      });
      return;
    }
    depthInvertRef.current = !depthInvertRef.current;
    setProject(applyDepthCanvasToProject(project, canvas, depthInvertRef.current));
  }

  function useProxyDepth() {
    setProject(rebuildProxyDepths(project));
  }

  async function exportReplacementPack() {
    setBusy(true);
    try {
      const blob = await makeReplacementPack(project);
      downloadBlob(`${project.name || "auto-live2d"}.replacement-pack.zip`, blob);
    } catch (error) {
      console.error(error);
      alert(`替换包导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportFinishedPack() {
    setBusy(true);
    try {
      const blob = await makeFinishedPack(project);
      downloadBlob(`${project.name || "auto-live2d"}.finished-live2d.zip`, blob);
    } catch (error) {
      console.error(error);
      alert(`成品包导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFinishedPack(file: File) {
    setBusy(true);
    try {
      const nextProject = withProjectDefaults(await readFinishedPack(file));
      setProject(nextProject);
      setReport(reportFromProject(nextProject, file.name));
      setTemplateReport(undefined);
      setSelectedLayerId(nextProject.layers[0]?.id);
      setSelectedBoneId("head");
    } catch (error) {
      console.error(error);
      alert(`成品包导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importObjectPsd(file: File) {
    setBusy(true);
    try {
      if (!project.layers.length) throw new Error("请先导入主 PSD，再挂载差分 obj PSD。");
      const imported = await importPsdFile(file);
      const selectedParent = project.layers.find((layer) => layer.id === selectedLayerId);
      const parentBoneId = selectedParent?.parentBoneId ?? selectedBoneId ?? "head";
      const stamp = Date.now();
      const mountedLayers = imported.project.layers.map((layer, index) => ({
        ...layer,
        id: `obj-${stamp}-${index}-${layer.id}`,
        sourceName: `[obj] ${layer.sourceName}`,
        parentBoneId,
        z: layer.z + 0.1 + index * 0.01,
        attachment: {
          type: "object" as const,
          parentLayerId: selectedParent?.id,
          notes: `Mounted from ${file.name}`
        }
      }));
      const nextProject = withProjectDefaults({
        ...project,
        layers: [...project.layers, ...mountedLayers],
        source: {
          ...project.source,
          layerCount: project.layers.length + mountedLayers.length
        }
      });
      setProject(nextProject);
      setReport(reportFromProject(nextProject, `${project.source.fileName || project.name} + ${file.name}`));
      setSelectedLayerId(mountedLayers[0]?.id ?? selectedLayerId);
    } catch (error) {
      console.error(error);
      alert(`obj PSD 挂载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importExpressionPsd(file: File) {
    setBusy(true);
    try {
      if (!project.layers.length) throw new Error("请先导入主 PSD，再挂载表情差分 PSD。");
      const defaultKey = expressionLabel(file.name);
      const expressionKey = window.prompt("表情 Key（例如 heart-eyes / blush / open-mouth）", defaultKey)?.trim() || defaultKey;
      const exclusiveGroup = window.prompt("竞争显示组（同组一次只显示一个）", expressionDefaultGroup)?.trim() || expressionDefaultGroup;
      const imported = await importPsdFile(file);
      const selectedParent = project.layers.find((layer) => layer.id === selectedLayerId);
      const stamp = Date.now();
      const mountedLayers = imported.project.layers.map((layer, index) => ({
        ...layer,
        id: `expr-${stamp}-${index}-${layer.id}`,
        sourceName: `[${expressionKey}] ${layer.sourceName}`,
        parentBoneId: layer.parentBoneId === "root" ? selectedParent?.parentBoneId ?? "head" : layer.parentBoneId,
        z: layer.z + 0.2 + index * 0.01,
        attachment: {
          type: "expression" as const,
          parentLayerId: selectedParent?.id,
          exclusiveGroup,
          expressionKey,
          triggerKey: expressionKey,
          notes: `Mounted expression PSD from ${file.name}`
        }
      }));
      const nextProject = withProjectDefaults({
        ...project,
        layers: [...project.layers, ...mountedLayers],
        expressionState: {
          active: {
            ...(project.expressionState?.active ?? {}),
            [exclusiveGroup]: expressionKey
          }
        },
        source: {
          ...project.source,
          layerCount: project.layers.length + mountedLayers.length
        }
      });
      setProject(nextProject);
      setReport(reportFromProject(nextProject, `${project.source.fileName || project.name} + ${file.name}`));
      setSelectedLayerId(mountedLayers[0]?.id ?? selectedLayerId);
    } catch (error) {
      console.error(error);
      alert(`表情差分 PSD 挂载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function openRuntimeWindow() {
    runtimeSyncRef.current?.channel.close();
    runtimeSyncRef.current = null;
    const channelId = `auto-live2d-runtime:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const canSyncRuntime = "BroadcastChannel" in window;
    const blob = new Blob([makeRuntimeHtml(project, canSyncRuntime ? { channelId } : {})], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, `${project.name || "auto-live2d"}-runtime`, "popup=yes,width=420,height=720,resizable=yes,scrollbars=no");
    if (!popup) {
      URL.revokeObjectURL(url);
      alert("浏览器阻止了小窗，请允许弹窗后再试。");
      return;
    }
    if (canSyncRuntime) {
      const channel = new BroadcastChannel(channelId);
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "auto-live2d:runtime-ready") postRuntimeState(project);
      });
      runtimeSyncRef.current = { channel, popup, channelId };
      postRuntimeState(project);
      window.setTimeout(() => postRuntimeState(project), 50);
      window.setTimeout(() => postRuntimeState(project), 250);
      window.setTimeout(() => postRuntimeState(project), 1000);
    }
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function clearTrackingRestartTimer() {
    if (trackingRestartTimer.current !== undefined) {
      window.clearTimeout(trackingRestartTimer.current);
      trackingRestartTimer.current = undefined;
    }
  }

  function runTracking(settingsInput: TrackingSettings) {
    if (!videoRef.current) return;
    clearTrackingRestartTimer();
    cancelPendingTrackingApply();
    trackingController.current?.stop();
    trackingController.current = null;
    const settings = { ...settingsInput, enabled: true };
    activeTrackingCaptureKey.current = trackingCaptureKey(settings);
    const session = trackingSessionRef.current + 1;
    trackingSessionRef.current = session;
    setTracking(emptyTrackingState);
    setProject((current) => ({ ...current, tracking: settings }));
    const controller = new TrackingController(
      videoRef.current,
      settings,
      (state) => {
        queueTrackingState(state, session);
      },
      setTrackingStatus
    );
    trackingController.current = controller;
    setTrackingRunning(true);
    controller.start().catch((error) => {
      if (trackingSessionRef.current !== session) return;
      console.error(error);
      controller.stop();
      if (trackingController.current === controller) trackingController.current = null;
      setTrackingStatus(error instanceof Error ? error.message : String(error));
      setTrackingRunning(false);
      setProject((current) => ({ ...current, tracking: { ...current.tracking, enabled: false } }));
    });
  }

  function startTracking() {
    runTracking({ ...project.tracking, enabled: true });
  }

  function stopTracking() {
    clearTrackingRestartTimer();
    trackingSessionRef.current += 1;
    cancelPendingTrackingApply();
    trackingController.current?.stop();
    trackingController.current = null;
    setTrackingRunning(false);
    setTracking(emptyTrackingState);
    setProject((current) => ({ ...current, tracking: { ...current.tracking, enabled: false } }));
  }

  const currentTrackingCaptureKey = trackingCaptureKey(project.tracking);
  useEffect(() => {
    if (!trackingRunning) {
      activeTrackingCaptureKey.current = currentTrackingCaptureKey;
      return;
    }
    if (currentTrackingCaptureKey === activeTrackingCaptureKey.current) return;

    clearTrackingRestartTimer();
    activeTrackingCaptureKey.current = currentTrackingCaptureKey;
    setTrackingStatus("面捕设置变化，正在重启");
    const nextSettings = { ...project.tracking, enabled: true };
    trackingRestartTimer.current = window.setTimeout(() => {
      trackingRestartTimer.current = undefined;
      runTracking(nextSettings);
    }, 180);

    return () => clearTrackingRestartTimer();
  }, [currentTrackingCaptureKey, trackingRunning]);

  const templateExport = makeTemplate(project);

  return (
    <main className="app-shell">
      <aside className="left-panel">
        <header className="brand">
          <div className="brand-mark">AL</div>
          <div>
            <h1>Auto Live2D Studio</h1>
            <p>PSD 分层绑定、变形、物理模板和面捕预览工具</p>
          </div>
        </header>

        <ImportPanel
          report={report}
          templateReport={templateReport}
          samplePreset={samplePreset}
          setSamplePreset={setSamplePreset}
          busy={busy}
          onImport={importFile}
          onSample={loadSample}
          onReplaceTextures={replaceTextures}
          onImportDepthMap={importDepthMap}
          onInvertDepthMap={invertDepthMap}
          onUseProxyDepth={useProxyDepth}
          depthMode={project.depthMode ?? "manual"}
          depthMapSource={project.depthMapSource}
          onImportProject={importProject}
          onApplyTemplate={applyTemplate}
          onExportProject={() => downloadJson(`${project.name || "auto-live2d"}.rig.json`, project)}
          onExportTemplate={() => downloadJson(`${project.name || "auto-live2d"}.template.json`, templateExport)}
          onExportRuntime={() => downloadText(`${project.name || "auto-live2d"}.runtime.html`, makeRuntimeHtml(project), "text/html")}
          onOpenRuntimeWindow={openRuntimeWindow}
          onExportReplacementPack={exportReplacementPack}
          onExportFinishedPack={exportFinishedPack}
          onImportFinishedPack={importFinishedPack}
          onImportObjectPsd={importObjectPsd}
          onImportExpressionPsd={importExpressionPsd}
          onSaveDraft={saveDraft}
          onLoadDraft={loadDraft}
          hasDraft={hasDraft}
        />
        <ToolPanel mode={mode} setMode={setMode} dark={dark} setDark={setDark} />
        <LayerPanel
          layers={project.layers}
          selectedLayerId={selectedLayerId}
          setSelectedLayerId={setSelectedLayerId}
          physicsTemplates={project.physicsTemplates}
          setProject={(patch) => setProject({ ...project, layers: patch(project.layers) })}
        />
      </aside>

      <CanvasStage
        project={project}
        selectedLayerId={selectedLayerId}
        selectedBoneId={selectedBoneId}
        selectedWidgetId={selectedWidgetId}
        mode={mode}
        time={time}
        setProject={updateProject}
        setSelectedLayerId={setSelectedLayerId}
        setSelectedBoneId={setSelectedBoneId}
        setSelectedWidgetId={setSelectedWidgetId}
      />

      <aside className="right-panel">
        <TrackingPanel
          settings={project.tracking}
          setSettings={(trackingSettings) => setProject((current) => ({ ...current, tracking: trackingSettings }))}
          tracking={tracking}
          running={trackingRunning}
          status={trackingStatus}
          videoRef={videoRef}
          onStart={startTracking}
          onStop={stopTracking}
        />
        <ParameterPanel
          project={project}
          setProject={setProject}
        />
        <ExpressionDiffPanel
          project={project}
          setProject={setProject}
        />
        <BindingPanel
          project={project}
          selectedLayerId={selectedLayerId}
          selectedBoneId={selectedBoneId}
          selectedWidgetId={selectedWidgetId}
          setProject={setProject}
          setSelectedLayerId={setSelectedLayerId}
          setSelectedWidgetId={setSelectedWidgetId}
        />
        <section className="right-block">
          <div className="block-title">
            <Download size={17} />
            <span>材质替换工作流</span>
          </div>
          <p className="muted">
            推荐流程：导出替换包 ZIP，把 reference.png 和 structure.json 交给外部 AI 生成同姿态新角色，再用现有拆分项目得到 PSD，导回这里并套用 template.json。这样新角色复用旧角色的骨骼、网格、变形、Z 轴和物理模板，更像材质替换。
          </p>
        </section>
      </aside>
    </main>
  );
}
