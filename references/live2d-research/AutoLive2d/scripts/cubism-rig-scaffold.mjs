import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CubismExternalClient } from "./lib/cubism-external-client.mjs";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-external-token.local", import.meta.url));
const DEFAULT_REPORT_PATH = fileURLToPath(new URL(
  "../outputs/cubism-3114c6f061ac/rig-scaffold-report.json",
  import.meta.url,
));

const dryRun = process.argv.includes("--dry-run");
const reportPath = process.env.CUBISM_SCAFFOLD_REPORT_PATH ?? DEFAULT_REPORT_PATH;

const ART_MESH = {
  frontHair: "ArtMesh",
  headwear: "headwear",
  leftLash: "ArtMesh0",
  leftBrow: "ArtMesh1",
  leftIris: "ArtMesh2",
  rightLash: "ArtMesh3",
  rightIris: "ArtMesh4",
  leftWhite: "ArtMesh5",
  rightWhite: "ArtMesh6",
  mouth: "mouth",
  nose: "nose",
  face: "face",
  rightBrow: "ArtMesh7",
  leftEar: "ArtMesh8",
  rightEar: "ArtMesh9",
  topwear: "topwear",
  neck: "neck",
  leftHandwear: "ArtMesh10",
  rightHandwear: "ArtMesh11",
  backHair: "ArtMesh12",
};

const PARTS = [
  { Id: "PartBackHair", Name: "Back Hair", Ids: [ART_MESH.backHair] },
  {
    Id: "PartBody",
    Name: "Body",
    Ids: [ART_MESH.topwear, ART_MESH.neck, ART_MESH.leftHandwear, ART_MESH.rightHandwear],
  },
  {
    Id: "PartHeadBase",
    Name: "Head Base",
    Ids: [ART_MESH.face, ART_MESH.nose, ART_MESH.leftEar, ART_MESH.rightEar],
  },
  {
    Id: "PartEyes",
    Name: "Eyes",
    Ids: [
      ART_MESH.leftLash,
      ART_MESH.leftWhite,
      ART_MESH.leftIris,
      ART_MESH.rightLash,
      ART_MESH.rightWhite,
      ART_MESH.rightIris,
    ],
  },
  { Id: "PartBrows", Name: "Brows", Ids: [ART_MESH.leftBrow, ART_MESH.rightBrow] },
  { Id: "PartMouth", Name: "Mouth", Ids: [ART_MESH.mouth] },
  {
    Id: "PartFrontHair",
    Name: "Front Hair",
    Ids: [ART_MESH.frontHair, ART_MESH.headwear],
  },
  {
    Id: "PartHead",
    Name: "Head",
    Ids: ["PartHeadBase", "PartEyes", "PartBrows", "PartMouth", "PartFrontHair"],
  },
  {
    Id: "PartLive2DModel",
    Name: "Live2D Model",
    Ids: ["PartBackHair", "PartBody", "PartHead"],
  },
];

const DRAW_ORDERS = new Map([
  [ART_MESH.backHair, 100],
  [ART_MESH.leftHandwear, 200],
  [ART_MESH.rightHandwear, 201],
  [ART_MESH.neck, 220],
  [ART_MESH.topwear, 240],
  [ART_MESH.leftEar, 400],
  [ART_MESH.rightEar, 401],
  [ART_MESH.face, 500],
  [ART_MESH.nose, 540],
  [ART_MESH.mouth, 550],
  [ART_MESH.leftWhite, 560],
  [ART_MESH.rightWhite, 561],
  [ART_MESH.leftIris, 570],
  [ART_MESH.rightIris, 571],
  [ART_MESH.leftLash, 580],
  [ART_MESH.rightLash, 581],
  [ART_MESH.leftBrow, 590],
  [ART_MESH.rightBrow, 591],
  [ART_MESH.frontHair, 650],
  [ART_MESH.headwear, 660],
]);

