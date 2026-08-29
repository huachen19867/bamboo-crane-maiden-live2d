// Cubism 5.4 alpha1 external API probe: read full model structure for import acceptance.
// Usage: node cubism_api_probe.mjs <output.json> [--set-opacity "Id=0;Id2=0"] [--keys Id1,Id2]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API_VERSION = "1.1.0";
const API_URL = process.env.CUBISM_API_URL ?? "ws://127.0.0.1:22033";
const PLUGIN_NAME = "Auto Live2D Studio Agent Bridge";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Client {
  constructor() {
    this.socket = null;
    this.pending = new Map();
  }

  async connect(timeoutMs = 10000) {
    this.socket = new WebSocket(API_URL);
    this.socket.addEventListener("message", (ev) => this.#onMessage(ev));
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`connect timeout ${API_URL}`)), timeoutMs);
      this.socket.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(t); reject(new Error(`cannot connect ${API_URL}`)); }, { once: true });
    });
  }

  #onMessage(ev) {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.Type !== "Response" && msg.Type !== "Error") return;
    const entry = this.pending.get(msg.RequestId);
    if (!entry) return;
    this.pending.delete(msg.RequestId);
    clearTimeout(entry.timer);
    if (msg.Type === "Error") entry.reject(new Error(`${msg.Method}: ${msg.Data?.ErrorType ?? "Unknown"}`));
    else entry.resolve(msg.Data ?? {});
  }

  request(method, data = {}, timeoutMs = 20000) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      Version: API_VERSION,
      Timestamp: Date.now(),
      RequestId: id,
      Type: "Request",
      Method: method,
      Data: data,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(payload));
    });
  }
}

function collectArtMeshes(partStructure) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.Type === "ArtMesh") out.push({ id: node.Id, name: node.Name });
    for (const child of node.Children ?? []) walk(child);
  };
  walk(partStructure);
  return out;
}

const outPath = process.argv[2] ?? "exports/cubism-api-probe.json";

const TOKEN_PATH = fileURLToPath(new URL("../.cubism-api-token.local", import.meta.url));

function readToken() {
  try {
    return existsSync(TOKEN_PATH) ? readFileSync(TOKEN_PATH, "utf8").trim() : "";
  } catch {
    return "";
  }
}

function saveToken(token) {
  try {
    if (token) writeFileSync(TOKEN_PATH, token, "utf8");
  } catch {}
}

const client = new Client();
const report = { generatedAt: new Date().toISOString(), url: API_URL, steps: [] };

