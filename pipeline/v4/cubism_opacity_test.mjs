// Temporarily set an ArtMesh base opacity for visual hole-test, then restore.
// Usage: node cubism_opacity_test.mjs <ArtMeshId> <0|100>
import { writeFileSync } from "node:fs";

const API_VERSION = "1.1.0";
const URL = "ws://127.0.0.1:22033";
const PLUGIN_NAME = "Auto Live2D Studio Agent Bridge";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class Client {
  constructor() { this.socket = null; this.pending = new Map(); this.seq = 0; }
  async connect() {
    this.socket = new WebSocket(URL);
    this.socket.addEventListener("message", (ev) => this.#on(ev));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("connect timeout")), 8000);
      this.socket.addEventListener("open", () => { clearTimeout(t); res(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(t); rej(new Error("connect fail")); }, { once: true });
    });
  }
  #on(ev) {
    let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
    const e = this.pending.get(m.RequestId);
    if (!e) return;
    this.pending.delete(m.RequestId); clearTimeout(e.t);
    if (m.Type === "Error") e.rej(new Error(`${m.Method}: ${m.Data?.ErrorType}`));
    else e.res(m.Data ?? {});
  }
  request(method, data = {}, timeoutMs = 15000) {
    const id = `t${this.seq++}`;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { res, rej, t });
      this.socket.send(JSON.stringify({ Version: API_VERSION, Timestamp: Date.now(), RequestId: id, Type: "Request", Method: method, Data: data }));
    });
  }
}

const meshId = process.argv[2];
const opacity = Number(process.argv[3] ?? 0);
const c = new Client();
try {
  await c.connect();
  const reg = await c.request("RegisterPlugin", { Name: PLUGIN_NAME, Token: "" });
  console.log("registered");
  try { console.log("setver:", JSON.stringify(await c.request("SetGlobalVersion", { Version: "1.1.0" }))); } catch (e) { console.log("setver failed:", e.message); }
  let ok = false;
  for (let i = 0; i < 30; i++) {
    try {
      const a = (await c.request("GetIsApproval")).Result === true;
      const b = (await c.request("GetIsEditApproval")).Result === true;
      if (a && b) { ok = true; break; }
      if (i % 5 === 0) console.log(`approval wait ${i}: a=${a} b=${b}`);
    } catch (e) { if (i % 5 === 0) console.log(`approval err ${i}: ${e.message}`); }
    await sleep(1000);
  }
  if (!ok) throw new Error("approval not granted");
  const modelUid = (await c.request("GetCurrentModelUID")).ModelUID;
  await c.request("EditBegin", { Silent: false });
  const r = await c.request("EditArtMesh", { ModelUID: modelUid, Id: meshId, Opacity: opacity });
  await c.request("EditEnd", { Cancel: false });
  console.log(`set ${meshId} opacity=${opacity}:`, JSON.stringify(r));
} catch (e) {
  console.error("FATAL", String(e.message ?? e));
  try { await c.request("EditEnd", { Cancel: true }); } catch {}
  process.exitCode = 1;
} finally {
  c.socket?.close();
}
