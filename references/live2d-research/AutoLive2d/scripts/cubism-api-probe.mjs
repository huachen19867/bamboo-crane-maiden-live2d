import { fileURLToPath } from "node:url";
import {
  CUBISM_API_VERSION,
  CubismExternalClient,
} from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const runEditSmoke = process.argv.includes("--edit-smoke");

function collectEntries(value, entries = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectEntries(item, entries);
    return entries;
  }
  if (!value || typeof value !== "object") return entries;
  if (typeof value.Id === "string") {
    entries.push({
      id: value.Id,
      name: typeof value.Name === "string" ? value.Name : undefined,
      type: typeof value.Type === "string" ? value.Type : undefined,
    });
  }
  for (const child of Object.values(value)) collectEntries(child, entries);
  return entries;
}

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  console.log(`Connected to ${client.url}`);
  console.log("Plugin registered; token is stored locally and not printed.");
  await client.authorize();

  const currentModel = await client.request("GetCurrentModelUID");
  const modelUid = currentModel.ModelUID;
  if (!modelUid) throw new Error("Cubism did not return a current ModelUID");

  if (runEditSmoke) {
    await client.withEdit(async (editClient) => {
      await editClient.request("EditSendLog", { Message: "Auto Live2D Studio API write smoke test" });
    }, { cancel: true });
    console.log("Edit transaction smoke test passed and was rolled back.");
  }

  const [parameters, parts, deformers] = await Promise.all([
    client.request("GetParameterStructure", { ModelUID: modelUid }),
    client.request("GetPartStructure", { ModelUID: modelUid }),
    client.request("GetDeformerStructure", { ModelUID: modelUid }),
  ]);
  const parameterEntries = collectEntries(parameters);
  const partEntries = collectEntries(parts);
  const deformerEntries = collectEntries(deformers);

  console.log(JSON.stringify({
    connected: true,
    apiVersion: CUBISM_API_VERSION,
    modelUid,
    parameterEntries: parameterEntries.length,
    partEntries: partEntries.length,
    deformerEntries: deformerEntries.length,
    parameters: parameterEntries.slice(0, 100),
    parts: partEntries.slice(0, 100),
    deformers: deformerEntries.slice(0, 100),
    parameterResponseKeys: Object.keys(parameters),
    partResponseKeys: Object.keys(parts),
    deformerResponseKeys: Object.keys(deformers),
  }, null, 2));
} finally {
  client.close();
}
