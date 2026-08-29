import { defaultDepthTuning, defaultDynamicsTuning } from "./defaults";
import type { DeformKeyframe, DepthTuning, DynamicsTuning, MeshBinding, PartKind, Point, PsdLayerAsset, Rect, RigParameter, RigProject } from "../types/rig";
import { maxMouthOpenScaleLimit } from "./defaults";

export interface MotionTransform {
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  baseX?: number;
  baseY?: number;
  baseRotate?: number;
  baseScaleX?: number;
  baseScaleY?: number;
  physicsX?: number;
  physicsY?: number;
  physicsRotate?: number;
  tailX?: number;
  tailY?: number;
  tailRotate?: number;
  pivotX?: number;
  pivotY?: number;
}

export interface EyeBounds {
  left?: Rect;
  right?: Rect;
}

const headKinds = new Set<PartKind>([
  "backHair",
  "frontHair",
  "sideHair",
  "face",
  "eyebrow",
  "eyeWhite",
  "iris",
  "eyelash",
  "nose",
  "mouth",
  "ear",
  "accessory"
]);

const neckPseudoDepth = 0.006;

const bodyKinds = new Set<PartKind>(["torso", "neck", "topWear", "bottomWear", "arm", "hand"]);

export function isHeadPart(kind: PartKind): boolean {
  return headKinds.has(kind);
}

export function isBodyPart(kind: PartKind): boolean {
  return bodyKinds.has(kind);
}

function attachmentFamily(layer: PsdLayerAsset): "head" | "body" | "root" | undefined {
  if (!layer.attachment?.type) return undefined;
  const parent = layer.parentBoneId;
  if (parent === "head" || parent === "face" || parent === "hair" || parent === "hair-back" || parent === "hair-side" || parent === "hair-front" || parent === "accessory") {
    return "head";
  }
  if (parent === "body" || parent === "neck" || parent === "cloth" || parent === "cloth-chest" || parent === "cloth-hips" || parent === "arm") {
    return "body";
  }
  if (parent === "root") return "root";
  return undefined;
}

export function isLayerHeadPart(layer: PsdLayerAsset): boolean {
  const family = attachmentFamily(layer);
  if (family) return family === "head";
  return isHeadPart(layer.kind);
}

