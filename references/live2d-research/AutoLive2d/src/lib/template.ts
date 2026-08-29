import { normalizeLayerName } from "./classify";
import { defaultDepthTuning, defaultDynamicsTuning, defaultHeadRollPivot, defaultTrackingSettings } from "./defaults";
import { defaultPivotForKind } from "./mesh";
import type {
  MeshBinding,
  PartKind,
  PsdLayerAsset,
  RigProject,
  RigTemplate,
  RigTemplateLayerBinding,
  TemplateApplyReport
} from "../types/rig";

const criticalKinds: PartKind[] = ["face", "eyeWhite", "iris", "mouth", "frontHair"];

function scalePoint(point: { x: number; y: number }, from: { width: number; height: number }, to: { width: number; height: number }) {
  if (!from.width || !from.height || from.width === to.width && from.height === to.height) {
    return point;
  }

  return {
    x: point.x * (from.width / to.width),
    y: point.y * (from.height / to.height)
  };
}

function scaleMesh(mesh: MeshBinding, template: RigTemplate, project: RigProject): MeshBinding {
  return {
    ...mesh,
    points: mesh.points.map((point) => scalePoint(point, template.sourceCanvas, project.canvas))
  };
}

function validateTemplate(value: unknown): RigTemplate {
  const template = value as Partial<RigTemplate>;
  if (!template || template.version !== 1 || !Array.isArray(template.layerBindings) || !Array.isArray(template.bones)) {
    throw new Error("这不是 Auto Live2D Studio v1 模板 JSON。");
  }
  return template as RigTemplate;
}

function withCompatibleProjectDefaults(project: RigProject): RigProject {
  return {
    ...project,
    tracking: {
      ...defaultTrackingSettings,
      ...project.tracking,
      angleLimits: project.tracking?.angleLimits ?? defaultTrackingSettings.angleLimits
    },
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
    layers: project.layers.map((layer) => ({
      ...layer,
      pivot: layer.pivot ?? defaultPivotForKind(layer.kind, layer.naturalBounds ?? layer.bounds, layer.side),
      localScale: layer.localScale ?? 1,
      localRotation: layer.localRotation ?? 0,
      inertiaScale: layer.inertiaScale ?? defaultCompatibleInertiaScale(layer)
    }))
  };
}

function defaultCompatibleInertiaScale(layer: PsdLayerAsset): number | undefined {
  if (layer.kind !== "frontHair" && layer.kind !== "sideHair" && layer.kind !== "backHair" && layer.kind !== "accessory") return undefined;
  const bounds = layer.naturalBounds ?? layer.bounds;
  const areaScale = Math.sqrt(Math.max(0.0001, bounds.width * bounds.height) / 0.09);
  const base = layer.kind === "accessory" ? 0.82 : layer.kind === "backHair" ? 1.08 : 1;
  return Math.round(Math.min(1.55, Math.max(0.55, base * areaScale)) * 100) / 100;
}

function findBinding(
  layer: PsdLayerAsset,
  bindings: RigTemplateLayerBinding[],
  used: Set<string>
): { binding?: RigTemplateLayerBinding; match: "exact" | "kind" | "none" } {
  const normalized = normalizeLayerName(layer.sourceName);
  const exact = bindings.find((binding) => !used.has(binding.id) && normalizeLayerName(binding.sourceName) === normalized);
  if (exact) return { binding: exact, match: "exact" };

  const sameSideKind = bindings.find((binding) => !used.has(binding.id) && binding.kind === layer.kind && binding.side && binding.side === layer.side);
  if (sameSideKind) return { binding: sameSideKind, match: "kind" };

  const sameKind = bindings.find((binding) => !used.has(binding.id) && binding.kind === layer.kind && (!binding.side || !layer.side));
  if (sameKind) return { binding: sameKind, match: "kind" };

  return { match: "none" };
}

export async function readTemplateFile(file: File): Promise<RigTemplate> {
  const text = await file.text();
  return validateTemplate(JSON.parse(text));
}

export function makeTemplate(project: RigProject): RigTemplate {
  return {
    version: 1,
    sourceCanvas: project.canvas,
    depthMode: project.depthMode,
    depthMapSource: project.depthMapSource,
    depthTuning: project.depthTuning,
    dynamicsTuning: project.dynamicsTuning,
    headRollPivot: project.headRollPivot,
    expressionState: project.expressionState,
    bones: project.bones,
    parameters: project.parameters,
    layerBindings: project.layers.map(({ id, sourceName, kind, side, bounds, naturalBounds, recommendedZ, parentBoneId, pivot, localScale, localRotation, mesh, deformers, physicsTemplateId, inertiaScale, attachment, z }) => ({
      id,
      sourceName,
      kind,
      side,
      bounds,
      naturalBounds,
      recommendedZ,
      parentBoneId,
      pivot,
      localScale,
      localRotation,
      mesh,
      deformers,
      physicsTemplateId,
      inertiaScale,
      attachment,
      z
    })),
    physicsTemplates: project.physicsTemplates,
    widgets: project.widgets
  };
}

