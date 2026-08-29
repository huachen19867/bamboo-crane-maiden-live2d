import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const DEFAULT_REPORT_PATH = fileURLToPath(new URL(
  "../outputs/cubism-3114c6f061ac/model-report.json",
  import.meta.url,
));

function collectEntries(value, entries = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectEntries(item, entries);
    return entries;
  }
  if (!value || typeof value !== "object") return entries;
  if (typeof value.Id === "string") entries.push(value);
  for (const child of Object.values(value)) collectEntries(child, entries);
  return entries;
}

const outputPath = process.env.CUBISM_REPORT_PATH ?? DEFAULT_REPORT_PATH;
const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID: modelUid } = await client.request("GetCurrentModelUID");
  if (!modelUid) throw new Error("Cubism did not return a current ModelUID");

  const [parameters, parts, deformers] = await Promise.all([
    client.request("GetParameterStructure", { ModelUID: modelUid }),
    client.request("GetPartStructure", { ModelUID: modelUid }),
    client.request("GetDeformerStructure", { ModelUID: modelUid }),
  ]);
  const artMeshes = collectEntries(parts).filter((entry) => entry.Type === "ArtMesh");
  const objects = {};
  for (const artMesh of artMeshes) {
    objects[artMesh.Id] = await client.request("GetObject", {
      ModelUID: modelUid,
      Id: artMesh.Id,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    modelUid,
    parameters,
    parts,
    deformers,
    objects,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputPath,
    artMeshCount: artMeshes.length,
    parameterEntryCount: collectEntries(parameters).length,
    structureEntryCount: collectEntries(deformers).length,
  }, null, 2));
} finally {
  client.close();
}
