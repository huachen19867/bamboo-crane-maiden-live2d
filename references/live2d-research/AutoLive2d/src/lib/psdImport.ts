import { readPsd, type Layer } from "ag-psd";
import { classifyLayer } from "./classify";
import { defaultBones, defaultDepthTuning, defaultDynamicsTuning, defaultHeadRollPivot, defaultParameters, defaultPhysicsTemplates, defaultTrackingSettings } from "./defaults";
import { defaultPivotForKind, makeDefaultDeformers, makeGridMesh, recommendedPhysicsTemplate } from "./mesh";
import type { ImportReport, PartKind, PsdLayerAsset, Rect, RigProject } from "../types/rig";

interface FlatLayer {
  layer: Layer;
  path: string[];
  order: number;
}

export interface PsdImportResult {
  project: RigProject;
  report: ImportReport;
}

function layerId(path: string[], order: number): string {
  const slug = path
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  return `layer-${String(order).padStart(3, "0")}-${slug || "unnamed"}`;
}

function rectFromLayer(layer: Layer, canvasWidth: number, canvasHeight: number): Rect {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const right = layer.right ?? canvasWidth;
  const bottom = layer.bottom ?? canvasHeight;
  return {
    x: left / canvasWidth,
    y: top / canvasHeight,
    width: Math.max(1, right - left) / canvasWidth,
    height: Math.max(1, bottom - top) / canvasHeight
  };
}

function walkLayers(children: Layer[] | undefined, path: string[] = [], output: FlatLayer[] = []): FlatLayer[] {
  for (const layer of children ?? []) {
    const nextPath = [...path, layer.name || "未命名图层"];
    if (layer.children?.length) {
      walkLayers(layer.children, nextPath, output);
      continue;
    }
    output.push({ layer, path: nextPath, order: output.length });
  }
  return output;
}

function canvasToObjectUrl(canvas: HTMLCanvasElement | undefined): string {
  if (!canvas) return "";
  return canvas.toDataURL("image/png");
}

const splittableKinds = new Set<PartKind>(["eyeWhite", "iris", "eyelash", "eyebrow", "arm", "hand"]);
const eyePairKinds = new Set<PartKind>(["eyeWhite", "iris", "eyelash", "eyebrow"]);
const fineFeatureKinds = new Set<PartKind>(["eyeWhite", "iris", "eyelash", "eyebrow", "nose", "mouth", "ear"]);

function explicitSideFromName(name: string): PsdLayerAsset["side"] {
  const normalized = name.toLowerCase();
  if (/(^|[\s._-])(l|left)(?=$|[\s._-])/.test(normalized)) return "left";
  if (/(^|[\s._-])(r|right)(?=$|[\s._-])/.test(normalized)) return "right";
  if (/(^|[\s_-])(l|left)([\s_-]|$)/.test(normalized) || /左|左侧|左臂|左手/.test(name)) return "left";
  if (/(^|[\s_-])(r|right)([\s_-]|$)/.test(normalized) || /右|右侧|右臂|右手/.test(name)) return "right";
  if (/(^|[\s_-])(l|left|左)([\s_-]|$)/.test(normalized)) return "left";
  if (/(^|[\s_-])(r|right|右)([\s_-]|$)/.test(normalized)) return "right";
  return undefined;
}

interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

interface AlphaComponent extends PixelBounds {
  sumX: number;
  sumY: number;
}

function entireBounds(width: number, height: number): PixelBounds {
  return { x: 0, y: 0, width, height, pixels: width * height };
}

function alphaComponents(canvas: HTMLCanvasElement, x0: number, x1: number): AlphaComponent[] {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  const startX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x0)));
  const endX = Math.max(startX + 1, Math.min(canvas.width, Math.ceil(x1)));
  const width = canvas.width;
  const height = canvas.height;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const visited = new Uint8Array(width * height);
  const components: AlphaComponent[] = [];

  const isOpaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] > 8;

  for (let y = 0; y < height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = y * width + x;
      if (visited[index] || !isOpaque(x, y)) continue;

      const stack = [index];
      visited[index] = 1;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let pixels = 0;
      let sumX = 0;
      let sumY = 0;

      while (stack.length) {
        const current = stack.pop() ?? 0;
        const cx = current % width;
        const cy = Math.floor(current / width);
        pixels += 1;
        sumX += cx;
        sumY += cy;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < startX || nx >= endX || ny < 0 || ny >= height) continue;
            const nextIndex = ny * width + nx;
            if (visited[nextIndex] || !isOpaque(nx, ny)) continue;
            visited[nextIndex] = 1;
            stack.push(nextIndex);
          }
        }
      }

      if (pixels >= 2) {
        components.push({
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          pixels,
          sumX,
          sumY
        });
      }
    }
  }

  return components;
}