export function isLayerBodyPart(layer: PsdLayerAsset): boolean {
  const family = attachmentFamily(layer);
  if (family) return family === "body";
  return isBodyPart(layer.kind);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function valueOf(parameters: RigParameter[], id: string): number {
  return parameters.find((parameter) => parameter.id === id)?.value ?? 0;
}

function parameterRange(parameters: RigParameter[], id: string) {
  return parameters.find((parameter) => parameter.id === id);
}

function normalizedParam(parameters: RigParameter[], id: string): number {
  const parameter = parameterRange(parameters, id);
  if (!parameter || parameter.max === parameter.min) return 0;
  return ((parameter.value - parameter.defaultValue) / Math.max(Math.abs(parameter.max - parameter.defaultValue), Math.abs(parameter.min - parameter.defaultValue))) || 0;
}

function driveValue(parameters: RigParameter[], id: string): number {
  const parameter = parameterRange(parameters, id);
  if (!parameter || parameter.max === parameter.min) return 0;
  if (parameter.min >= 0 && parameter.max <= 1) {
    return clamp((parameter.value - parameter.min) / (parameter.max - parameter.min), 0, 1);
  }
  return normalizedParam(parameters, id);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function openParam(parameters: RigParameter[], id: string): number {
  const parameter = parameterRange(parameters, id);
  return parameter ? clamp((parameter.value - parameter.min) / Math.max(0.0001, parameter.max - parameter.min), 0, 1) : 0;
}

export function isOpenMouthExpressionLayer(layer: PsdLayerAsset): boolean {
  if (layer.kind !== "mouth" || layer.attachment?.type !== "expression") return false;
  const key = String(layer.attachment.expressionKey || layer.attachment.triggerKey || layer.id || layer.sourceName).toLowerCase();
  return layer.attachment.exclusiveGroup === "mouth-expression" || key.includes("open-mouth") || key.includes("open_mouth");
}

function expressionMouthOpenAmount(parameters: RigParameter[]): number {
  return smoothstep(0.08, 0.28, openParam(parameters, "ParamMouthOpenY"));
}

export function expressionMouthOpacity(layer: PsdLayerAsset, parameters: RigParameter[]): number {
  return isOpenMouthExpressionLayer(layer) ? smoothstep(0.06, 0.16, openParam(parameters, "ParamMouthOpenY")) : 1;
}

function applyExpressionMouthClose(layer: PsdLayerAsset, points: Array<{ x: number; y: number }>, parameters: RigParameter[]) {
  if (!isOpenMouthExpressionLayer(layer)) return points;
  const amount = expressionMouthOpenAmount(parameters);
  const scaleY = 0.14 + (1 - 0.14) * amount;
  const center = rectCenter(layer.naturalBounds || layer.bounds);
  return points.map((point) => ({
    x: point.x,
    y: center.y + (point.y - center.y) * scaleY
  }));
}

function resolveDepthTuning(tuning?: Partial<DepthTuning>): DepthTuning {
  return {
    ...defaultDepthTuning,
    ...tuning
  };
}

function resolveDynamicsTuning(tuning?: Partial<DynamicsTuning>): DynamicsTuning {
  return {
    ...defaultDynamicsTuning,
    ...tuning
  };
}

function hairNeckBlendForLayer(layer: PsdLayerAsset, tuning: DepthTuning): number {
  if (layer.attachment?.cloneKind === "backHair") return tuning.backHairCloneNeckBlend;
  if (layer.attachment?.cloneKind === "frontHair") return tuning.frontHairCloneNeckBlend;
  if (layer.kind === "backHair") return tuning.backHairNeckBlend;
  return tuning.frontHairNeckBlend;
}

function tuneHeadDepthPlacement(layer: PsdLayerAsset, depth: number, tuning: DepthTuning): number {
  if (!isHeadPart(layer.kind)) return depth;
  const thickness = clamp(tuning.headProxyDepthScale, 0.25, 2.5);
  const offset = clamp(tuning.headProxyZOffset, -0.3, 0.3);
  return neckPseudoDepth + (depth - neckPseudoDepth) * thickness + offset;
}

function tunedLayerDepth(layer: PsdLayerAsset, depth: number, uv: { u: number; v: number }, tuning: DepthTuning): number {
  const kind = layer.kind;
  if (layer.attachment?.depthAnchor === "neck") return neckPseudoDepth;
  if (kind === "face" || kind === "ear") {
    const lowerFace = 0.52 + smoothstep(0.35, 1, uv.v) * 0.48;
    return tuneHeadDepthPlacement(layer, lerp(depth, neckPseudoDepth, clamp(tuning.faceNeckBlend * lowerFace, 0, 0.85)), tuning);
  }
  if (kind === "backHair") {
    return tuneHeadDepthPlacement(layer, lerp(depth, neckPseudoDepth, clamp(hairNeckBlendForLayer(layer, tuning), 0, 0.85)), tuning);
  }
  if (kind === "frontHair" || kind === "sideHair" || kind === "accessory") {
    const lowerStrand = smoothstep(0.28, 1, uv.v);
    const sideStrand = 0.55 + Math.abs(uv.u - 0.5) * 0.9;
    return tuneHeadDepthPlacement(
      layer,
      lerp(depth, neckPseudoDepth, clamp(hairNeckBlendForLayer(layer, tuning) * lowerStrand * sideStrand, 0, 0.85)),
      tuning
    );
  }
  return tuneHeadDepthPlacement(layer, depth, tuning);
}

function chinShrinkAmount(layer: PsdLayerAsset, point: { x: number; y: number }, tuning: DepthTuning, motionAmount: number): number {
  if (layer.kind !== "face") return 0;
  const { v } = uvForPoint(layer, point);
  return smoothstep(0.58, 1, v) * clamp(tuning.chinShrink, 0, 1) * motionAmount * 0.32;
}

function applyChinShrink(
  layer: PsdLayerAsset,
  sourcePoint: { x: number; y: number },
  projectedPoint: { x: number; y: number },
  center: { x: number; y: number },
  tuning: DepthTuning,
  motionAmount: number
) {
  const amount = chinShrinkAmount(layer, sourcePoint, tuning, motionAmount);
  if (amount <= 0) return projectedPoint;
  const chinCenter = { x: center.x, y: center.y + layer.naturalBounds.height * 0.12 };
  return {
    x: chinCenter.x + (projectedPoint.x - chinCenter.x) * (1 - amount),
    y: chinCenter.y + (projectedPoint.y - chinCenter.y) * (1 - amount)
  };
}

function mixKeyframe(a: DeformKeyframe, b: DeformKeyframe, t: number): DeformKeyframe {
  return {
    value: lerp(a.value, b.value, t),
    translate: {
      x: lerp(a.translate.x, b.translate.x, t),
      y: lerp(a.translate.y, b.translate.y, t)
    },
    rotate: lerp(a.rotate, b.rotate, t),
    scale: {
      x: lerp(a.scale.x, b.scale.x, t),
      y: lerp(a.scale.y, b.scale.y, t)
    },
    opacity: a.opacity !== undefined || b.opacity !== undefined ? lerp(a.opacity ?? 1, b.opacity ?? 1, t) : undefined
  };
}

function sampleKeyframes(keyframes: DeformKeyframe[], value: number): DeformKeyframe | undefined {
  if (!keyframes.length) return undefined;
  const sorted = [...keyframes].sort((a, b) => a.value - b.value);
  if (value <= sorted[0].value) return sorted[0];
  if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (value < current.value || value > next.value) continue;
    const t = (value - current.value) / Math.max(0.0001, next.value - current.value);
    return mixKeyframe(current, next, t);
  }

  return sorted[0];
}

function rectCenter(rect: Rect) {
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5
  };
}