const allArtMeshes = Object.values(ART_MESH);
const headArtMeshes = allArtMeshes.filter((id) => ![
  ART_MESH.topwear,
  ART_MESH.neck,
  ART_MESH.leftHandwear,
  ART_MESH.rightHandwear,
].includes(id));

const DEFORMERS = [
  {
    method: "AddWarpDeformer",
    Id: "D_BodyXY",
    Name: "Body XY",
    ParentId: "PartLive2DModel",
    TargetObjectIds: allArtMeshes,
    WarpDivH: 3,
    WarpDivV: 4,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddRotationDeformer",
    Id: "D_BodyZ",
    Name: "Body Z",
    ParentId: "PartLive2DModel",
    TargetObjectIds: ["D_BodyXY"],
  },
  {
    method: "AddWarpDeformer",
    Id: "D_Breath",
    Name: "Breath",
    ParentId: "PartBody",
    TargetObjectIds: [ART_MESH.topwear, ART_MESH.neck],
    WarpDivH: 2,
    WarpDivV: 3,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_HeadXY",
    Name: "Head XY",
    ParentId: "PartHead",
    TargetObjectIds: headArtMeshes,
    WarpDivH: 4,
    WarpDivV: 5,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddRotationDeformer",
    Id: "D_HeadZ",
    Name: "Head Z",
    ParentId: "PartHead",
    TargetObjectIds: ["D_HeadXY"],
  },
  {
    method: "AddWarpDeformer",
    Id: "D_EyeBallL",
    Name: "Eye Ball L",
    ParentId: "PartEyes",
    TargetObjectIds: [ART_MESH.leftIris],
    WarpDivH: 2,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_EyeBlinkL",
    Name: "Eye Blink L",
    ParentId: "PartEyes",
    TargetObjectIds: [ART_MESH.leftLash, ART_MESH.leftWhite, "D_EyeBallL"],
    WarpDivH: 3,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_EyeBallR",
    Name: "Eye Ball R",
    ParentId: "PartEyes",
    TargetObjectIds: [ART_MESH.rightIris],
    WarpDivH: 2,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_EyeBlinkR",
    Name: "Eye Blink R",
    ParentId: "PartEyes",
    TargetObjectIds: [ART_MESH.rightLash, ART_MESH.rightWhite, "D_EyeBallR"],
    WarpDivH: 3,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_BrowL",
    Name: "Brow L",
    ParentId: "PartBrows",
    TargetObjectIds: [ART_MESH.leftBrow],
    WarpDivH: 3,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_BrowR",
    Name: "Brow R",
    ParentId: "PartBrows",
    TargetObjectIds: [ART_MESH.rightBrow],
    WarpDivH: 3,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_Mouth",
    Name: "Mouth",
    ParentId: "PartMouth",
    TargetObjectIds: [ART_MESH.mouth],
    WarpDivH: 3,
    WarpDivV: 2,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_HairFront",
    Name: "Hair Front",
    ParentId: "PartFrontHair",
    TargetObjectIds: [ART_MESH.frontHair],
    WarpDivH: 4,
    WarpDivV: 5,
    BezierDivH: 2,
    BezierDivV: 2,
  },
  {
    method: "AddWarpDeformer",
    Id: "D_HairBack",
    Name: "Hair Back",
    ParentId: "PartBackHair",
    TargetObjectIds: [ART_MESH.backHair],
    WarpDivH: 4,
    WarpDivV: 5,
    BezierDivH: 2,
    BezierDivV: 2,
  },
];

