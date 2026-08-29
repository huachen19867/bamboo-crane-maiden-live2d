import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const samplePsdPaths = {
  u3: process.env.SAMPLE_PSD_U3_PATH ?? process.env.SAMPLE_PSD_PATH ?? path.resolve("public/samples/u3/input.psd"),
  u4: process.env.SAMPLE_PSD_U4_PATH ?? path.resolve("public/samples/u4/input.psd"),
  u5: process.env.SAMPLE_PSD_U5_PATH ?? path.resolve("public/samples/u5/input.psd"),
  u6: process.env.SAMPLE_PSD_U6_PATH ?? path.resolve("public/samples/u6/input.psd")
};

function samplePsdPlugin(): Plugin {
  return {
    name: "sample-psd-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/sample-psd", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        const url = new URL(req.url ?? "", "http://localhost");
        const preset = url.searchParams.get("preset") ?? "u3";
        const samplePsdPath = samplePsdPaths[preset as keyof typeof samplePsdPaths];
        if (!samplePsdPath) {
          res.statusCode = 400;
          res.end(`Unknown sample preset: ${preset}`);
          return;
        }

        if (!fs.existsSync(samplePsdPath)) {
          res.statusCode = 404;
          res.end(`Missing sample PSD: ${samplePsdPath}`);
          return;
        }

        const stat = fs.statSync(samplePsdPath);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(stat.size));
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(samplePsdPath)}"`);
        fs.createReadStream(samplePsdPath).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), samplePsdPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