function applyLocalLayerTransform(layer: PsdLayerAsset, points: Array<{ x: number; y: number }>) {
  const scale = clamp(layer.localScale ?? 1, 0.05, 4);
  const rotation = layer.localRotation ?? 0;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  if (Math.abs(scale - 1) < 0.0001 && Math.abs(normalizedRotation) < 0.0001) return points;

  const center = rectCenter(layer.naturalBounds);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return points.map((point) => {
    const localX = (point.x - center.x) * scale;
    const localY = (point.y - center.y) * scale;
    return {
      x: center.x + localX * cos - localY * sin,
      y: center.y + localX * sin + localY * cos
    };
  });
}

function transformPivot(layer: PsdLayerAsset) {
  if (layer.pivot) return layer.pivot;
  const bounds = layer.naturalBounds;
  if (layer.kind === "arm") {
    const centerX = bounds.x + bounds.width * 0.5;
    return {
      x: centerX >= 0.5 ? bounds.x - bounds.width * 0.12 : bounds.x + bounds.width * 1.12,
      y: bounds.y + bounds.height * 0.045
    };
  }
  if (layer.kind === "hand") {
    return {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.y + bounds.height * 0.08
    };
  }
  return rectCenter(bounds);
}

function uvForPoint(layer: PsdLayerAsset, point: { x: number; y: number }) {
  const base = layer.naturalBounds;
  return {
    u: (point.x - base.x) / Math.max(0.0001, base.width),
    v: (point.y - base.y) / Math.max(0.0001, base.height)
  };
}

function proceduralDepth(kind: PartKind, u: number, v: number): number {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.48) * 2;
  const dome = Math.sqrt(Math.max(0, 1 - dx * dx * 0.75 - dy * dy * 0.62));

  if (kind === "nose") return 0.082 + dome * 0.105;
  if (kind === "iris" || kind === "eyeWhite" || kind === "eyelash" || kind === "eyebrow") return 0.056 + dome * 0.064;
  if (kind === "mouth") return 0.046 + dome * 0.054;
  if (kind === "face" || kind === "ear") return 0.04 + dome * 0.078;
  if (kind === "frontHair" || kind === "accessory") {
    const tip = Math.pow(clamp(v, 0, 1), 1.8);
    const strand = 0.62 + 0.38 * Math.cos(dx * Math.PI * 0.5);
    return kind === "accessory" ? 0.034 + dome * 0.046 + tip * strand * 0.026 : 0.035 + dome * 0.052 + tip * strand * 0.048;
  }
  if (kind === "sideHair") return 0.025 + dome * 0.038 + Math.pow(clamp(v, 0, 1), 1.7) * 0.04;
  if (kind === "backHair") return -0.028 + dome * 0.014;
  if (kind === "neck" || kind === "topWear" || kind === "bottomWear" || kind === "torso") return 0.006;
  return 0;
}

function isSideMatched(parameter: string, layer: PsdLayerAsset): boolean {
  if (parameter === "ParamAngleZ" && isHeadPart(layer.kind)) return false;
  if (parameter === "ParamArmLA") return layer.side !== "right";
  if (parameter === "ParamArmRA") return layer.side !== "left";
  return true;
}

function proxyHeadDepth(layer: PsdLayerAsset, point: { x: number; y: number }, tuning: DepthTuning, headProxyCenter?: Point): number {
  const headCenter = headProxyCenter ?? { x: 0.5, y: 0.34 };
  const rx = layer.kind === "frontHair" || layer.kind === "backHair" || layer.kind === "sideHair" ? 0.36 : 0.3;
  const ry = layer.kind === "frontHair" || layer.kind === "backHair" || layer.kind === "sideHair" ? 0.36 : 0.34;
  const nx = (point.x - headCenter.x) / rx;
  const ny = (point.y - headCenter.y) / ry;
  const ellipsoid = Math.sqrt(Math.max(0, 1 - nx * nx * 0.56 - ny * ny * 0.64));
  const { u, v } = uvForPoint(layer, point);
  const local = proceduralDepth(layer.kind, u, v);

  if (layer.kind === "frontHair" || layer.kind === "accessory") {
    const tipBoost = Math.pow(clamp(v, 0, 1), 1.7) * 0.026;
    const depth = layer.kind === "accessory" ? 0.014 + ellipsoid * 0.035 + tipBoost * 0.5 : 0.016 + ellipsoid * 0.04 + tipBoost;
    return tunedLayerDepth(layer, depth, { u, v }, tuning);
  }
  if (layer.kind === "sideHair") {
    const tipBoost = Math.pow(clamp(v, 0, 1), 1.6) * 0.022;
    return tunedLayerDepth(layer, 0.012 + ellipsoid * 0.034 + tipBoost, { u, v }, tuning);
  }
  if (layer.kind === "backHair") return tunedLayerDepth(layer, -0.035 + ellipsoid * 0.014, { u, v }, tuning);
  if (isHeadPart(layer.kind)) return tunedLayerDepth(layer, local * 0.22 + ellipsoid * 0.074, { u, v }, tuning);
  return local;
}