export function applyTemplateToProject(project: RigProject, template: RigTemplate, fileName: string): { project: RigProject; report: TemplateApplyReport } {
  const usedBindings = new Set<string>();
  let exactNameMatches = 0;
  let kindMatches = 0;
  const layerMatches: TemplateApplyReport["layerMatches"] = [];
  const zWarnings: TemplateApplyReport["zWarnings"] = [];

  const layers = project.layers.map((layer) => {
    const { binding, match } = findBinding(layer, template.layerBindings, usedBindings);
    if (!binding) {
      layerMatches.push({
        layerId: layer.id,
        sourceName: layer.sourceName,
        kind: layer.kind,
        match: "none",
        confidence: 0,
        zBefore: layer.z,
        zAfter: layer.z,
        zDelta: 0,
        warning: "未找到同名或同部位模板层，需要手动绑定。"
      });
      return layer;
    }

    usedBindings.add(binding.id);
    if (match === "exact") exactNameMatches += 1;
    if (match === "kind") kindMatches += 1;
    const zDelta = binding.z - layer.z;
    if (Math.abs(zDelta) >= 12) {
      zWarnings.push({
        sourceName: layer.sourceName,
        from: layer.z,
        to: binding.z,
        delta: zDelta
      });
    }

    layerMatches.push({
      layerId: layer.id,
      sourceName: layer.sourceName,
      kind: layer.kind,
      match,
      confidence: match === "exact" ? 1 : 0.72,
      templateSourceName: binding.sourceName,
      templateKind: binding.kind,
      zBefore: layer.z,
      zAfter: binding.z,
      zDelta,
      warning: match === "kind" ? "仅按部位匹配，请检查形状和左右位置是否一致。" : undefined
    });

    return {
      ...layer,
      parentBoneId: binding.parentBoneId,
      pivot: binding.pivot ?? defaultPivotForKind(layer.kind, layer.naturalBounds, layer.side),
      localScale: binding.localScale ?? layer.localScale ?? 1,
      localRotation: binding.localRotation ?? layer.localRotation ?? 0,
      mesh: scaleMesh(binding.mesh, template, project),
      deformers: structuredClone(binding.deformers),
      physicsTemplateId: binding.physicsTemplateId,
      inertiaScale: binding.inertiaScale ?? layer.inertiaScale,
      attachment: binding.attachment ?? layer.attachment,
      z: binding.z
    };
  });

  const matchedLayers = exactNameMatches + kindMatches;
  const matchedKinds = new Set(layerMatches.filter((item) => item.match !== "none").map((item) => item.kind));
  const criticalMissing = criticalKinds.filter((kind) => !matchedKinds.has(kind));
  const denominator = Math.max(project.layers.length, template.layerBindings.length, 1);
  const confidence = Math.round(((exactNameMatches + kindMatches * 0.72) / denominator) * 100);
  const unusedTemplateLayers = template.layerBindings.length - usedBindings.size;
  const warnings = [
    ...(unusedTemplateLayers > 0 ? [`模板中还有 ${unusedTemplateLayers} 层没有被新 PSD 使用。`] : []),
    ...(zWarnings.length > 0 ? [`${zWarnings.length} 层 Z 值被模板大幅覆盖，建议在图层面板复查遮挡关系。`] : [])
  ];

  return {
    project: withCompatibleProjectDefaults({
      ...project,
      bones: structuredClone(template.bones),
      parameters: structuredClone(template.parameters ?? project.parameters),
      physicsTemplates: structuredClone(template.physicsTemplates),
      widgets: structuredClone(template.widgets),
      depthMode: template.depthMode ?? project.depthMode,
      depthMapSource: template.depthMapSource ?? project.depthMapSource,
      depthTuning: template.depthTuning ?? project.depthTuning,
      dynamicsTuning: template.dynamicsTuning ?? project.dynamicsTuning,
      headRollPivot: template.headRollPivot ?? project.headRollPivot,
      expressionState: template.expressionState ?? project.expressionState,
      layers
    }),
    report: {
      fileName,
      matchedLayers,
      unmatchedLayers: project.layers.length - matchedLayers,
      exactNameMatches,
      kindMatches,
      confidence,
      criticalMissing,
      unusedTemplateLayers,
      zWarnings,
      layerMatches,
      warnings
    }
  };
}

export async function readProjectFile(file: File): Promise<RigProject> {
  const text = await file.text();
  const project = JSON.parse(text) as Partial<RigProject>;
  if (!project || project.version !== 1 || !Array.isArray(project.layers) || !Array.isArray(project.bones)) {
    throw new Error("这不是 Auto Live2D Studio v1 工程 JSON。");
  }
  return withCompatibleProjectDefaults(project as RigProject);
}
