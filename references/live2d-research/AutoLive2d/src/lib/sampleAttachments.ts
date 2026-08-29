import { defaultPivotForKind, makeDefaultDeformers, makeMeshWithDensity, recommendedPhysicsTemplate } from "./mesh";
import type { LayerAttachment, PartKind, PsdLayerAsset, Rect, RigProject } from "../types/rig";
import type { SamplePsdPreset } from "./psdImport";

interface SampleAttachmentManifest {
  version: 1;
  preset: SamplePsdPreset;
  assets: SampleAttachmentAsset[];
  defaultExpressionState?: RigProject["expressionState"];
}

interface SampleAttachmentAsset {
  id: string;
  sourceName: string;
  kind: PartKind;
  side?: PsdLayerAsset["side"];
  parentBoneId: string;
  z: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  file?: string;
  cloneOf?: SampleAttachmentCloneSource;
  bounds?: Rect;
  attachment: LayerAttachment;
  physicsTemplateId?: string;
  inertiaScale?: number;
  localScale?: number;
  localRotation?: number;
  meshRows?: number;
  meshCols?: number;
}

interface SampleAttachmentCloneSource {
  kind?: PartKind;
  side?: PsdLayerAsset["side"];
  sourceNameIncludes?: string;
  depthTargetKind?: PartKind;
  depthTargetNameIncludes?: string;
  depthRatio?: number;
}

const attachmentBoundsOverflow = 0.5;

function clampRect(rect: Rect): Rect {
  const x = Math.min(1 + attachmentBoundsOverflow, Math.max(-attachmentBoundsOverflow, rect.x));
  const y = Math.min(1 + attachmentBoundsOverflow, Math.max(-attachmentBoundsOverflow, rect.y));
  return {
    x,
    y,
    width: Math.max(0.0001, Math.min(1 + attachmentBoundsOverflow * 2, rect.width)),
    height: Math.max(0.0001, Math.min(1 + attachmentBoundsOverflow * 2, rect.height))
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read sample attachment image."));
    reader.readAsDataURL(blob);
  });
}

async function loadSampleAttachmentImage(preset: SamplePsdPreset, file: string): Promise<string> {
  const response = await fetch(`/samples/${encodeURIComponent(preset)}/${file}`);
  if (!response.ok) throw new Error(`Missing sample attachment: ${preset}/${file}`);
  return blobToDataUrl(await response.blob());
}

function averageDepth(layer: PsdLayerAsset): number {
  if (!layer.mesh.points.length) return 0;
  return layer.mesh.points.reduce((sum, _, index) => sum + (layer.mesh.depths?.[index] ?? 0), 0) / layer.mesh.points.length;
}

function shiftMeshAverageDepth(layer: PsdLayerAsset, mesh: PsdLayerAsset["mesh"], targetAverage: number): PsdLayerAsset["mesh"] {
  const currentAverage = averageDepth({ ...layer, mesh });
  const delta = targetAverage - currentAverage;
  return {
    ...mesh,
    points: mesh.points.map((point) => ({ ...point })),
    depths: mesh.points.map((_, index) => (mesh.depths?.[index] ?? 0) + delta),
    projectedDepths: undefined
  };
}

function findCloneLayer(layers: PsdLayerAsset[], clone: SampleAttachmentCloneSource | undefined): PsdLayerAsset | undefined {
  if (!clone) return undefined;
  const nameNeedle = clone.sourceNameIncludes?.toLowerCase();
  const candidates = layers
    .filter((layer) => layer.attachment?.type !== "expression")
    .filter((layer) => !clone.kind || layer.kind === clone.kind)
    .filter((layer) => !clone.side || layer.side === clone.side)
    .filter((layer) => !nameNeedle || layer.sourceName.toLowerCase().includes(nameNeedle))
    .sort((a, b) => b.naturalBounds.width * b.naturalBounds.height - a.naturalBounds.width * a.naturalBounds.height);
  return candidates[0];
}

function findDepthTargetLayer(layers: PsdLayerAsset[], clone: SampleAttachmentCloneSource | undefined): PsdLayerAsset | undefined {
  if (!clone?.depthTargetKind && !clone?.depthTargetNameIncludes) return undefined;
  const nameNeedle = clone.depthTargetNameIncludes?.toLowerCase();
  const candidates = layers
    .filter((layer) => layer.attachment?.type !== "expression")
    .filter((layer) => !clone.depthTargetKind || layer.kind === clone.depthTargetKind)
    .filter((layer) => !nameNeedle || layer.sourceName.toLowerCase().includes(nameNeedle))
    .sort((a, b) => b.naturalBounds.width * b.naturalBounds.height - a.naturalBounds.width * a.naturalBounds.height);
  return candidates[0];
}