function headShellForKind(kind: PartKind) {
  if (kind === "backHair") {
    return { rx: 0.39, ry: 0.4, zSign: -1, shell: 1.015, zOffset: -0.012, depthScale: 0.034, reliefScale: 0.008, tipScale: 0 };
  }
  if (kind === "accessory") {
    return { rx: 0.385, ry: 0.4, zSign: 1, shell: 1.012, zOffset: 0.004, depthScale: 0.058, reliefScale: 0.02, tipScale: 0.004 };
  }
  if (kind === "frontHair") {
    return { rx: 0.39, ry: 0.405, zSign: 1, shell: 1.018, zOffset: 0.004, depthScale: 0.074, reliefScale: 0.026, tipScale: 0.008 };
  }
  if (kind === "sideHair") {
    return { rx: 0.4, ry: 0.41, zSign: 1, shell: 1.015, zOffset: 0.001, depthScale: 0.06, reliefScale: 0.024, tipScale: 0.007 };
  }
  if (kind === "ear") {
    return { rx: 0.34, ry: 0.36, zSign: 1, shell: 1, zOffset: -0.003, depthScale: 0.054, reliefScale: 0.018, tipScale: 0 };
  }
  return { rx: 0.35, ry: 0.385, zSign: 1, shell: 1, zOffset: 0.008, depthScale: 0.096, reliefScale: 0.028, tipScale: 0 };
}

function proxyHeadPoint3d(layer: PsdLayerAsset, point: { x: number; y: number }, tuning: DepthTuning, headProxyCenter?: Point) {
  const center = headProxyCenter ?? { x: 0.5, y: 0.34 };
  const shell = headShellForKind(layer.kind);
  const rx = shell.rx * shell.shell;
  const ry = shell.ry * shell.shell;
  const localX = point.x - center.x;
  const localY = point.y - center.y;
  const nx = localX / rx;
  const ny = localY / ry;
  const surface = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const { u, v } = uvForPoint(layer, point);
  const localRelief = proceduralDepth(layer.kind, u, v) * shell.reliefScale;
  const hairTipRelief =
    layer.kind === "frontHair" || layer.kind === "sideHair" || layer.kind === "accessory"
      ? Math.pow(clamp(v, 0, 1), 1.55) * shell.tipScale
      : 0;
  const z = tunedLayerDepth(layer, shell.zSign * surface * shell.depthScale + shell.zOffset + localRelief + hairTipRelief, { u, v }, tuning);
  return { x: localX, y: localY, z, center };
}

function projectProxyHeadPoint(layer: PsdLayerAsset, point: { x: number; y: number }, yaw: number, pitch: number, tuning: DepthTuning, headProxyCenter?: Point) {
  const p = proxyHeadPoint3d(layer, point, tuning, headProxyCenter);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const z0 = p.z - neckPseudoDepth;
  const x1 = p.x * cy + z0 * sy;
  const z1 = z0 * cy - p.x * sy;
  const y1 = p.y * cp - z1 * sp;
  const z2 = z1 * cp + p.y * sp + neckPseudoDepth;
  const motionAmount = clamp((Math.abs(yaw) + Math.abs(pitch)) * 1.7, 0, 1);
  const perspective = 1 / Math.max(0.86, 1 - z2 * 0.5 * motionAmount);
  const projected = {
    x: p.center.x + x1 * perspective,
    y: p.center.y + y1 * perspective,
    z: z2
  };
  const chinAdjusted = applyChinShrink(layer, point, projected, p.center, tuning, motionAmount);
  return { ...projected, x: chinAdjusted.x, y: chinAdjusted.y };
}

function localDepth(
  layer: PsdLayerAsset,
  pointIndex: number,
  point: { x: number; y: number },
  mode: RigProject["depthMode"],
  tuning: DepthTuning,
  headProxyCenter?: Point
): number {
  if (mode === "proxyHead" && isLayerHeadPart(layer)) return proxyHeadDepth(layer, point, tuning, headProxyCenter);

  const saved = layer.mesh.depths?.[pointIndex];
  const { u, v } = uvForPoint(layer, point);
  if (typeof saved === "number") {
    const depth = mode === "manual" || !mode ? compactManualDepth(layer.kind, saved) : saved;
    return tunedLayerDepth(layer, depth, { u, v }, tuning);
  }

  return tunedLayerDepth(layer, proceduralDepth(layer.kind, u, v), { u, v }, tuning);
}

