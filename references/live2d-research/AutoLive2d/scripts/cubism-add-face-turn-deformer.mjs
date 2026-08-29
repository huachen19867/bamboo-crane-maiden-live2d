import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const DEFORMER_ID = "D_FaceTurn";
const TARGET_OBJECT_IDS = [
  "face",
  "nose",
  "ArtMesh8",
  "ArtMesh9",
  "D_EyeBlinkR",
  "D_EyeBlinkL",
  "D_BrowR",
  "D_BrowL",
  "D_Mouth",
];
const PARAMETER_KEYS = [
  { parameterId: "ParamAngleX", values: [-30, 0, 30] },
  { parameterId: "ParamAngleY", values: [-30, 0, 30] },
];

function collectIds(value, ids = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return ids;
  }
  if (!value || typeof value !== "object") return ids;
  if (typeof value.Id === "string") ids.add(value.Id);
  for (const child of Object.values(value)) collectIds(child, ids);
  return ids;
}

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID } = await client.request("GetCurrentModelUID");
  if (!ModelUID) throw new Error("Cubism did not return a current ModelUID.");

  const structure = await client.request("GetDeformerStructure", { ModelUID });
  const existingIds = collectIds(structure);
  let created = false;
  const addedKeys = [];

  await client.withEdit(async () => {
    if (!existingIds.has(DEFORMER_ID)) {
      await client.request("AddWarpDeformer", {
        ModelUID,
        Id: DEFORMER_ID,
        Name: "Face Turn",
        ParentId: "PartHead",
        TargetObjectIds: TARGET_OBJECT_IDS,
        Mode: "AsParent",
        WarpDivH: 4,
        WarpDivV: 4,
        BezierDivH: 2,
        BezierDivV: 2,
        ConsiderChildKeyforms: true,
        SnapCenter: true,
      }, 30_000);
      created = true;
    }

    const before = await client.request("GetParameterKeys", {
      ModelUID,
      ObjectId: DEFORMER_ID,
    });
    const existingKeys = new Map(
      (before.Parameters ?? []).map((entry) => [entry.Id, new Set(entry.KeyValues ?? [])]),
    );

    for (const keySet of PARAMETER_KEYS) {
      const values = existingKeys.get(keySet.parameterId) ?? new Set();
      for (const keyValue of keySet.values) {
        if (values.has(keyValue)) continue;
        await client.request("AddParameterKey", {
          ModelUID,
          ObjectId: DEFORMER_ID,
          ParameterId: keySet.parameterId,
          KeyValue: keyValue,
        }, 30_000);
        addedKeys.push({ parameterId: keySet.parameterId, keyValue });
      }
    }
  });

  const object = await client.request("GetObject", { ModelUID, Id: DEFORMER_ID });
  console.log(JSON.stringify({
    modelUid: ModelUID,
    deformerId: DEFORMER_ID,
    created,
    addedKeys,
    targetObjectIds: TARGET_OBJECT_IDS,
    object,
  }, null, 2));
} finally {
  client.close();
}
