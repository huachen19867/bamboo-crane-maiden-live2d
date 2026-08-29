import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const nodeCommand = process.execPath;
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = require("electron");

let electronProcess;
let stopping = false;

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function stopProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function shutdown(viteProcess, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stopProcessTree(electronProcess);
  stopProcessTree(viteProcess);
  setTimeout(() => process.exit(exitCode), 250);
}

const viteProcess = spawn(nodeCommand, [viteBin, "--host", "127.0.0.1"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

function handleViteOutput(chunk, stream) {
  const text = chunk.toString();
  stream.write(text);
  if (electronProcess) return;
  const clean = stripAnsi(text);
  const match = clean.match(/http:\/\/127\.0\.0\.1:\d+\/?/);
  if (!match) return;
  const url = match[0].endsWith("/") ? match[0] : `${match[0]}/`;
  console.log(`Opening Auto Live2D Desktop at ${url}`);
  electronProcess = spawn(electronBin, ["desktop/main.cjs"], {
    cwd: root,
    env: { ...process.env, AUTO_LIVE2D_DESKTOP_URL: url },
    stdio: ["ignore", "pipe", "pipe"]
  });
  electronProcess.stdout?.on("data", (electronChunk) => process.stdout.write(electronChunk));
  electronProcess.stderr?.on("data", (electronChunk) => process.stderr.write(electronChunk));
  electronProcess.on("error", (error) => {
    console.error(error);
    shutdown(viteProcess, 1);
  });
  electronProcess.on("exit", (code) => shutdown(viteProcess, code ?? 0));
}

viteProcess.stdout.on("data", (chunk) => handleViteOutput(chunk, process.stdout));
viteProcess.stderr.on("data", (chunk) => handleViteOutput(chunk, process.stderr));
viteProcess.on("exit", (code) => {
  if (!stopping) shutdown(viteProcess, code ?? 1);
});
viteProcess.on("error", (error) => {
  console.error(error);
  shutdown(viteProcess, 1);
});

process.on("SIGINT", () => shutdown(viteProcess, 0));
process.on("SIGTERM", () => shutdown(viteProcess, 0));
