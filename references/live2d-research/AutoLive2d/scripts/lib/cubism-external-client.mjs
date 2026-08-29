import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const CUBISM_API_VERSION = "1.1.0";
export const CUBISM_API_URL = "ws://127.0.0.1:22033";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CubismExternalClient {
  constructor({
    url = process.env.CUBISM_API_URL ?? CUBISM_API_URL,
    version = CUBISM_API_VERSION,
    pluginName = "Auto Live2D Studio Agent Bridge",
    tokenPath,
  } = {}) {
    this.url = url;
    this.version = version;
    this.pluginName = pluginName;
    this.tokenPath = tokenPath;
    this.socket = null;
    this.pending = new Map();
  }

  async connect(timeoutMs = 10_000) {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.#handleMessage(event));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Could not connect to ${this.url}. Is Cubism external integration enabled?`));
      }, { once: true });
    });

    const token = this.tokenPath && existsSync(this.tokenPath)
      ? readFileSync(this.tokenPath, "utf8").trim()
      : "";
    const registration = await this.request("RegisterPlugin", {
      Token: token,
      Name: this.pluginName,
    }, 30_000);
    if (this.tokenPath && registration.Token && registration.Token !== token) {
      writeFileSync(this.tokenPath, registration.Token, { encoding: "utf8", mode: 0o600 });
    }
  }

  async authorize(timeoutMs = 600_000) {
    await this.waitForApproval("GetIsApproval", "Normal permission", timeoutMs);
    await this.waitForApproval("GetIsEditApproval", "Edit permission", timeoutMs);
  }

  async waitForApproval(method, label, timeoutMs = 600_000) {
    const startedAt = Date.now();
    let lastLogAt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await this.request(method);
        if (response.Result === true) {
          console.log(`${label}: granted`);
          return;
        }
      } catch (error) {
        if (!String(error.message).includes("InvalidPermission")) throw error;
      }
      if (Date.now() - lastLogAt > 10_000) {
        console.log(`${label}: waiting for approval in Cubism Editor...`);
        lastLogAt = Date.now();
      }
      await sleep(1_000);
    }
    throw new Error(`${label} was not granted within ${timeoutMs / 1000} seconds`);
  }

  request(method, data = {}, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Cubism WebSocket is not connected"));
    }
    const requestId = randomUUID();
    const payload = {
      Version: this.version,
      Timestamp: Date.now(),
      RequestId: requestId,
      Type: "Request",
      Method: method,
      Data: data,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.socket.send(JSON.stringify(payload));
    });
  }

  async withEdit(callback, { silent = true, cancel = false } = {}) {
    await this.request("EditBegin", { Silent: silent }, 30_000);
    let shouldCancel = cancel;
    try {
      const result = await callback(this);
      await this.request("EditEnd", { Cancel: shouldCancel }, 30_000);
      return result;
    } catch (error) {
      shouldCancel = true;
      try {
        await this.request("EditEnd", { Cancel: true }, 30_000);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  close() {
    for (const entry of this.pending.values()) clearTimeout(entry.timeout);
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
  }

  #handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.Type === "Event") {
      if (message.Method === "NotifyUndoCancel") {
        console.warn("Cubism reported that the active edit operation was cancelled.");
      }
      return;
    }

    const entry = this.pending.get(message.RequestId);
    if (!entry) return;
    this.pending.delete(message.RequestId);
    clearTimeout(entry.timeout);

    if (message.Type === "Error") {
      entry.reject(new Error(`${message.Method}: ${message.Data?.ErrorType ?? "UnknownError"}`));
      return;
    }
    entry.resolve(message.Data ?? {});
  }
}