function compactManualDepth(kind: PartKind, depth: number): number {
  if (kind === "backHair") return depth * 0.42 - 0.014;
  if (kind === "frontHair" || kind === "sideHair" || kind === "accessory") return depth * 0.42 + 0.006;
  if (kind === "face" || kind === "ear") return depth * 0.58 + 0.014;
  if (kind === "nose") return depth * 0.7 + 0.02;
  if (kind === "iris" || kind === "eyeWhite" || kind === "eyelash" || kind === "eyebrow" || kind === "mouth") return depth * 0.64 + 0.017;
  return depth * 0.42;
}

function applyKeyformDeformers(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  parameters: RigParameter[],
  tuning: DepthTuning
) {
  const center = transformPivot(layer);
  return layer.deformers.reduce((currentPoints, deformer) => {
    if (!isSideMatched(deformer.parameter, layer)) return currentPoints;
    const rawDrive = driveValue(parameters, deformer.parameter);
    const mouthLimit = clamp(tuning.mouthOpenScaleLimit, 0, maxMouthOpenScaleLimit);
    const isMouthOpen = layer.kind === "mouth" && deformer.parameter === "ParamMouthOpenY";
    const drive = layer.kind === "mouth" && deformer.parameter === "ParamMouthOpenY"
      ? rawDrive * Math.min(mouthLimit, 1)
      : rawDrive;
    const key = sampleKeyframes(deformer.keyframes, drive);
    if (!key) return currentPoints;
    const rad = (key.rotate * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const extraMouthOpen = isMouthOpen ? Math.max(0, mouthLimit - 1) * rawDrive : 0;
    const scaleX = key.scale.x + extraMouthOpen * 0.12;
    const scaleY = key.scale.y + extraMouthOpen * 0.68;
    const translateY = isMouthOpen ? 0 : key.translate.y;

    return currentPoints.map((point) => {
      const localX = (point.x - center.x) * scaleX;
      const localY = (point.y - center.y) * scaleY;
      return {
        x: center.x + localX * cos - localY * sin + key.translate.x,
        y: center.y + localX * sin + localY * cos + translateY
      };
    });
  }, points);
}

function motionToNormalized(motion: Pick<MotionTransform, "x" | "y" | "rotate" | "scaleX" | "scaleY">, canvasSize: { width: number; height: number }) {
  return {
    x: motion.x / Math.max(1, canvasSize.width),
    y: motion.y / Math.max(1, canvasSize.height),
    rotate: (motion.rotate * Math.PI) / 180,
    scaleX: motion.scaleX,
    scaleY: motion.scaleY
  };
}

function transformPointsWithMotion(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  motion: Pick<MotionTransform, "x" | "y" | "rotate" | "scaleX" | "scaleY" | "pivotX" | "pivotY">,
  canvasSize: { width: number; height: number }
) {
  const normalized = motionToNormalized(motion, canvasSize);
  const usePivot = Boolean(layer.pivot) || layer.kind === "arm" || layer.kind === "hand";
  const center =
    motion.pivotX !== undefined && motion.pivotY !== undefined
      ? { x: motion.pivotX, y: motion.pivotY }
      : usePivot
        ? transformPivot(layer)
        : rectCenter(layer.naturalBounds);
  const cos = Math.cos(normalized.rotate);
  const sin = Math.sin(normalized.rotate);

  return points.map((point) => {
    const localX = (point.x - center.x) * normalized.scaleX;
    const localY = (point.y - center.y) * normalized.scaleY;
    return {
      x: center.x + localX * cos - localY * sin + normalized.x,
      y: center.y + localX * sin + localY * cos + normalized.y
    };
  });
}

function topWearPhysicsWeight(layer: PsdLayerAsset, point: { x: number; y: number }): number {
  if (layer.kind !== "topWear") return 1;
  const bounds = layer.naturalBounds;
  const v = clamp((point.y - bounds.y) / Math.max(0.0001, bounds.height), 0, 1);
  const t = clamp((v - 0.22) / 0.5, 0, 1);
  return t * t * (3 - 2 * t);
}

function applyMotionTransform(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  motion: MotionTransform | undefined,
  canvasSize: { width: number; height: number }
) {
  if (!motion) return points;

  if (layer.kind === "topWear" && motion.baseX !== undefined && motion.baseY !== undefined && motion.baseRotate !== undefined) {
    const basePoints = transformPointsWithMotion(
      layer,
      points,
      {
        x: motion.baseX,
        y: motion.baseY,
        rotate: motion.baseRotate,
        scaleX: motion.baseScaleX ?? motion.scaleX,
        scaleY: motion.baseScaleY ?? motion.scaleY,
        pivotX: motion.pivotX,
        pivotY: motion.pivotY
      },
      canvasSize
    );
    const physicsPoints = transformPointsWithMotion(
      layer,
      basePoints,
      {
        x: motion.physicsX ?? 0,
        y: motion.physicsY ?? 0,
        rotate: motion.physicsRotate ?? 0,
        scaleX: 1,
        scaleY: 1,
        pivotX: motion.pivotX,
        pivotY: motion.pivotY
      },
      canvasSize
    );
    return basePoints.map((point, index) => {
      const weight = topWearPhysicsWeight(layer, points[index]);
      return {
        x: point.x + (physicsPoints[index].x - point.x) * weight,
        y: point.y + (physicsPoints[index].y - point.y) * weight
      };
    });
  }

  return transformPointsWithMotion(layer, points, motion, canvasSize);
}

function rectForLayerEye(layer: PsdLayerAsset, eyeBounds?: EyeBounds): Rect | undefined {
  if (layer.side === "left") return eyeBounds?.left;
  if (layer.side === "right") return eyeBounds?.right;
  return eyeBounds?.left && eyeBounds?.right
    ? {
        x: Math.min(eyeBounds.left.x, eyeBounds.right.x),
        y: Math.min(eyeBounds.left.y, eyeBounds.right.y),
        width: Math.max(eyeBounds.left.x + eyeBounds.left.width, eyeBounds.right.x + eyeBounds.right.width) - Math.min(eyeBounds.left.x, eyeBounds.right.x),
        height: Math.max(eyeBounds.left.y + eyeBounds.left.height, eyeBounds.right.y + eyeBounds.right.height) - Math.min(eyeBounds.left.y, eyeBounds.right.y)
      }
    : eyeBounds?.left ?? eyeBounds?.right;
}

function eyeOpenForLayer(layer: PsdLayerAsset, parameters: RigParameter[]): number {
  const id = layer.side === "right" ? "ParamEyeROpen" : layer.side === "left" ? "ParamEyeLOpen" : undefined;
  if (id) {
    const parameter = parameterRange(parameters, id);
    return parameter ? clamp((parameter.value - parameter.min) / Math.max(0.0001, parameter.max - parameter.min), 0, 1) : 1;
  }
  const left = parameterRange(parameters, "ParamEyeLOpen");
  const right = parameterRange(parameters, "ParamEyeROpen");
  const l = left ? clamp((left.value - left.min) / Math.max(0.0001, left.max - left.min), 0, 1) : 1;
  const r = right ? clamp((right.value - right.min) / Math.max(0.0001, right.max - right.min), 0, 1) : 1;
  return Math.min(l, r);
}

function applyBlinkDeform(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  parameters: RigParameter[],
  eyeBounds?: EyeBounds
) {
  if (layer.kind !== "eyelash" && layer.kind !== "eyeWhite" && layer.kind !== "iris") return points;
  const close = 1 - eyeOpenForLayer(layer, parameters);
  if (close <= 0.0001) return points;

  const socket = rectForLayerEye(layer, eyeBounds) ?? layer.naturalBounds;
  const bounds = layer.naturalBounds;
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
      const { v } = uvForPoint(layer, point);
      const topMask = 1 - smoothstep(0.38, 0.95, v);
      const y = centerY + (point.y - centerY) * squash + drop * topMask;
      return {
        x: point.x,
        y: clamp(y, bounds.y - bounds.height * 0.12, bounds.y + bounds.height * 1.12)
      };
    });
  }

  if (layer.kind === "eyelash") {
    return points.map((point) => {
      const { v } = uvForPoint(layer, point);
      const upperWeight = 1 - smoothstep(0.42, 0.92, v);
      const lowerWeight = smoothstep(0.58, 1, v) * 0.18;
      const targetY = lerp(point.y, closeLine, upperWeight * close);
      return {
        x: point.x,
        y: targetY - lowerWeight * close * socket.height * 0.08
      };
    });
  }

  const centerY = socket.y + socket.height * 0.5;
  const squash = 1 - close * 0.62;
  const drop = close * socket.height * 0.16;
  return points.map((point) => {
    const { v } = uvForPoint(layer, point);
    const topMask = 1 - smoothstep(0.38, 0.95, v);
    const y = centerY + (point.y - centerY) * squash + drop * topMask;
    return {
      x: point.x,
      y: clamp(y, bounds.y - bounds.height * 0.12, bounds.y + bounds.height * 1.12)
    };
  });
}