async function loadSampleAttachmentManifest(preset: SamplePsdPreset): Promise<SampleAttachmentManifest | undefined> {
  const response = await fetch(`/samples/${encodeURIComponent(preset)}/attachments.json`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return undefined;
  return JSON.parse(trimmed) as SampleAttachmentManifest;
}

async function makeLayerFromAttachment(preset: SamplePsdPreset, item: SampleAttachmentAsset, project: RigProject): Promise<PsdLayerAsset | undefined> {
  if (item.cloneOf) {
    const source = findCloneLayer(project.layers, item.cloneOf);
    if (!source) return undefined;
    const target = findDepthTargetLayer(project.layers, item.cloneOf);
    const depthRatio = Math.min(1, Math.max(0, item.cloneOf.depthRatio ?? 0.5));
    const sourceAverage = averageDepth(source);
    const targetAverage = target ? averageDepth(target) : sourceAverage;
    const mesh = shiftMeshAverageDepth(source, structuredClone(source.mesh), sourceAverage + (targetAverage - sourceAverage) * depthRatio);

    return {
      ...source,
      id: item.id,
      sourceName: item.sourceName,
      path: [...source.path, item.sourceName],
      kind: item.kind,
      side: item.side ?? source.side,
      opacity: item.opacity ?? source.opacity,
      visible: item.visible ?? true,
      blendMode: item.blendMode ?? source.blendMode,
      z: item.z,
      recommendedZ: item.z,
      parentBoneId: item.parentBoneId,
      mesh,
      deformers: structuredClone(source.deformers),
      physicsTemplateId: item.physicsTemplateId ?? source.physicsTemplateId,
      inertiaScale: item.inertiaScale ?? source.inertiaScale,
      localScale: item.localScale ?? source.localScale,
      localRotation: item.localRotation ?? source.localRotation,
      attachment: {
        ...item.attachment,
        cloneKind: item.attachment.cloneKind ?? item.cloneOf.kind
      }
    };
  }

  if (!item.file || !item.bounds) return undefined;
  const bounds = clampRect(item.bounds);
  const rows = item.meshRows ?? 4;
  const cols = item.meshCols ?? 4;
  const imageUrl = await loadSampleAttachmentImage(preset, item.file);
  return {
    id: item.id,
    sourceName: item.sourceName,
    path: ["sample attachments", item.sourceName],
    kind: item.kind,
    side: item.side,
    bounds,
    naturalBounds: bounds,
    opacity: item.opacity ?? 1,
    visible: item.visible ?? true,
    blendMode: item.blendMode ?? "normal",
    imageUrl,
    z: item.z,
    recommendedZ: item.z,
    parentBoneId: item.parentBoneId,
    pivot: defaultPivotForKind(item.kind, bounds),
    localScale: item.localScale,
    localRotation: item.localRotation,
    mesh: makeMeshWithDensity(bounds, rows, cols, item.kind),
    deformers: makeDefaultDeformers(item.kind),
    physicsTemplateId: item.physicsTemplateId ?? recommendedPhysicsTemplate(item.kind),
    inertiaScale: item.inertiaScale,
    attachment: item.attachment
  };
}

export async function attachSampleCompanionLayers(project: RigProject, preset: SamplePsdPreset): Promise<RigProject> {
  const manifest = await loadSampleAttachmentManifest(preset);
  if (!manifest?.assets?.length) return project;

  const existingIds = new Set(project.layers.map((layer) => layer.id));
  const companionLayers = (
    await Promise.all(manifest.assets.map((item) => (existingIds.has(item.id) ? undefined : makeLayerFromAttachment(preset, item, project))))
  ).filter((layer): layer is PsdLayerAsset => Boolean(layer));
  if (!companionLayers.length) return project;

  return {
    ...project,
    layers: [...project.layers, ...companionLayers].sort((a, b) => a.z - b.z),
    source: {
      ...project.source,
      layerCount: project.layers.length + companionLayers.length
    },
    expressionState: {
      active: {
        ...(manifest.defaultExpressionState?.active ?? {}),
        ...(project.expressionState?.active ?? {})
      }
    }
  };
}
