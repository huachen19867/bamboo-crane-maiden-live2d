import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const MODEL_KEYFORMS = [
  { value: 0, multiplyColor: "#FFFFFF" },
  { value: 0.5, multiplyColor: "#D8879D" },
  { value: 1, multiplyColor: "#8C2948" },
];

const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID } = await client.request("GetCurrentModelUID");
  const before = await client.request("GetParameterKeys", { ModelUID, ObjectId: "mouth" });
  const openKeys = new Set(
    before.Parameters?.find((entry) => entry.Id === "ParamMouthOpenY")?.KeyValues ?? [],
  );

  await client.withEdit(async () => {
    for (const keyform of MODEL_KEYFORMS) {
      if (!openKeys.has(keyform.value)) {
        await client.request("AddParameterKey", {
          ModelUID,
          ObjectId: "mouth",
          ParameterId: "ParamMouthOpenY",
          KeyValue: keyform.value,
        });
      }
      await client.request("EditArtMesh", {
        ModelUID,
        Id: "mouth",
        Parameters: [{ Id: "ParamMouthOpenY", Value: keyform.value }],
        IsExactMatch: true,
        MultiplyColor: keyform.multiplyColor,
      });
    }
  });

  console.log(JSON.stringify({
    modelUid: ModelUID,
    objectId: "mouth",
    parameterId: "ParamMouthOpenY",
    keyforms: MODEL_KEYFORMS,
  }, null, 2));
} finally {
  client.close();
}
