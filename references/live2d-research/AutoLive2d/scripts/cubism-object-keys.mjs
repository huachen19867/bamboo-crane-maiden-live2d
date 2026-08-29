import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const objectIds = (process.env.CUBISM_OBJECT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!objectIds.length) {
  throw new Error("Set CUBISM_OBJECT_IDS to one or more comma-separated object IDs.");
}

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID } = await client.request("GetCurrentModelUID");
  const objects = {};
  for (const ObjectId of objectIds) {
    objects[ObjectId] = await client.request("GetParameterKeys", { ModelUID, ObjectId });
  }
  console.log(JSON.stringify({ modelUid: ModelUID, objects }, null, 2));
} finally {
  client.close();
}