function denseAlphaBounds(canvas: HTMLCanvasElement, x0: number, x1: number, kind: PartKind): PixelBounds | undefined {
  if (!eyePairKinds.has(kind)) return undefined;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  const startX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x0)));
  const endX = Math.max(startX + 1, Math.min(canvas.width, Math.ceil(x1)));
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const rowCounts = new Array(canvas.height).fill(0) as number[];
  const colCounts = new Array(canvas.width).fill(0) as number[];
  let pixels = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha <= 14) continue;
      rowCounts[y] += 1;
      colCounts[x] += 1;
      pixels += 1;
    }
  }

  if (pixels < 12) return undefined;
  const maxRow = Math.max(...rowCounts);
  const maxCol = Math.max(...colCounts.slice(startX, endX));
  const rowThreshold = Math.max(2, Math.floor(maxRow * 0.08));
  const colThreshold = Math.max(2, Math.floor(maxCol * 0.08));
  const rows = rowCounts.map((count, y) => ({ count, y })).filter(({ count }) => count >= rowThreshold);
  const cols = colCounts.map((count, x) => ({ count, x })).filter(({ count, x }) => x >= startX && x < endX && count >= colThreshold);

  if (!rows.length || !cols.length) return undefined;
  const minX = Math.min(...cols.map(({ x }) => x));
  const maxX = Math.max(...cols.map(({ x }) => x));
  const minY = Math.min(...rows.map(({ y }) => y));
  const maxY = Math.max(...rows.map(({ y }) => y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width < 2 || height < 2) return undefined;

  let densePixels = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 14) densePixels += 1;
    }
  }

  const density = densePixels / Math.max(1, width * height);
  const aspect = width / Math.max(1, height);
  const maxAspect = kind === "iris" ? 5 : 12;
  const minDensity = kind === "iris" ? 0.05 : 0.025;
  if (density < minDensity || aspect > maxAspect || aspect < 0.12) return undefined;

  return { x: minX, y: minY, width, height, pixels: densePixels };
}

function componentCenter(component: AlphaComponent) {
  return {
    x: component.sumX / Math.max(1, component.pixels),
    y: component.sumY / Math.max(1, component.pixels)
  };
}

function keepMainFeatureCluster(components: AlphaComponent[], kind: PartKind): AlphaComponent[] {
  if (!components.length) return [];
  const main = components[0];
  const mainCenter = componentCenter(main);
  const maxDx = kind === "ear" ? Number.POSITIVE_INFINITY : Math.max(24, main.width * 2.2);
  const maxDy = Math.max(18, main.height * 2.4);

  return components.filter((component, index) => {
    if (index === 0) return true;
    if (component.pixels < main.pixels * (kind === "ear" ? 0.18 : 0.025)) return false;
    const center = componentCenter(component);
    return Math.abs(center.x - mainCenter.x) <= maxDx && Math.abs(center.y - mainCenter.y) <= maxDy;
  });
}

function meaningfulAlphaComponents(canvas: HTMLCanvasElement, x0: number, x1: number, kind: PartKind, preferMainEyeCluster = false): AlphaComponent[] {
  const components = alphaComponents(canvas, x0, x1).sort((a, b) => b.pixels - a.pixels);
  if (!components.length) return [];

  const maxPixels = components[0].pixels;
  const isFineFeature = eyePairKinds.has(kind) || kind === "nose" || kind === "mouth";
  const minPixels = isFineFeature ? Math.max(3, Math.round(maxPixels * 0.025)) : Math.max(12, Math.round(maxPixels * 0.012));
  const filtered = components.filter((component) => {
    if (component.pixels < minPixels) return false;
    if (!eyePairKinds.has(kind)) return true;
    const density = component.pixels / Math.max(1, component.width * component.height);
    const aspect = component.width / Math.max(1, component.height);
    return density >= 0.014 && aspect <= 9 && aspect >= 0.12;
  });

  const meaningful = filtered.length ? filtered : components.slice(0, Math.min(4, components.length));
  return preferMainEyeCluster && fineFeatureKinds.has(kind) ? keepMainFeatureCluster(meaningful, kind) : meaningful;
}

