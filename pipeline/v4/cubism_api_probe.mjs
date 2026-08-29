// Cubism 5.4 alpha1 external API probe: read full model structure for import acceptance.
// Usage: node cubism_api_probe.mjs <output.json>
import { writeFileSync } from "node:fs";

const API_VERSION = "1.1.0";
const URL = process.env.CUBISM_API_URL ?? "ws://127.0.0.1:22033";
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
    this.socket = new WebSocket(URL);
    this.socket.addEventListener("message", (ev) => this.#onMessage(ev));
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`connect timeout ${URL}`)), timeoutMs);
      this.socket.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(t); reject(new Error(`cannot connect ${URL}`)); }, { once: true });
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
const client = new Client();
const report = { generatedAt: new Date().toISOString(), url: URL, steps: [] };

try {
  await client.connect();
  const reg = await client.request("RegisterPlugin", { Name: PLUGIN_NAME, Token: "" }, 30000);
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