const PARAMETER_KEYS = [
  { objectId: "D_BodyXY", parameterId: "ParamBodyAngleX", values: [-10, 0, 10] },
  { objectId: "D_BodyXY", parameterId: "ParamBodyAngleY", values: [-10, 0, 10] },
  { objectId: "D_BodyZ", parameterId: "ParamBodyAngleZ", values: [-10, 0, 10] },
  { objectId: "D_Breath", parameterId: "ParamBreath", values: [0, 1] },
  { objectId: "D_HeadXY", parameterId: "ParamAngleX", values: [-30, 0, 30] },
  { objectId: "D_HeadXY", parameterId: "ParamAngleY", values: [-30, 0, 30] },
  { objectId: "D_HeadZ", parameterId: "ParamAngleZ", values: [-30, 0, 30] },
  { objectId: "D_EyeBallL", parameterId: "ParamEyeBallX", values: [-1, 0, 1] },
  { objectId: "D_EyeBallL", parameterId: "ParamEyeBallY", values: [-1, 0, 1] },
  { objectId: "D_EyeBlinkL", parameterId: "ParamEyeLOpen", values: [0, 1] },
  { objectId: "D_EyeBallR", parameterId: "ParamEyeBallX", values: [-1, 0, 1] },
  { objectId: "D_EyeBallR", parameterId: "ParamEyeBallY", values: [-1, 0, 1] },
  { objectId: "D_EyeBlinkR", parameterId: "ParamEyeROpen", values: [0, 1] },
  { objectId: "D_BrowL", parameterId: "ParamBrowLY", values: [-1, 0, 1] },
  { objectId: "D_BrowR", parameterId: "ParamBrowRY", values: [-1, 0, 1] },
  { objectId: "D_Mouth", parameterId: "ParamMouthForm", values: [-1, 0, 1] },
  { objectId: "D_Mouth", parameterId: "ParamMouthOpenY", values: [0, 0.5, 1] },
  { objectId: "D_HairFront", parameterId: "ParamHairFront", values: [-1, 0, 1] },
  { objectId: "D_HairBack", parameterId: "ParamHairBack", values: [-1, 0, 1] },
];

const ROTATION_KEYFORMS = [
  { objectId: "D_BodyZ", parameterId: "ParamBodyAngleZ", values: [[-10, -4], [0, 0], [10, 4]] },
  { objectId: "D_HeadZ", parameterId: "ParamAngleZ", values: [[-30, -15], [0, 0], [30, 15]] },
];

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

function assertExpectedIds(structure, expectedIds, label) {
  const ids = new Set(collectEntries(structure).map((entry) => entry.Id));
  const missing = expectedIds.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`${label} is missing: ${missing.join(", ")}`);
}

async function addScaffold(client, modelUid) {
  for (const part of PARTS) {
    await client.request("AddPart", {
      ModelUID: modelUid,
      ...part,
      IsNested: true,
    }, 30_000);
    console.log(`Added part: ${part.Id}`);
  }

  for (const { method, ...deformer } of DEFORMERS) {
    await client.request(method, {
      ModelUID: modelUid,
      ...deformer,
      Mode: "AsParent",
      ...(method === "AddWarpDeformer" ? {
        ConsiderChildKeyforms: true,
        SnapCenter: true,
      } : {}),
    }, 30_000);
    console.log(`Added deformer: ${deformer.Id}`);
  }

  for (const keySet of PARAMETER_KEYS) {
    for (const keyValue of keySet.values) {
      await client.request("AddParameterKey", {
        ModelUID: modelUid,
        ObjectId: keySet.objectId,
        ParameterId: keySet.parameterId,
        KeyValue: keyValue,
      }, 30_000);
    }
    console.log(`Added keys: ${keySet.objectId} / ${keySet.parameterId}`);
  }

  for (const keyform of ROTATION_KEYFORMS) {
    for (const [parameterValue, angle] of keyform.values) {
      await client.request("EditRotationDeformer", {
        ModelUID: modelUid,
        Id: keyform.objectId,
        Parameters: [{ Id: keyform.parameterId, Value: parameterValue }],
        IsExactMatch: true,
        Angle: angle,
      }, 30_000);
    }
    console.log(`Edited rotation keyforms: ${keyform.objectId}`);
  }

  await setDrawOrders(client, modelUid, [...DRAW_ORDERS.keys()]);
}

