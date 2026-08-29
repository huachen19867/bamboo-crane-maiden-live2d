// Decide whether EditArtMesh (no Parameters) while a parameter is driven
// writes the keyform at the driven value or the base state.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API_VERSION = "1.1.0";
const API_URL = "ws://127.0.0.1:22033";
const PLUGIN_NAME = "Auto Live2D Studio Agent Bridge";
const TOKEN_PATH = fileURLToPath(new URL("../.cubism-api-token.local", import.meta.url));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readToken() {
  try { return existsSync(TOKEN_PATH) ? readFileSync(TOKEN_PATH, "utf8").trim() : ""; }
  catch { return ""; }
}

class Client {
  constructor() { this.socket = null; this.pending = new Map(); this.seq = 0; }
  async connect() {
    this.socket = new WebSocket(API_URL);
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
  request(method, data = {}, timeoutMs = 20000) {
    const id = `t${this.seq++}`;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { res, rej, t });
      this.socket.send(JSON.stringify({ Version: API_VERSION, Timestamp: Date.now(), RequestId: id, Type: "Request", Method: method, Data: data }));
    });
  }
}

const c = new Client();
const log = [];
try {
  await c.connect();
  const reg = await c.request("RegisterPlugin", { Name: PLUGIN_NAME, Token: readToken() }, 30000);
  log.push({ step: "registered", token: Boolean(reg.Token) });
  let ok = false;
  for (let i = 0; i < 20; i++) {
    try {
      const a = (await c.request("GetIsApproval")).Result === true;
      const b = (await c.request("GetIsEditApproval")).Result === true;
      if (a && b) { ok = true; break; }
    } catch {}
    await sleep(1000);
  }
  if (!ok) throw new Error("approval not granted");
  const modelUid = (await c.request("GetCurrentModelUID")).ModelUID;

  // Drive ParamEyeLOpen to 0.5 and write a distinctive opacity on ArtIrisL.
  await c.request("EditBegin", { Silent: false }, 30000);
  await c.request("SetParameterValues", { ModelUID: modelUid, Parameters: [{ Id: "ParamEyeLOpen", Value: 0.5 }] }, 30000);
  await c.request("EditArtMesh", { ModelUID: modelUid, Id: "ArtIrisL", Opacity: 37 }, 30000);
  await c.request("EditEnd", { Cancel: false }, 30000);
  log.push({ step: "wrote 37 while driven at 0.5" });

  const baseAfter = await c.request("GetObject", { ModelUID: modelUid, Id: "ArtIrisL" }, 30000);
  log.push({ step: "base opacity after", opacity: baseAfter?.Data?.Opacity });

  // Keep the connection (and the temporary drive) alive so the render can be
  // inspected while ParamEyeLOpen is driven to 0.5.
  console.log("holding drive at 0.5 for 25s — grab the screen now");
  await sleep(25000);

  writeFileSync("exports/v4-drivetest.json", JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log));
} catch (e) {
  log.push({ fatal: String(e.message ?? e) });
  writeFileSync("exports/v4-drivetest.json", JSON.stringify(log, null, 2));
  console.error(JSON.stringify(log));
  try { await c.request("EditEnd", { Cancel: true }, 10000); } catch {}
  process.exitCode = 1;
} finally {
  c.socket?.close();
}
