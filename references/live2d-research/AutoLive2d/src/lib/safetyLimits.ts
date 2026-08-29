import type { ImportReport, ParameterId, Point, PsdLayerAsset, Rect, RigParameter, RigProject, TrackingSettings } from "../types/rig";
import { deformedMeshForLayer } from "./deform3d";
import { layerPreviewMotion } from "./preview";

type AxisLimit = { x: number; y: number; z: number };

const headProbe: AxisLimit = { x: 45, y: 35, z: 24 };
const bodyProbe: AxisLimit = { x: 12, y: 10, z: 6 };
const defaultHeadLimit: AxisLimit = { x: 34, y: 24, z: 14 };
const defaultBodyLimit: AxisLimit = { x: 10, y: 8, z: 4 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectCenter(rect: Rect) {
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5
  };
}

function unionRects(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
  return paddedRect(rect, 0.055, 0.12);
}

function irisFallbackEyeRect(rect?: Rect): Rect | undefined {
  return rect ? growEyeRect(paddedRect(rect, 0.24, 0.2)) : undefined;
}

function eyeBoundsForProject(project: RigProject) {
  const pick = (side: "left" | "right") =>
    project.layers.find((layer) => layer.kind === "eyeWhite" && layer.side === side)?.naturalBounds ??
    project.layers.find((layer) => layer.kind === "eyelash" && layer.side === side)?.naturalBounds;
  const irisPick = (side: "left" | "right") => project.layers.find((layer) => layer.kind === "iris" && layer.side === side)?.naturalBounds;
  return {
    left: growEyeRect(pick("left")) ?? irisFallbackEyeRect(irisPick("left")),
    right: growEyeRect(pick("right")) ?? irisFallbackEyeRect(irisPick("right"))
  };
}

function headProxyCenterForProject(project: RigProject): Point | undefined {
  const bounds = eyeBoundsForProject(project);
  const centers = [bounds.left, bounds.right].filter(Boolean).map((rect) => rectCenter(rect!));
  if (!centers.length) return undefined;
  return {
    x: clamp(centers.reduce((sum, point) => sum + point.x, 0) / centers.length, 0.18, 0.82),
    y: clamp(centers.reduce((sum, point) => sum + point.y, 0) / centers.length, 0.16, 0.48)
  };
}

function rectFromPoints(points: Array<{ x: number; y: number }>): Rect {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(0.0001, maxX - minX), height: Math.max(0.0001, maxY - minY) };
}

function setParameter(parameters: RigParameter[], id: ParameterId, value: number): RigParameter[] {
  return parameters.map((parameter) =>
    parameter.id === id
      ? {
          ...parameter,
          min: Math.min(parameter.min, value),
          max: Math.max(parameter.max, value),
          value
        }
      : parameter
  );
}

function axisPatch(axis: "x" | "y" | "z", amount: number, part: "head" | "body"): Partial<Record<ParameterId, number>> {
  if (part === "head") {
    if (axis === "x") return { ParamAngleX: amount };
    if (axis === "y") return { ParamAngleY: amount };
    return { ParamAngleZ: amount };
  }
  if (axis === "x") return { ParamBodyAngleX: amount };
  if (axis === "y") return { ParamBodyAngleY: amount };
  return { ParamBodyAngleZ: amount };
}

function withPatch(parameters: RigParameter[], patch: Partial<Record<ParameterId, number>>): RigParameter[] {
  return Object.entries(patch).reduce((current, [id, value]) => setParameter(current, id as ParameterId, value ?? 0), parameters);
}

function meshRect(layer: PsdLayerAsset, project: RigProject, parameters: RigParameter[]): Rect {
  const motion = layerPreviewMotion(layer, parameters, project.physicsTemplates, 0, project.canvas, project.dynamicsTuning);
  const eyeBounds = eyeBoundsForProject(project);
  const mesh = deformedMeshForLayer(layer, parameters, project.depthMode ?? "manual", {
    motion,
    canvasSize: project.canvas,
    eyeBounds,
    depthTuning: project.depthTuning,
    dynamicsTuning: project.dynamicsTuning,
    headProxyCenter: headProxyCenterForProject(project)
  });
  return rectFromPoints(mesh.points);
}