async function getDrawOrderMismatches(client, modelUid) {
  const mismatches = [];
  for (const [id, expected] of DRAW_ORDERS) {
    const object = await client.request("GetObject", { ModelUID: modelUid, Id: id });
    const actual = object.Data?.DrawOrder;
    if (actual !== expected) mismatches.push({ id, actual, expected });
  }
  return mismatches;
}

async function setDrawOrders(client, modelUid, ids) {
  for (const id of ids) {
    await client.request("EditArtMesh", {
      ModelUID: modelUid,
      Id: id,
      DrawOrder: DRAW_ORDERS.get(id),
    }, 30_000);
    console.log(`Set draw order: ${id} = ${DRAW_ORDERS.get(id)}`);
  }
}

async function inspectScaffold(client, modelUid) {
  const [parts, deformers] = await Promise.all([
    client.request("GetPartStructure", { ModelUID: modelUid }),
    client.request("GetDeformerStructure", { ModelUID: modelUid }),
  ]);
  assertExpectedIds(parts, PARTS.map((part) => part.Id), "Part structure");
  assertExpectedIds(deformers, DEFORMERS.map((deformer) => deformer.Id), "Deformer structure");

  const parameterKeys = {};
  for (const deformer of DEFORMERS) {
    parameterKeys[deformer.Id] = await client.request("GetParameterKeys", {
      ModelUID: modelUid,
      ObjectId: deformer.Id,
    });
  }
  return { parts, deformers, parameterKeys };
}

const expectedIds = [
  ...PARTS.map((part) => part.Id),
  ...DEFORMERS.map((deformer) => deformer.Id),
];
const client = new CubismExternalClient({ tokenPath: TOKEN_PATH });

try {
  await client.connect();
  await client.authorize();
  const { ModelUID: modelUid } = await client.request("GetCurrentModelUID");
  if (!modelUid) throw new Error("Cubism did not return a current ModelUID");

  const [initialParts, initialDeformers] = await Promise.all([
    client.request("GetPartStructure", { ModelUID: modelUid }),
    client.request("GetDeformerStructure", { ModelUID: modelUid }),
  ]);
  const existingIds = new Set([
    ...collectEntries(initialParts).map((entry) => entry.Id),
    ...collectEntries(initialDeformers).map((entry) => entry.Id),
  ]);
  const presentScaffoldIds = expectedIds.filter((id) => existingIds.has(id));

  if (presentScaffoldIds.length > 0 && presentScaffoldIds.length !== expectedIds.length) {
    const missingIds = expectedIds.filter((id) => !existingIds.has(id));
    throw new Error(
      `Partial scaffold detected. Present: ${presentScaffoldIds.join(", ")}; missing: ${missingIds.join(", ")}`,
    );
  }

  let result;
  let status;
  if (presentScaffoldIds.length === expectedIds.length) {
    const drawOrderMismatches = await getDrawOrderMismatches(client, modelUid);
    if (drawOrderMismatches.length) {
      await client.withEdit(async () => {
        await setDrawOrders(client, modelUid, drawOrderMismatches.map(({ id }) => id));
      }, { cancel: dryRun });
      status = dryRun ? "draw-order-dry-run-rolled-back" : "draw-orders-updated";
    } else {
      status = "already-present";
    }
    result = await inspectScaffold(client, modelUid);
  } else {
    await client.withEdit(async () => {
      await addScaffold(client, modelUid);
      result = await inspectScaffold(client, modelUid);
    }, { cancel: dryRun });
    status = dryRun ? "dry-run-rolled-back" : "created";
  }

  const report = {
    generatedAt: new Date().toISOString(),
    modelUid,
    status,
    partIds: PARTS.map((part) => part.Id),
    deformerIds: DEFORMERS.map((deformer) => deformer.Id),
    drawOrders: Object.fromEntries(DRAW_ORDERS),
    parameterKeys: result.parameterKeys,
  };
  if (!dryRun) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({
    status,
    modelUid,
    partCount: report.partIds.length,
    deformerCount: report.deformerIds.length,
    reportPath: dryRun ? null : reportPath,
  }, null, 2));
} finally {
  client.close();
}
