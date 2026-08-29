import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

async function call(method, data) {
  const response = await client.request(method, data, 30_000);
  console.log(`${method}: ${JSON.stringify(response)}`);
  return response;
}

try {
  await client.connect();
  await client.authorize();
  const { ModelUID: modelUid } = await client.request("GetCurrentModelUID");
  if (!modelUid) throw new Error("Cubism did not return a current ModelUID");

  await client.withEdit(async () => {
    await call("AddSelectedObjects", {
      ModelUID: modelUid,
      Ids: ["face"],
    });
    await call("GetSelectedObjects", { ModelUID: modelUid });
    await call("AddPart", {
      ModelUID: modelUid,
      Id: "__CodexTestPart",
      Name: "__CodexTestPart",
    });
    await call("AddWarpDeformer", {
      ModelUID: modelUid,
      Id: "__CodexTestWarp",
      Name: "__CodexTestWarp",
      ParentId: "__CodexTestPart",
      TargetObjectIds: ["face"],
      Mode: "AsParent",
      WarpDivH: 2,
      WarpDivV: 2,
      BezierDivH: 2,
      BezierDivV: 2,
      ConsiderChildKeyforms: true,
      SnapCenter: true,
    });
    for (const keyValue of [-30, 0, 30]) {
      await call("AddParameterKey", {
        ModelUID: modelUid,
        ObjectId: "__CodexTestWarp",
        ParameterId: "ParamAngleX",
        KeyValue: keyValue,
      });
    }
    await call("AddRotationDeformer", {
      ModelUID: modelUid,
      Id: "__CodexTestRot",
      Name: "__CodexTestRot",
      ParentId: "__CodexTestPart",
      TargetObjectIds: ["__CodexTestWarp"],
      Mode: "AsParent",
    });
    for (const keyValue of [-30, 0, 30]) {
      await call("AddParameterKey", {
        ModelUID: modelUid,
        ObjectId: "__CodexTestRot",
        ParameterId: "ParamAngleZ",
        KeyValue: keyValue,
      });
    }
    await call("EditRotationDeformer", {
      ModelUID: modelUid,
      Id: "__CodexTestRot",
      Parameters: [{ Id: "ParamAngleZ", Value: -30 }],
      IsExactMatch: true,
      Angle: -20,
    });
    await call("EditRotationDeformer", {
      ModelUID: modelUid,
      Id: "__CodexTestRot",
      Parameters: [{ Id: "ParamAngleZ", Value: 30 }],
      IsExactMatch: true,
      Angle: 20,
    });
    await call("GetObject", {
      ModelUID: modelUid,
      Id: "__CodexTestWarp",
      Parameters: [{ Id: "ParamAngleX", Value: 30 }],
    });
    await call("GetObject", {
      ModelUID: modelUid,
      Id: "__CodexTestRot",
      Parameters: [{ Id: "ParamAngleZ", Value: 30 }],
    });
  }, { cancel: true });

  console.log("Contract test passed; all temporary edits were rolled back.");
} finally {
  client.close();
}
