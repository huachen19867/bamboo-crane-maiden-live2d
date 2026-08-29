import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));

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

const requestedNames = (process.env.CUBISM_SELECT_NAMES ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const requestedIds = (process.env.CUBISM_SELECT_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const selectAll = process.argv.includes("--all");

if (!selectAll && requestedNames.length === 0 && requestedIds.length === 0) {
  throw new Error("Set CUBISM_SELECT_NAMES/CUBISM_SELECT_IDS or pass --all");
}

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID: modelUid } = await client.request("GetCurrentModelUID");
  const [parts, deformers] = await Promise.all([
    client.request("GetPartStructure", { ModelUID: modelUid }),
    client.request("GetDeformerStructure", { ModelUID: modelUid }),
  ]);
  const objectsById = new Map(
    [...collectEntries(parts), ...collectEntries(deformers)]
      .filter((entry) => entry.Id !== "%Root")
      .map((entry) => [entry.Id, entry]),
  );
  const objects = [...objectsById.values()];
  const selectedIds = selectAll
    ? objects.filter((entry) => entry.Type === "ArtMesh").map((entry) => entry.Id)
    : objects
      .filter((entry) => requestedIds.includes(entry.Id) || requestedNames.includes(entry.Name))
      .map((entry) => entry.Id);

  if (selectedIds.length === 0) throw new Error("No Cubism object matched the requested selection");
  await client.withEdit(async () => {
    await client.request("AddSelectedObjects", {
      ModelUID: modelUid,
      Ids: selectedIds,
    });
  });
  const selected = await client.request("GetSelectedObjects", { ModelUID: modelUid });
  console.log(JSON.stringify({ selectedIds, selected }, null, 2));
} finally {
  client.close();
}