function shouldDropTinyAsset(asset: PsdLayerAsset, source: HTMLCanvasElement | undefined, box?: PixelBounds): boolean {
  const documentArea = asset.naturalBounds.width * asset.naturalBounds.height;
  if (documentArea < 0.0002) return true;
  if (!source || !box) return false;
  const canvasArea = Math.max(1, source.width * source.height);
  const visibleArea = box.width * box.height;
  const visibleRatio = visibleArea / canvasArea;
  const pixelRatio = box.pixels / canvasArea;
  if (asset.attachment?.type === "object") return documentArea < 0.0005 || visibleRatio < 0.00008 || box.pixels < 24;
  if (asset.kind === "unknown") return documentArea < 0.0005 || visibleRatio < 0.00008 || box.pixels < 24;
  if (asset.kind === "backHair" || asset.kind === "frontHair" || asset.kind === "sideHair" || asset.kind === "torso" || asset.kind === "topWear") {
    return documentArea < 0.001 || visibleRatio < 0.00018 || pixelRatio < 0.000035;
  }
  return box.pixels < 8;
}

function unionComponents(components: AlphaComponent[]): PixelBounds | undefined {
  if (!components.length) return undefined;

  const minX = Math.min(...components.map((component) => component.x));
  const minY = Math.min(...components.map((component) => component.y));
  const maxX = Math.max(...components.map((component) => component.x + component.width - 1));
  const maxY = Math.max(...components.map((component) => component.y + component.height - 1));
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    pixels: components.reduce((sum, component) => sum + component.pixels, 0)
  };
}

function alphaBounds(canvas: HTMLCanvasElement, x0: number, x1: number, kind: PartKind = "unknown", preferMainEyeCluster = false): PixelBounds | undefined {
  const dense = denseAlphaBounds(canvas, x0, x1, kind);
  const bounds = unionComponents(meaningfulAlphaComponents(canvas, x0, x1, kind, preferMainEyeCluster));
  if (dense && (!bounds || dense.width * dense.height < bounds.width * bounds.height)) return dense;
  if (!bounds || bounds.pixels < 12) return undefined;
  return bounds;
}

function paddedBounds(box: PixelBounds, canvasWidth: number, canvasHeight: number, paddingRatio = 0.06): PixelBounds {
  const padX = Math.max(1, Math.round(box.width * paddingRatio));
  const padY = Math.max(1, Math.round(box.height * paddingRatio));
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const right = Math.min(canvasWidth, box.x + box.width + padX);
  const bottom = Math.min(canvasHeight, box.y + box.height + padY);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), pixels: box.pixels };
}

function alphaTrimmedBounds(source: HTMLCanvasElement, kind: PartKind, preferMainFeatureCluster = fineFeatureKinds.has(kind)): PixelBounds | undefined {
  const full = alphaBounds(source, 0, source.width, kind, preferMainFeatureCluster);
  if (!full) return undefined;
  return paddedBounds(full, source.width, source.height);
}

function alphaValleySplit(source: HTMLCanvasElement, box: PixelBounds, preferredX: number): number {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return preferredX;
  const data = context.getImageData(0, 0, source.width, source.height).data;
  const minSide = Math.max(2, Math.round(box.width * 0.18));
  const start = Math.max(box.x + minSide, Math.round(preferredX - box.width * 0.24));
  const end = Math.min(box.x + box.width - minSide, Math.round(preferredX + box.width * 0.24));
  if (end <= start) return preferredX;

  let bestX = Math.round(preferredX);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let x = start; x <= end; x += 1) {
    let alpha = 0;
    for (let y = box.y; y < box.y + box.height; y += 1) {
      alpha += data[(y * source.width + x) * 4 + 3];
    }
    const centerPenalty = Math.abs(x - preferredX) * Math.max(1, box.height * 0.08);
    const score = alpha + centerPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  return bestX;
}

function cropCanvas(source: HTMLCanvasElement, box: PixelBounds): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, box.width);
  canvas.height = Math.max(1, box.height);
  const context = canvas.getContext("2d");
  context?.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return canvas;
}

function boundsFromCrop(base: Rect, source: HTMLCanvasElement, box: PixelBounds): Rect {
  return {
    x: base.x + (box.x / Math.max(1, source.width)) * base.width,
    y: base.y + (box.y / Math.max(1, source.height)) * base.height,
    width: (box.width / Math.max(1, source.width)) * base.width,
    height: (box.height / Math.max(1, source.height)) * base.height
  };
}

function trimAssetToBox(asset: PsdLayerAsset, source: HTMLCanvasElement | undefined, box?: PixelBounds): PsdLayerAsset {
  if (!source) return asset;
  const cropBox = box ?? alphaTrimmedBounds(source, asset.kind) ?? entireBounds(source.width, source.height);
  const cropBounds = boundsFromCrop(asset.naturalBounds, source, cropBox);
  return {
    ...asset,
    bounds: cropBounds,
    naturalBounds: cropBounds,
    imageUrl: canvasToObjectUrl(cropCanvas(source, cropBox)),
    pivot: asset.pivot ?? defaultPivotForKind(asset.kind, cropBounds, asset.side),
    mesh: makeGridMesh(asset.kind, cropBounds),
    inertiaScale: defaultLayerInertiaScale(asset.kind, cropBounds)
  };
}

