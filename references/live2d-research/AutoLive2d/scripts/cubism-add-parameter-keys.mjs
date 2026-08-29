import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const objectId = process.env.CUBISM_OBJECT_ID?.trim();
const parameterId = process.env.CUBISM_PARAMETER_ID?.trim();
const keyValues = (process.env.CUBISM_KEY_VALUES ?? "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);

if (!objectId || !parameterId || !keyValues.length) {
  throw new Error(
    "Set CUBISM_OBJECT_ID, CUBISM_PARAMETER_ID, and comma-separated CUBISM_KEY_VALUES.",
  );
}

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID } = await client.request("GetCurrentModelUID");
  const before = await client.request("GetParameterKeys", { ModelUID, ObjectId: objectId });
  const parameter = before.Parameters?.find((entry) => entry.Id === parameterId);
  const existing = new Set(parameter?.KeyValues ?? []);
  const missing = keyValues.filter((value) => !existing.has(value));

  if (missing.length) {
    await client.withEdit(async () => {
      for (const KeyValue of missing) {
        await client.request("AddParameterKey", {
          ModelUID,
          ObjectId: objectId,
          ParameterId: parameterId,
          KeyValue,
        });
      }
    });
  }

  const after = await client.request("GetParameterKeys", { ModelUID, ObjectId: objectId });
  console.log(JSON.stringify({
    modelUid: ModelUID,
    objectId,
    parameterId,
    added: missing,
    keys: after,
  }, null, 2));
} finally {
  client.close();
}
