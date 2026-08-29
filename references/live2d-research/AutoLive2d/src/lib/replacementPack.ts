import JSZip from "jszip";
import { makeTemplate } from "./template";
import type { PsdLayerAsset, RigProject } from "../types/rig";

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",", 2)[1] ?? "";
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
  for (const layer of layers) {
    if (!layer.visible || !layer.imageUrl) continue;
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

function layerStructure(layer: PsdLayerAsset) {
  return {
    sourceName: layer.sourceName,
    kind: layer.kind,
    side: layer.side ?? null,
    z: layer.z,
    parentBoneId: layer.parentBoneId,
    bounds: layer.bounds,
    naturalBounds: layer.naturalBounds,
    localScale: layer.localScale ?? 1,
    localRotation: layer.localRotation ?? 0,
    mesh: {
      rows: layer.mesh.rows,
      cols: layer.mesh.cols
    },
    physicsTemplateId: layer.physicsTemplateId ?? null,
    attachment: layer.attachment ?? null
  };
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "layer";
}

export async function makeReplacementPack(project: RigProject): Promise<Blob> {
  if (!project.layers.length) {
    throw new Error("请先导入 PSD，再导出替换包。");
  }

  const zip = new JSZip();
  const template = makeTemplate(project);
  const referencePng = await makeCompositeReference(project);
  const structure = {
    version: 1,
    purpose: "texture-replacement-structure",
    canvas: project.canvas,
    source: project.source,
    depthMode: project.depthMode ?? "manual",
    depthMapSource: project.depthMapSource ?? null,
    expressionState: project.expressionState ?? { active: {} },
    layerCount: project.layers.length,
    layers: [...project.layers].sort((a, b) => a.z - b.z).map(layerStructure)
  };
  const workflow = {
    version: 1,
    workflow: "material-replacement",
    steps: [
      "Use reference.png as the visual identity and pose reference for a new character.",
      "Keep the character front-facing and close to the same T-pose / upper-body layout.",
      "Generate a transparent PNG if possible, then run the existing automatic PSD splitter.",
      "Ensure PSD layer names stay close to structure.json layer sourceName/kind values.",
      "Import the new PSD into Auto Live2D Studio and use template.json with 套用模板.",
      "Check unmatched layer count, then adjust Z, mesh and physics only where needed."
    ],
    constraints: {
      canvas: project.canvas,
      keepLayerSemantics: structure.layers.map((layer) => ({
        name: layer.sourceName,
        kind: layer.kind,
        z: layer.z
      })),
      avoid: [
        "large pose changes",
        "hands covering face unless the template has the same layout",
        "merged eyes/mouth/hair layers",
        "opaque background"
      ]
    }
  };

  zip.file("reference.png", dataUrlToBase64(referencePng), { base64: true });
  [...project.layers].sort((a, b) => a.z - b.z).forEach((layer, index) => {
    if (!layer.imageUrl) return;
    const indexLabel = String(index + 1).padStart(2, "0");
    zip.file(`layers/${indexLabel}_${layer.kind}_${safeFileName(layer.sourceName)}.png`, dataUrlToBase64(layer.imageUrl), { base64: true });
  });
  zip.file("template.json", JSON.stringify(template, null, 2));
  zip.file("structure.json", JSON.stringify(structure, null, 2));
  zip.file("workflow.json", JSON.stringify(workflow, null, 2));
  zip.file(
    "image2_prompt.txt",
    [
      "Generate a front-facing transparent-background character that keeps the same pose, framing, and layer semantics as reference.png.",
      "Keep eyes, iris/pupils, mouth, front hair, back hair, clothing, arms/hands, and accessories separable enough for the PSD splitter.",
      "Avoid strong perspective, crossed arms, hands covering the face, merged facial features, and opaque backgrounds.",
      "After generation, split the image into PSD layers and apply template.json in Auto Live2D Studio as a material-replacement rig."
    ].join("\n")
  );
  zip.file(
    "README.md",
    [
      "# Auto Live2D Material Replacement Pack",
      "",
      "Use `reference.png` as the identity/style reference for external image generation.",
      "Use `layers/*.png` as per-part transparent references when you need stronger layer consistency.",
      "Use `structure.json` to keep the generated character compatible with the template.",
      "After generating and splitting the new character into PSD layers, import the PSD and apply `template.json`.",
      "",
      "This pack is intended for texture/material replacement, not Cubism/Inochi export."
    ].join("\n")
  );

  return zip.generateAsync({ type: "blob" });
}