try {
  await client.connect();
  const reg = await client.request("RegisterPlugin", { Name: PLUGIN_NAME, Token: readToken() }, 30000);
  saveToken(reg.Token);
  report.steps.push({ step: "RegisterPlugin", token: reg.Token ? "(received)" : "(none)" });

  let approval = false;
  let editApproval = false;
  for (let i = 0; i < 150; i++) {
    try { approval = (await client.request("GetIsApproval", {}, 5000)).Result === true; } catch { approval = false; }
    try { editApproval = (await client.request("GetIsEditApproval", {}, 5000)).Result === true; } catch { editApproval = false; }
    if (approval && editApproval) break;
    await sleep(1000);
  }
  report.steps.push({ step: "approval", approval, editApproval });
  if (!approval) throw new Error("Normal permission not granted");

  const modelUid = (await client.request("GetCurrentModelUID")).ModelUID;
  report.modelUid = modelUid;

  const editMode = await client.request("GetCurrentEditMode");
  report.editMode = editMode;

  const paramStructure = await client.request("GetParameterStructure", { ModelUID: modelUid });
  report.parameters = paramStructure;

  const partStructure = await client.request("GetPartStructure", { ModelUID: modelUid });
  report.parts = partStructure;

  const deformerStructure = await client.request("GetDeformerStructure", { ModelUID: modelUid });
  report.deformers = deformerStructure;

  const meshes = collectArtMeshes(partStructure.PartStructure ?? partStructure);
  report.artMeshCount = meshes.length;

  // Optional edit mode: node cubism_api_probe.mjs out.json --set-opacity "Id=0;Id2=0"
  const setOpacityArg = process.argv.findIndex((a) => a === "--set-opacity");
  if (setOpacityArg > 0) {
    const edits = String(process.argv[setOpacityArg + 1])
      .split(";")
      .map((pair) => {
        const [objectId, value] = pair.split("=");
        return { objectId, opacity: Number(value) };
      });
    await client.request("EditBegin", { Silent: false }, 30000);
    const editResults = [];
    for (const edit of edits) {
      const r = await client.request(
        "EditArtMesh",
        { ModelUID: modelUid, Id: edit.objectId, Opacity: edit.opacity },
        30000,
      );
      editResults.push({ ...edit, result: r });
    }
    await client.request("EditEnd", { Cancel: false }, 30000);
    report.opacityEdit = editResults;
  }

  // Optional keyform slot creation: --add-keys "Id@Param=0;Id2@Param=0.5"
  const addKeysArg = process.argv.findIndex((a) => a === "--add-keys");
  if (addKeysArg > 0) {
    const edits = String(process.argv[addKeysArg + 1])
      .split(";")
      .map((pair) => {
        const [meshPart, paramPart] = pair.split("@");
        const [objectId] = meshPart.split("=");
        const [paramId, paramValue] = paramPart.split("=");
        return { objectId, parameterId: paramId, keyValue: Number(paramValue) };
      });
    await client.request("EditBegin", { Silent: false }, 60000);
    const results = [];
    for (const edit of edits) {
      try {
        const r = await client.request(
          "AddParameterKey",
          {
            ModelUID: modelUid,
            ObjectId: edit.objectId,
            ParameterId: edit.parameterId,
            KeyValue: edit.keyValue,
          },
          60000,
        );
        results.push({ ...edit, result: r });
      } catch (e) {
        results.push({ ...edit, error: String(e.message) });
      }
    }
    await client.request("EditEnd", { Cancel: false }, 60000);
    report.addParameterKeys = results;
  }

  // Optional keyform opacity mode: --set-keyed-opacity "Id=0@ParamEyeLOpen=0;Id=100@ParamEyeLOpen=0.5"
  const keyedArg = process.argv.findIndex((a) => a === "--set-keyed-opacity");
  if (keyedArg > 0) {
    const edits = String(process.argv[keyedArg + 1])
      .split(";")
      .map((pair) => {
        const [meshPart, paramPart] = pair.split("@");
        const [objectId, opacity] = meshPart.split("=");
        const [paramId, paramValue] = paramPart.split("=");
        return {
          objectId,
          opacity: Number(opacity),
          parameterId: paramId,
          parameterValue: Number(paramValue),
        };
      });
    await client.request("EditBegin", { Silent: false }, 60000);
    const editResults = [];
    for (const edit of edits) {
      try {
        const r = await client.request(
          "EditArtMesh",
          {
            ModelUID: modelUid,
            Id: edit.objectId,
            Parameters: [{ Id: edit.parameterId, Value: edit.parameterValue }],
            IsExactMatch: true,
            Opacity: edit.opacity,
          },
          60000,
        );
        editResults.push({ ...edit, result: r });
      } catch (e) {
        editResults.push({ ...edit, error: String(e.message) });
      }
    }
    await client.request("EditEnd", { Cancel: false }, 60000);
    report.keyedOpacityEdit = editResults;
  }

  // Optional key deletion: --delete-keys "Id@Param;Id2@Param"
  const delKeysArg = process.argv.findIndex((a) => a === "--delete-keys");
  if (delKeysArg > 0) {
    const targets = String(process.argv[delKeysArg + 1])
      .split(";")
      .map((pair) => {
        const parts = pair.split("@");
        const objectId = parts[0];
        const parameterId = parts[1];
        const keyValue = parts.length > 2 ? Number(parts[2]) : undefined;
        return { objectId, parameterId, keyValue };
      });
    await client.request("EditBegin", { Silent: false }, 60000);
    const results = [];
    for (const t of targets) {
      try {
        const data = { ModelUID: modelUid, ObjectId: t.objectId, ParameterId: t.parameterId, Strict: true };
        if (t.keyValue !== undefined) data.KeyValue = t.keyValue;
        const r = await client.request("DeleteParameterKey", data, 60000);
        results.push({ ...t, result: r });
      } catch (e) {
        results.push({ ...t, error: String(e.message) });
      }
    }
    await client.request("EditEnd", { Cancel: false }, 60000);
    report.deleteParameterKeys = results;
  }

  // Optional driven-state opacity writes:
  // --driven-opacity "ParamEyeLOpen@0:Id=0,Id2=0;ParamEyeLOpen@0.5:Id=100;ParamEyeLOpen@1:Id=100"
  // EditArtMesh writes the state at the CURRENT parameter values, so drive the
  // parameter with SetParameterValues first, then write each layer's opacity.
  const drivenArg = process.argv.findIndex((a) => a === "--driven-opacity");
  if (drivenArg > 0) {
    const groups = String(process.argv[drivenArg + 1])
      .split(";")
      .map((group) => {
        const [head, layersPart] = group.split(":");
        const [paramId, valuePart] = head.split("@");
        const layers = layersPart.split(",").map((pair) => {
          const [objectId, opacity] = pair.split("=");
          return { objectId, opacity: Number(opacity) };
        });
        return { parameterId: paramId, parameterValue: Number(valuePart), layers };
      });
    await client.request("EditBegin", { Silent: false }, 120000);
    const results = [];
    for (const group of groups) {
      try {
        await client.request(
          "SetParameterValues",
          { ModelUID: modelUid, Parameters: [{ Id: group.parameterId, Value: group.parameterValue }] },
          30000,
        );
        for (const layer of group.layers) {
          try {
            const r = await client.request(
              "EditArtMesh",
              { ModelUID: modelUid, Id: layer.objectId, Opacity: layer.opacity },
              30000,
            );
            results.push({ ...group, ...layer, result: r.Result === true });
          } catch (e) {
            results.push({ ...group, ...layer, error: String(e.message) });
          }
        }
      } catch (e) {
        results.push({ parameterId: group.parameterId, error: String(e.message) });
      }
    }
    await client.request("ClearParameterValues", { ModelUID: modelUid }, 30000);
    await client.request("EditEnd", { Cancel: false }, 120000);
    report.drivenOpacity = results;
  }

  // Optional keyed object read: --object-at "Id@Param=0;Id2@Param=0.5"
  const objectAtArg = process.argv.findIndex((a) => a === "--object-at");
  if (objectAtArg > 0) {
    const queries = String(process.argv[objectAtArg + 1])
      .split(";")
      .map((pair) => {
        const [objectId, paramPart] = pair.split("@");
        const [paramId, paramValue] = paramPart.split("=");
        return { objectId, parameterId: paramId, parameterValue: Number(paramValue) };
      });
    const objectAt = [];
    for (const q of queries) {
      try {
        const r = await client.request(
          "GetObject",
          {
            ModelUID: modelUid,
            Id: q.objectId,
            Parameters: [{ Id: q.parameterId, Value: q.parameterValue }],
            IsExactMatch: true,
          },
          30000,
        );
        objectAt.push({ ...q, opacity: r?.Data?.Opacity, vertices: r?.Data?.Vertices });
      } catch (e) {
        objectAt.push({ ...q, error: String(e.message) });
      }
    }
    report.objectAt = objectAt;
  }

  // Optional keyform query mode: --keys ObjectId[,ObjectId...]
  const keysArg = process.argv.findIndex((a) => a === "--keys");
  if (keysArg > 0) {
    const ids = String(process.argv[keysArg + 1]).split(",");
    const keyReport = {};
    for (const objectId of ids) {
      try {
        keyReport[objectId] = await client.request("GetParameterKeys", { ModelUID: modelUid, ObjectId: objectId }, 30000);
      } catch (e) {
        keyReport[objectId] = { error: String(e.message) };
      }
    }
    report.parameterKeys = keyReport;
  }

  const objects = {};
  for (const m of meshes) {
    try {
      const obj = await client.request("GetObject", { ModelUID: modelUid, Id: m.id });
      objects[m.id] = obj;
    } catch (e) {
      objects[m.id] = { error: String(e.message) };
    }
  }
  report.objects = objects;

  const summary = meshes.map((m) => {
    const d = objects[m.id]?.Data ?? {};
    return {
      id: m.id,
      vertices: d.Vertices,
      rectangle: d.Rectangle,
      parentPart: d.ParentId,
      parentDeformer: d.ParentDeformerId,
      opacity: d.Opacity,
    };
  });
  report.summary = summary;
  report.verticesLessThanFive = summary.filter((s) => typeof s.vertices === "number" && s.vertices < 5).map((s) => s.id);

  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`OK wrote ${outPath}`);
  console.log(`artMeshCount=${report.artMeshCount}`);
  console.log(`lessThan5Vertices=${JSON.stringify(report.verticesLessThanFive)}`);
} catch (e) {
  report.fatal = String(e.message ?? e);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(`FATAL: ${report.fatal}`);
  console.log(`partial report written to ${outPath}`);
  process.exitCode = 1;
} finally {
  client.socket?.close();
}