function criticalRects(project: RigProject, parameters: RigParameter[]) {
  const rectFor = (kind: PsdLayerAsset["kind"]) => {
    const layer = project.layers.find((item) => item.kind === kind);
    return layer ? meshRect(layer, project, parameters) : undefined;
  };
  const face = rectFor("face");
  const neck = rectFor("neck");
  const topWear = rectFor("topWear");
  const head = unionRects(
    project.layers
      .filter((layer) => ["face", "frontHair", "sideHair", "backHair", "eyeWhite", "iris", "eyelash", "eyebrow", "mouth", "nose", "ear", "accessory"].includes(layer.kind))
      .map((layer) => meshRect(layer, project, parameters))
  );

  return { face, neck, topWear, head };
}

function isRectVisible(rect: Rect | undefined): boolean {
  if (!rect) return false;
  return rect.x > -0.2 && rect.y > -0.2 && rect.x + rect.width < 1.2 && rect.y + rect.height < 1.2;
}

function scorePose(project: RigProject, parameters: RigParameter[]): number {
  const neutral = criticalRects(project, project.parameters);
  const current = criticalRects(project, parameters);
  let score = 1;

  if (!isRectVisible(current.face) || !isRectVisible(current.head)) score -= 0.45;
  if (!current.face || !current.head) return 0;

  const faceCenter = rectCenter(current.face);
  const headCenter = rectCenter(current.head);
  const headRadius = Math.max(0.0001, Math.max(current.head.width, current.head.height));
  const faceDrift = Math.hypot(faceCenter.x - headCenter.x, faceCenter.y - headCenter.y) / headRadius;
  if (faceDrift > 0.18) score -= (faceDrift - 0.18) * 1.8;

  if (neutral.face) {
    const neutralFace = rectCenter(neutral.face);
    const drift = Math.hypot(faceCenter.x - neutralFace.x, faceCenter.y - neutralFace.y);
    if (drift > 0.18) score -= (drift - 0.18) * 1.25;
  }

  if (current.neck && current.topWear) {
    const neckCenter = rectCenter(current.neck);
    const top = current.topWear;
    const insideShoulderBand = neckCenter.x >= top.x - top.width * 0.08 && neckCenter.x <= top.x + top.width * 0.92 && current.neck.y + current.neck.height >= top.y - 0.035;
    if (!insideShoulderBand) score -= 0.35;
  }

  return clamp(score, 0, 1);
}

function findSafeAxis(project: RigProject, axis: "x" | "y" | "z", part: "head" | "body", max: number): number {
  const candidates = [max, max * 0.84, max * 0.68, max * 0.52, max * 0.36, max * 0.24];
  for (const candidate of candidates) {
    const plus = withPatch(project.parameters, axisPatch(axis, candidate, part));
    const minus = withPatch(project.parameters, axisPatch(axis, -candidate, part));
    if (scorePose(project, plus) >= 0.72 && scorePose(project, minus) >= 0.72) {
      return Math.max(1, Math.round(candidate));
    }
  }
  return Math.max(1, Math.round(max * 0.2));
}

function applyParameterLimit(parameters: RigParameter[], id: ParameterId, limit: number): RigParameter[] {
  return parameters.map((parameter) =>
    parameter.id === id
      ? {
          ...parameter,
          min: -limit,
          max: limit,
          value: clamp(parameter.value, -limit, limit)
        }
      : parameter
  );
}