function splitSymmetricLayer(asset: PsdLayerAsset, source: HTMLCanvasElement | undefined): PsdLayerAsset[] {
  if (!source || !splittableKinds.has(asset.kind) || explicitSideFromName(asset.sourceName)) {
    return [trimAssetToBox(asset, source)];
  }

  const fullBox = alphaTrimmedBounds(source, asset.kind, false);
  if (!fullBox) return [trimAssetToBox(asset, source)];
  const documentSplit = ((0.5 - asset.naturalBounds.x) / Math.max(0.0001, asset.naturalBounds.width)) * source.width;
  const layerSplit = fullBox.x + fullBox.width * 0.5;
  const isFullCanvasLike = asset.naturalBounds.width > 0.82;
  const isEyePair = eyePairKinds.has(asset.kind);
  const shouldPreferDocumentCenter = isFullCanvasLike || asset.kind === "arm" || asset.kind === "hand" || isEyePair;
  const preferredSplit = shouldPreferDocumentCenter && documentSplit > fullBox.x + 2 && documentSplit < fullBox.x + fullBox.width - 2 ? documentSplit : layerSplit;
  const splitX = isEyePair && isFullCanvasLike ? alphaValleySplit(source, fullBox, preferredSplit) : preferredSplit;
  const leftBox = alphaBounds(source, 0, splitX, asset.kind, isEyePair);
  const rightBox = alphaBounds(source, splitX, source.width, asset.kind, isEyePair);

  if (!leftBox || !rightBox) return [trimAssetToBox(asset, source)];
  const minVisibleWidth = Math.max(isEyePair ? 1 : 2, source.width * (isEyePair ? 0.006 : 0.035));
  if (leftBox.width < minVisibleWidth || rightBox.width < minVisibleWidth) return [trimAssetToBox(asset, source)];
  const leftCrop = paddedBounds(leftBox, source.width, source.height);
  const rightCrop = paddedBounds(rightBox, source.width, source.height);
  const leftBounds = boundsFromCrop(asset.naturalBounds, source, leftCrop);
  const rightBounds = boundsFromCrop(asset.naturalBounds, source, rightCrop);

  return [
    {
      ...asset,
      id: `${asset.id}-left`,
      sourceName: `${asset.sourceName} L`,
      side: "left",
      bounds: leftBounds,
      naturalBounds: leftBounds,
      imageUrl: canvasToObjectUrl(cropCanvas(source, leftCrop)),
      z: asset.z - 0.002,
      pivot: defaultPivotForKind(asset.kind, leftBounds, "left"),
      mesh: makeGridMesh(asset.kind, leftBounds),
      inertiaScale: defaultLayerInertiaScale(asset.kind, leftBounds)
    },
    {
      ...asset,
      id: `${asset.id}-right`,
      sourceName: `${asset.sourceName} R`,
      side: "right",
      bounds: rightBounds,
      naturalBounds: rightBounds,
      imageUrl: canvasToObjectUrl(cropCanvas(source, rightCrop)),
      z: asset.z + 0.002,
      pivot: defaultPivotForKind(asset.kind, rightBounds, "right"),
      mesh: makeGridMesh(asset.kind, rightBounds),
      inertiaScale: defaultLayerInertiaScale(asset.kind, rightBounds)
    }
  ];
}

function objectParentBoneForBounds(bounds: Rect, classifiedParentBoneId: string): string {
  if (classifiedParentBoneId && classifiedParentBoneId !== "root") return classifiedParentBoneId;
  const centerY = bounds.y + bounds.height * 0.5;
  if (centerY < 0.56) return "head";
  return "body";
}