function rectForIris(layer: PsdLayerAsset, eyeBounds?: EyeBounds): Rect | undefined {
  if (layer.kind !== "iris") return undefined;
  if (layer.side === "left") return eyeBounds?.left;
  if (layer.side === "right") return eyeBounds?.right;
  return eyeBounds?.left && eyeBounds?.right
    ? {
        x: Math.min(eyeBounds.left.x, eyeBounds.right.x),
        y: Math.min(eyeBounds.left.y, eyeBounds.right.y),
        width: Math.max(eyeBounds.left.x + eyeBounds.left.width, eyeBounds.right.x + eyeBounds.right.width) - Math.min(eyeBounds.left.x, eyeBounds.right.x),
        height: Math.max(eyeBounds.left.y + eyeBounds.left.height, eyeBounds.right.y + eyeBounds.right.height) - Math.min(eyeBounds.left.y, eyeBounds.right.y)
      }
    : eyeBounds?.left ?? eyeBounds?.right;
}

function clampIrisToEyeSocket(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  parameters: RigParameter[],
  eyeBounds: EyeBounds | undefined,
  canvasSize: { width: number; height: number },
  tuning: DepthTuning
) {
  if (layer.kind !== "iris") return points;
  const socket = rectForIris(layer, eyeBounds);
  if (!socket) return points;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const irisMinX = Math.min(...xs);
  const irisMaxX = Math.max(...xs);
  const irisMinY = Math.min(...ys);
  const irisMaxY = Math.max(...ys);
  const irisWidth = irisMaxX - irisMinX;
  const irisHeight = irisMaxY - irisMinY;
  const irisCenterX = (irisMinX + irisMaxX) * 0.5;
  const irisCenterY = (irisMinY + irisMaxY) * 0.5;
  const socketCenter = rectCenter(socket);
  const padX = Math.min(socket.width * 0.035, 3 / Math.max(1, canvasSize.width));
  const padY = Math.min(socket.height * 0.045, 2 / Math.max(1, canvasSize.height));
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
  const eyeX = normalizedParam(parameters, "ParamEyeBallX");
  const eyeY = normalizedParam(parameters, "ParamEyeBallY");
  const targetCenterX = socketCenter.x + eyeX * centerRangeX * 0.34;
  const targetCenterY = socketCenter.y - eyeY * (centerRangeY * 0.42 + fitHeight * clamp(tuning.eyeVerticalOvershoot, 0, 1) * 0.35);
  const minCenterX = socket.x + padX + fitWidth * 0.18;
  const maxCenterX = socket.x + socket.width - padX - fitWidth * 0.18;
  const verticalOvershoot = fitHeight * clamp(tuning.eyeVerticalOvershoot, 0, 1) * 0.35;
  const minCenterY = socket.y + padY + fitHeight * 0.28 - verticalOvershoot;
  const maxCenterY = socket.y + socket.height - padY - fitHeight * 0.28 + verticalOvershoot;
  const nextCenterX = minCenterX <= maxCenterX ? clamp(targetCenterX, minCenterX, maxCenterX) : socketCenter.x;
  const nextCenterY = minCenterY <= maxCenterY ? clamp(targetCenterY, minCenterY, maxCenterY) : socketCenter.y;
  const dx = nextCenterX - irisCenterX;
  const dy = nextCenterY - irisCenterY;

  return scaled.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function projectPoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  depth: number,
  yaw: number,
  pitch: number,
  influence: number,
  pivotDepth = 0
) {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const z = depth * influence;
  const z0 = z - pivotDepth;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

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

function kindInfluence(kind: PartKind, depth = 0): number {
  const depthBias = clamp((depth + 0.2) / 0.4, 0, 1);
  if (kind === "frontHair") return 0.92 + depthBias * 0.18;
  if (kind === "sideHair") return 0.84 + depthBias * 0.16;
  if (kind === "backHair") return 0.7 + depthBias * 0.08;
  if (kind === "nose" || kind === "iris" || kind === "mouth") return 0.94 + depthBias * 0.1;
  if (kind === "eyeWhite" || kind === "eyelash" || kind === "eyebrow") return 0.9 + depthBias * 0.1;
  if (kind === "face" || kind === "ear") return 0.82 + depthBias * 0.12;
  if (kind === "neck") return 0;
  if (kind === "topWear" || kind === "bottomWear" || kind === "torso") return 0.4;
  if (kind === "arm" || kind === "hand") return 0.28;
  return 0;
}

export interface DeformOptions {
  motion?: MotionTransform;
  canvasSize?: { width: number; height: number };
  eyeBounds?: EyeBounds;
  depthTuning?: Partial<DepthTuning>;
  dynamicsTuning?: Partial<DynamicsTuning>;
  headProxyCenter?: Point;
}

function dynamicTailStrength(kind: PartKind, tuning: DynamicsTuning): number {
  if (kind === "frontHair" || kind === "sideHair") return clamp(tuning.frontHairInertia, 0, 1.5);
  if (kind === "backHair") return clamp(tuning.backHairInertia, 0, 1.5);
  if (kind === "accessory") return clamp(tuning.accessoryInertia, 0, 1.5);
  return 0;
}

function layerInertiaScale(layer: PsdLayerAsset): number {
  if (typeof layer.inertiaScale === "number") return clamp(layer.inertiaScale, 0, 2.4);
  const bounds = layer.naturalBounds;
  const areaScale = Math.sqrt(Math.max(0.0001, bounds.width * bounds.height) / 0.09);
  const kindBase = layer.kind === "accessory" ? 0.82 : layer.kind === "backHair" ? 1.08 : 1;
  return clamp(areaScale * kindBase, 0.55, 1.65);
}

function tailWeightForKind(layer: PsdLayerAsset, point: { x: number; y: number }, rootY: number, pivot: Point) {
  const bounds = layer.naturalBounds;
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

function bendDynamicTail(
  layer: PsdLayerAsset,
  points: Array<{ x: number; y: number }>,
  motion: MotionTransform | undefined,
  canvasSize: { width: number; height: number },
  tuning: DynamicsTuning
) {
  const strength = dynamicTailStrength(layer.kind, tuning) * layerInertiaScale(layer);
  if (!motion || strength <= 0) return points;
  const tailRotateDegrees = motion.tailRotate ?? motion.rotate * 0.18 * strength;
  const tailX = ((motion.tailX ?? motion.x * 0.16 * strength) / Math.max(1, canvasSize.width)) * 0.72;
  const tailY = ((motion.tailY ?? Math.abs(motion.x) * 0.04 * strength) / Math.max(1, canvasSize.height)) * 0.48;
  const tailRotate = (tailRotateDegrees * Math.PI) / 180;
  const rollStretch = clamp(Math.abs(tailRotateDegrees) / 38, 0, 1) * clamp(strength, 0, 2.4);
  if (Math.abs(tailX) < 0.00001 && Math.abs(tailY) < 0.00001 && Math.abs(tailRotate) < 0.00001 && rollStretch < 0.00001) return points;

  const bounds = layer.naturalBounds;
  const rootY =
    layer.kind === "frontHair" || layer.kind === "sideHair"
      ? bounds.y + bounds.height * 0.18
      : layer.kind === "accessory"
        ? bounds.y + bounds.height * 0.12
        : bounds.y + bounds.height * 0.2;
  const pivot = { x: bounds.x + bounds.width * 0.5, y: rootY };
  const cos = Math.cos(tailRotate);
  const sin = Math.sin(tailRotate);
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
    return {
      x: rotatedX + tailX * weight + stretchX + shearX,
      y: rotatedY + tailY * weight + stretchY
    };
  });
}