function armShoulderPivot(layer: PsdLayerAsset, bodyBounds?: Rect) {
  const bounds = layer.naturalBounds;
  const center = rectCenter(bounds);
  const onRightHalf = center.x >= 0.5;
  const fallback = {
    x: onRightHalf ? bounds.x - bounds.width * 0.12 : bounds.x + bounds.width * 1.12,
    y: bounds.y + bounds.height * 0.045
  };
  if (!bodyBounds) return fallback;

  const bodyShoulder = {
    x: onRightHalf ? bodyBounds.x + bodyBounds.width * 0.84 : bodyBounds.x + bodyBounds.width * 0.16,
    y: bodyBounds.y + bodyBounds.height * 0.13
  };
  return {
    x: clamp(bodyShoulder.x, fallback.x - bounds.width * 0.18, fallback.x + bounds.width * 0.18),
    y: clamp(bodyShoulder.y, fallback.y - bounds.height * 0.16, fallback.y + bounds.height * 0.16)
  };
}

function lockNeckAndCollarDepths(project: RigProject): RigProject {
  const torsoDepth = 0.006;
  const bodyBounds = unionRects(
    project.layers
      .filter((layer) => layer.kind === "topWear" || layer.kind === "torso")
      .map((layer) => layer.naturalBounds)
  );
  const layers = project.layers.map((layer) => {
    if (layer.kind === "arm") {
      return {
        ...layer,
        pivot: armShoulderPivot(layer, bodyBounds)
      };
    }
    if (layer.kind !== "neck" && layer.kind !== "topWear" && layer.kind !== "bottomWear" && layer.kind !== "torso") return layer;
    const depths = layer.mesh.points.map((_, index) => {
      if (layer.kind === "topWear") {
        const row = Math.floor(index / layer.mesh.cols);
        const v = layer.mesh.rows <= 1 ? 0 : row / (layer.mesh.rows - 1);
        return v <= 0.34 ? torsoDepth : layer.mesh.depths?.[index] ?? torsoDepth;
      }
      return torsoDepth;
    });
    return {
      ...layer,
      deformers:
        layer.kind === "neck"
          ? layer.deformers.filter((deformer) => deformer.parameter !== "ParamAngleX" && deformer.parameter !== "ParamAngleY" && deformer.parameter !== "ParamAngleZ")
          : layer.deformers,
      mesh: { ...layer.mesh, depths }
    };
  });
  return { ...project, layers };
}

export function applyAutoSafetyLimits(project: RigProject): { project: RigProject; report: ImportReport["safetyLimits"] } {
  let nextProject = lockNeckAndCollarDepths(project);
  const head = {
    x: Math.min(defaultHeadLimit.x, findSafeAxis(nextProject, "x", "head", headProbe.x)),
    y: Math.min(defaultHeadLimit.y, findSafeAxis(nextProject, "y", "head", headProbe.y)),
    z: Math.min(defaultHeadLimit.z, findSafeAxis(nextProject, "z", "head", headProbe.z))
  };
  const body = {
    x: Math.min(defaultBodyLimit.x, findSafeAxis(nextProject, "x", "body", bodyProbe.x)),
    y: Math.min(defaultBodyLimit.y, findSafeAxis(nextProject, "y", "body", bodyProbe.y)),
    z: Math.min(defaultBodyLimit.z, findSafeAxis(nextProject, "z", "body", bodyProbe.z))
  };

  let parameters = nextProject.parameters;
  parameters = applyParameterLimit(parameters, "ParamAngleX", head.x);
  parameters = applyParameterLimit(parameters, "ParamAngleY", head.y);
  parameters = applyParameterLimit(parameters, "ParamAngleZ", head.z);
  parameters = applyParameterLimit(parameters, "ParamBodyAngleX", body.x);
  parameters = applyParameterLimit(parameters, "ParamBodyAngleY", body.y);
  parameters = applyParameterLimit(parameters, "ParamBodyAngleZ", body.z);

  const tracking: TrackingSettings = {
    ...nextProject.tracking,
    angleLimits: {
      x: head.x,
      y: head.y,
      z: Math.min(head.z, 8)
    }
  };

  nextProject = { ...nextProject, parameters, tracking };
  return {
    project: nextProject,
    report: { head, body }
  };
}
