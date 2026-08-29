import JSZip from "jszip";
import { makeRuntimeHtml } from "./runtimeExport";
import { makeTemplate, readProjectFile } from "./template";
import type { PsdLayerAsset, RigProject } from "../types/rig";

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",", 2)[1] ?? "";
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "layer";
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode().catch(
    () =>
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("image load failed"));
      })
  );
  return image;
}

async function makeCompositeReference(project: RigProject): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable.");

  const layers = [...project.layers].sort((a, b) => a.z - b.z);
  const activeExpressions = project.expressionState?.active ?? {};
  for (const layer of layers) {
    if (!layer.visible || !layer.imageUrl || !isLayerExportVisible(layer, activeExpressions)) continue;
    const image = await loadImage(layer.imageUrl);
    const x = layer.bounds.x * project.canvas.width;
    const y = layer.bounds.y * project.canvas.height;
    const width = layer.bounds.width * project.canvas.width;
    const height = layer.bounds.height * project.canvas.height;
    const scale = Math.min(4, Math.max(0.05, layer.localScale ?? 1));
    const rotation = ((layer.localRotation ?? 0) * Math.PI) / 180;
    context.save();
    context.globalAlpha = layer.opacity;
    context.translate(x + width * 0.5, y + height * 0.5);
    context.rotate(rotation);
    context.scale(scale, scale);
    context.drawImage(image, -width * 0.5, -height * 0.5, width, height);
    context.restore();
  }

  return canvas.toDataURL("image/png");
}

function expressionGroup(layer: PsdLayerAsset): string | undefined {
  if (layer.attachment?.type !== "expression") return undefined;
  return layer.attachment.exclusiveGroup || "expression";
}

function expressionKey(layer: PsdLayerAsset): string {
  return layer.attachment?.expressionKey || layer.id;
}

function isLayerExportVisible(layer: PsdLayerAsset, activeExpressions: Record<string, string>): boolean {
  const group = expressionGroup(layer);
  if (!group) return true;
  return activeExpressions[group] === expressionKey(layer);
}

function adapterSummary(project: RigProject) {
  const template = makeTemplate(project);
  return {
    version: 1,
    purpose: "adapted-live2d-parameters",
    name: project.name,
    canvas: project.canvas,
    source: project.source,
    depthMode: project.depthMode ?? "manual",
    depthTuning: project.depthTuning,
    dynamicsTuning: project.dynamicsTuning,
    headRollPivot: project.headRollPivot,
    expressionState: project.expressionState ?? { active: {} },
    bones: project.bones,
    parameters: project.parameters,
    physicsTemplates: project.physicsTemplates,
    widgets: project.widgets,
    layerBindings: template.layerBindings
  };
}

export async function makeFinishedPack(project: RigProject): Promise<Blob> {
  if (!project.layers.length) {
    throw new Error("请先导入并适配一个 PSD 工程，再导出成品包。");
  }

  const zip = new JSZip();
  const template = makeTemplate(project);
  const referencePng = await makeCompositeReference(project);
  const manifest = {
    version: 1,
    format: "auto-live2d-finished-pack",
    exportedAt: new Date().toISOString(),
    projectName: project.name,
    sourceFileName: project.source.fileName,
    entry: "project.json",
    adapter: "adapter.json",
    runtime: "runtime.html",
    note: "project.json embeds all layer images as data URLs, so the pack can be imported without re-running PSD adaptation."
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("project.json", JSON.stringify(project, null, 2));
  zip.file("adapter.json", JSON.stringify(adapterSummary(project), null, 2));
  zip.file("template.json", JSON.stringify(template, null, 2));
  zip.file("runtime.html", makeRuntimeHtml(project));
  zip.file("reference.png", dataUrlToBase64(referencePng), { base64: true });
  zip.file(
    "source/README.md",
    [
      "# Source PSD note",
      "",
      "The browser export cannot always include the original PSD binary.",
      "Use `project.json` for direct import; it embeds the adapted layer images and binding parameters.",
      "If you need to keep the original PSD, place it in this folder manually when archiving outside the browser."
    ].join("\n")
  );

  [...project.layers].sort((a, b) => a.z - b.z).forEach((layer, index) => {
    if (!layer.imageUrl) return;
    const indexLabel = String(index + 1).padStart(2, "0");
    const role = layer.attachment?.type ?? "standard";
    zip.file(`layers/${indexLabel}_${role}_${layer.kind}_${safeFileName(layer.sourceName)}.png`, dataUrlToBase64(layer.imageUrl), { base64: true });
  });

  zip.file(
    "README.md",
    [
      "# Auto Live2D Finished Pack",
      "",
      "Import this ZIP with Auto Live2D Studio's `导入成品包` button.",
      "",
      "- `project.json` is the ready-to-open adapted project with embedded layer images.",
      "- `adapter.json` is the binding/depth/physics/expression parameter file for agents and audits.",
      "- `template.json` can be applied to another same-structure PSD as a material-replacement template.",
      "- `runtime.html` is a standalone preview/runtime page.",
      "- `layers/*.png` are transparent per-layer debug references.",
      "",
      "This pack is not a Cubism/Inochi export; it is a deployable Auto Live2D Studio project folder."
    ].join("\n")
  );

  return zip.generateAsync({ type: "blob" });
}

export async function readFinishedPack(file: File): Promise<RigProject> {
  const zip = await JSZip.loadAsync(file);
  const projectEntry =
    zip.file("project.json") ??
    zip.file("adapted/project.json") ??
    zip.file("auto-live2d/project.json") ??
    Object.values(zip.files).find((entry) => !entry.dir && /(^|\/)project\.json$/i.test(entry.name));

  if (!projectEntry) {
    throw new Error("成品包中没有找到 project.json。");
  }

  const text = await projectEntry.async("text");
  const projectFile = new File([text], "project.json", { type: "application/json" });
  return readProjectFile(projectFile);
}