function makeAssets(flat: FlatLayer, canvasWidth: number, canvasHeight: number): PsdLayerAsset[] {
  const name = flat.path.at(-1) ?? "layer";
  const classified = classifyLayer(name);
  const bounds = rectFromLayer(flat.layer, canvasWidth, canvasHeight);
  const side = explicitSideFromName(name);
  const isObjectAttachment = classified.kind === "unknown" || classified.kind === "accessory";
  const kind = classified.kind === "unknown" ? "accessory" : classified.kind;
  const parentBoneId = isObjectAttachment ? objectParentBoneForBounds(bounds, classified.parentBoneId) : classified.parentBoneId;
  const asset: PsdLayerAsset = {
    id: layerId(flat.path, flat.order),
    sourceName: name,
    path: flat.path,
    kind,
    side,
    bounds,
    naturalBounds: bounds,
    opacity: flat.layer.opacity ?? 1,
    visible: !flat.layer.hidden,
    blendMode: flat.layer.blendMode ?? "normal",
    imageUrl: canvasToObjectUrl(flat.layer.canvas),
    z: classified.recommendedZ + flat.order * 0.01,
    recommendedZ: classified.recommendedZ,
    parentBoneId,
    pivot: defaultPivotForKind(kind, bounds, side),
    mesh: makeGridMesh(kind, bounds),
    deformers: makeDefaultDeformers(kind),
    physicsTemplateId: recommendedPhysicsTemplate(kind),
    inertiaScale: defaultLayerInertiaScale(kind, bounds),
    attachment: isObjectAttachment
      ? {
          type: "object",
          notes: classified.kind === "unknown" ? "Imported as obj attachment from an unrecognized PSD layer." : "Imported as obj attachment from an accessory/object PSD layer."
        }
      : undefined
  };

  const source = flat.layer.canvas;
  const box = source ? alphaTrimmedBounds(source, asset.kind) : undefined;
  if (shouldDropTinyAsset(asset, source, box)) return [];
  return splitSymmetricLayer(asset, source);
}

function defaultLayerInertiaScale(kind: PsdLayerAsset["kind"], bounds: Rect): number | undefined {
  if (kind !== "frontHair" && kind !== "sideHair" && kind !== "backHair" && kind !== "accessory") return undefined;
  const area = bounds.width * bounds.height;
  const areaScale = Math.sqrt(Math.max(0.0001, area) / 0.09);
  const base = kind === "accessory" ? 0.82 : kind === "backHair" ? 1.08 : 1;
  return Math.round(Math.min(1.55, Math.max(0.55, base * areaScale)) * 100) / 100;
}

export async function importPsdFile(file: File): Promise<PsdImportResult> {
  const buffer = await file.arrayBuffer();
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipThumbnail: true,
    logMissingFeatures: true
  });

  const flat = walkLayers(psd.children);
  const layers = flat.flatMap((item) => makeAssets(item, psd.width, psd.height)).sort((a, b) => a.z - b.z);
  const sourceOrder = new Map(flat.map((item) => [layerId(item.path, item.order), item.order]));
  const zFixes = layers
    .map((layer, index) => ({ layer, from: sourceOrder.get(layer.id.replace(/-(left|right)$/, "")) ?? index }))
    .filter(({ layer, from }) => Math.round(layer.recommendedZ) !== from)
    .map(({ layer, from }) => ({ layerId: layer.id, sourceName: layer.sourceName, from, to: layer.recommendedZ }));

  const project: RigProject = {
    version: 1,
    name: file.name.replace(/\.[^.]+$/, "") || "未命名角色",
    canvas: {
      width: psd.width,
      height: psd.height
    },
    source: {
      fileName: file.name,
      importedAt: new Date().toISOString(),
      layerCount: layers.length
    },
    layers,
    bones: structuredClone(defaultBones),
    parameters: structuredClone(defaultParameters),
    physicsTemplates: structuredClone(defaultPhysicsTemplates),
    widgets: [],
    depthTuning: structuredClone(defaultDepthTuning),
    dynamicsTuning: structuredClone(defaultDynamicsTuning),
    parameterSnapshots: [],
    stageBackground: "checker",
    headRollPivot: structuredClone(defaultHeadRollPivot),
    tracking: structuredClone(defaultTrackingSettings)
  };

  const report: ImportReport = {
    fileName: file.name,
    canvasWidth: psd.width,
    canvasHeight: psd.height,
    layerCount: layers.length,
    visibleLayerCount: layers.filter((layer) => layer.visible).length,
    unknownLayerCount: layers.filter((layer) => layer.kind === "unknown").length,
    objectLayerCount: layers.filter((layer) => layer.attachment?.type === "object").length,
    expressionLayerCount: layers.filter((layer) => layer.attachment?.type === "expression").length,
    zFixes
  };

  return { project, report };
}

export type SamplePsdPreset = "u3" | "u4" | "u5" | "u6";

export async function loadDevSamplePsd(preset: SamplePsdPreset = "u3"): Promise<File> {
  const response = await fetch(`/api/sample-psd?preset=${encodeURIComponent(preset)}`);
  if (!response.ok) throw new Error(await response.text());
  const blob = await response.blob();
  return new File([blob], `${preset}.psd`, { type: "image/vnd.adobe.photoshop" });
}
