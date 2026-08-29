import fs from "node:fs";
import { readPsd } from "ag-psd";

const preset = process.env.SAMPLE_PSD_PRESET ?? "u3";
const presetPaths = {
  u3: "public/samples/u3/input.psd",
  u4: "public/samples/u4/input.psd",
  u5: "public/samples/u5/input.psd",
  u6: "public/samples/u6/input.psd"
};
const samplePsdPath = process.env.SAMPLE_PSD_PATH ?? presetPaths[preset] ?? presetPaths.u3;

function walk(children = [], output = [], path = []) {
  for (const layer of children) {
    const nextPath = [...path, layer.name || "unnamed"];
    if (layer.children?.length) {
      walk(layer.children, output, nextPath);
    } else {
      output.push({
        name: nextPath.join("/"),
        left: layer.left,
        top: layer.top,
        right: layer.right,
        bottom: layer.bottom,
        hidden: Boolean(layer.hidden)
      });
    }
  }
  return output;
}

if (!fs.existsSync(samplePsdPath)) {
  console.error(`Missing sample PSD: ${samplePsdPath}`);
  process.exit(1);
}

const psd = readPsd(fs.readFileSync(samplePsdPath), {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true
});
const layers = walk(psd.children);

console.log(JSON.stringify(
  {
    path: samplePsdPath,
    width: psd.width,
    height: psd.height,
    layerCount: layers.length,
    layers
  },
  null,
  2
));
