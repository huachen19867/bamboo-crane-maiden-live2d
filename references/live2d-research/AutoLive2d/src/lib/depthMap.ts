import { readPsd } from "ag-psd";
import type { PsdLayerAsset, RigProject } from "../types/rig";

async function canvasFromImageFile(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
    canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function compositePsdCanvas(psd: { width: number; height: number; canvas?: HTMLCanvasElement; children?: Array<{ canvas?: HTMLCanvasElement; hidden?: boolean; left?: number; top?: number; children?: unknown[] }> }): HTMLCanvasElement {
  if (psd.canvas) return psd.canvas;

  const canvas = document.createElement("canvas");
  canvas.width = psd.width;
  canvas.height = psd.height;
  const context = canvas.getContext("2d");
  const draw = (children?: typeof psd.children) => {
    for (const layer of children ?? []) {
      if (layer.hidden) continue;
      if (Array.isArray(layer.children)) {
        draw(layer.children as typeof psd.children);
        continue;
      }
      if (layer.canvas) context?.drawImage(layer.canvas, layer.left ?? 0, layer.top ?? 0);
    }
  };
  draw(psd.children);
  return canvas;
}

export async function readDepthMapFile(file: File): Promise<HTMLCanvasElement> {
  if (/\.psd$/i.test(file.name) || file.type.includes("photoshop")) {
    const psd = readPsd(await file.arrayBuffer(), {
      skipThumbnail: true,
      skipCompositeImageData: false,
      logMissingFeatures: true
    });
    return compositePsdCanvas(psd);
  }

  return canvasFromImageFile(file);
}

function sampleGray(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  const index = (py * width + px) * 4;
  const alpha = data[index + 3] / 255;
  if (alpha <= 0.01) return 0.5;
  return (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;
}

export function applyDepthCanvasToProject(project: RigProject, depthCanvas: HTMLCanvasElement, invert = false): RigProject {
  const context = depthCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("深度图 Canvas 不可读。");
  const data = context.getImageData(0, 0, depthCanvas.width, depthCanvas.height).data;

  const layers = project.layers.map((layer): PsdLayerAsset => {
    const depths = layer.mesh.points.map((point) => {
      const gray = sampleGray(
        data,
        depthCanvas.width,
        depthCanvas.height,
        point.x * depthCanvas.width,
        point.y * depthCanvas.height
      );
      const normalized = invert ? gray : 1 - gray;
      return (normalized - 0.5) * 0.42;
    });
    return {
      ...layer,
      mesh: {
        ...layer.mesh,
        depths
      }
    };
  });

  return {
    ...project,
    layers,
    depthMode: "depthMap",
    depthMapSource: `${depthCanvas.width}x${depthCanvas.height}${invert ? " inverted" : ""}`
  };
}

export function rebuildProxyDepths(project: RigProject): RigProject {
  return {
    ...project,
    depthMode: "proxyHead",
    depthMapSource: "procedural proxy head"
  };
}