export function deformedMeshForLayer(
  layer: PsdLayerAsset,
  parameters: RigParameter[],
  depthMode: RigProject["depthMode"] = "manual",
  options: DeformOptions = {}
): MeshBinding {
  const tuning = resolveDepthTuning(options.depthTuning);
  const dynamicsTuning = resolveDynamicsTuning(options.dynamicsTuning);
  const sourcePoints = applyLocalLayerTransform(layer, layer.mesh.points.map((point) => ({ ...point })));
  const keyformed = applyKeyformDeformers(layer, sourcePoints, parameters, tuning);
  const mouthClosed = applyExpressionMouthClose(layer, keyformed, parameters);
  const headYaw = normalizedParam(parameters, "ParamAngleX") * 0.46;
  const headPitch = normalizedParam(parameters, "ParamAngleY") * -0.36;
  const bodyYaw = normalizedParam(parameters, "ParamBodyAngleX") * 0.07;
  const bodyPitch = normalizedParam(parameters, "ParamBodyAngleY") * -0.055;
  const followsHead = isLayerHeadPart(layer);
  const followsBody = isLayerBodyPart(layer);

  const center = followsHead
    ? options.headProxyCenter ?? { x: 0.5, y: 0.34 }
    : followsBody
      ? { x: 0.5, y: 0.58 }
      : rectCenter(layer.naturalBounds);
  const yaw = followsHead ? headYaw + bodyYaw * 0.65 : followsBody ? bodyYaw : 0;
  const pitch = followsHead ? headPitch + bodyPitch * 0.5 : followsBody ? bodyPitch : 0;

  const projectedDepths: number[] = [];
  const projectedPoints = mouthClosed.map((point, index) => {
    if (depthMode === "proxyHead" && followsHead) {
      const projected = projectProxyHeadPoint(layer, point, yaw, pitch, tuning, options.headProxyCenter);
      projectedDepths[index] = projected.z;
      return { x: projected.x, y: projected.y };
    }
    const depth = localDepth(layer, index, point, depthMode, tuning, options.headProxyCenter);
    projectedDepths[index] = depth;
    const motionAmount = clamp((Math.abs(yaw) + Math.abs(pitch)) * 1.6, 0, 1);
    const projected = projectPoint(point, center, depth, yaw, pitch, kindInfluence(layer.kind, depth), followsHead ? neckPseudoDepth : 0);
    return applyChinShrink(layer, point, projected, center, tuning, motionAmount);
  });
  const canvasSize = options.canvasSize ?? { width: 1, height: 1 };
  const movedPoints = applyMotionTransform(layer, projectedPoints, options.motion, canvasSize);
  const tailBent = bendDynamicTail(layer, movedPoints, options.motion, canvasSize, dynamicsTuning);
  const blinked = applyBlinkDeform(layer, tailBent, parameters, options.eyeBounds);
  const points = clampIrisToEyeSocket(layer, blinked, parameters, options.eyeBounds, canvasSize, tuning);

  return {
    ...layer.mesh,
    points,
    projectedDepths
  };
}

export function sideLabel(side?: PsdLayerAsset["side"]): string {
  if (side === "left") return "L";
  if (side === "right") return "R";
  return "";
}
