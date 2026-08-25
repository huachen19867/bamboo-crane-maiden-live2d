#!/usr/bin/env node

/**
 * Independent, repeatable visual acceptance agent for the Bamboo Crane Live2D viewer.
 *
 * The runner never mutates viewer state outside the browser process and writes all
 * evidence to exports/visual-acceptance/.  Use --strict to make failed acceptance
 * gates return a non-zero process exit code.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'exports', 'visual-acceptance');
const strict = process.argv.includes('--strict');

function loadDependency(name) {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire(name);
  } catch (localError) {
    const modulesRoot = process.env.CODEX_NODE_MODULES || path.join(
      process.env.USERPROFILE || '',
      '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules'
    );
    const runtimeRequire = createRequire(path.join(path.dirname(modulesRoot), 'package.json'));
    try {
      return runtimeRequire(name);
    } catch {
      throw new Error(
        `Cannot load ${name}. Local resolution failed (${localError.message}). ` +
        `Set CODEX_NODE_MODULES to the bundled Node node_modules directory.`
      );
    }
  }
}

const { chromium } = loadDependency('playwright');
const sharp = loadDependency('sharp');

const DEFAULT_REGIONS = {
  hair: { x: 250, y: 15, width: 610, height: 445 },
  face: { x: 455, y: 100, width: 225, height: 225 },
  eyeLeft: { x: 505, y: 140, width: 72, height: 82 },
  eyeRight: { x: 575, y: 135, width: 72, height: 82 },
  arms: { x: 235, y: 215, width: 650, height: 430 },
  cloth: { x: 175, y: 430, width: 900, height: 590 },
  legsFeet: { x: 360, y: 820, width: 340, height: 420 },
  anchors: { x: 355, y: 430, width: 250, height: 180 },
  staticBackground: { x: 0, y: 0, width: 150, height: 1254 }
};

const THRESHOLDS = {
  referenceDisplaySimilarityPercent: 99,
  characterAlignedSimilarityPercent: 95,
  minimumChangedPixels: 20,
  minimumChangedRatioWithinRegion: 0.002,
  maximumAnchorChangedRatio: 0.02,
  maximumAnchorHoleRatio: 0.001,
  maximumBlinkDiffAspectRatio: 0.65,
  minimumFps: 45,
  maximumP95FrameTimeMs: 28
};

const stateSpecs = {
  idle: [
    { suffix: 'neutral', timeMs: 500, options: { phase: 0, wind: 0, blink: 0 } },
    { suffix: 'late', timeMs: 2500, options: { phase: 1, wind: 0, blink: 0 } }
  ],
  wind: [
    { suffix: 'lead', timeMs: 700, options: { phase: 0.2, wind: 2.4, turbulence: 0.06 } },
    { suffix: 'peak', timeMs: 1350, options: { phase: 0.78, wind: 2.4, turbulence: 0.06 } }
  ],
  arm: [
    { suffix: 'rest', timeMs: 500, options: { phase: 0, side: 'right', amount: 0 } },
    { suffix: 'raised', timeMs: 1600, options: { phase: 1, side: 'right', amount: 1 } }
  ],
  step: [
    { suffix: 'support', timeMs: 600, options: { phase: 0.15, side: 'left' } },
    { suffix: 'swing', timeMs: 1500, options: { phase: 0.65, side: 'left' } }
  ],
  blink: [
    { suffix: 'open', timeMs: 500, options: { amount: 0, phase: 0 } },
    { suffix: 'closed', timeMs: 75, options: { amount: 1, phase: 1 } }
  ]
};

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.moc3': 'application/octet-stream'
};

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let target = path.resolve(root, `.${urlPath}`);
      if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fs.stat(target);
      if (stat.isDirectory()) target = path.join(target, 'index.html');
      const body = await fs.readFile(target);
      response.writeHead(200, { 'content-type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function fromDataUrl(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function rawImage(buffer, width, height) {
  return sharp(buffer).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function normalizeRect(rect, width, height) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  const normalized = rect.normalized === true || (rect.width <= 1 && rect.height <= 1 && rect.x <= 1 && rect.y <= 1);
  const x = normalized ? rect.x * width : rect.x;
  const y = normalized ? rect.y * height : rect.y;
  const w = normalized ? rect.width * width : rect.width;
  const h = normalized ? rect.height * height : rect.height;
  return {
    x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)),
    width: Math.max(0, Math.min(width - Math.floor(x), Math.ceil(w))),
    height: Math.max(0, Math.min(height - Math.floor(y), Math.ceil(h)))
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * p))];
}

function diffMetrics(a, b, rect, threshold = 36) {
  const region = normalizeRect(rect, a.info.width, a.info.height) || { x: 0, y: 0, width: a.info.width, height: a.info.height };
  let changedPixels = 0;
  let absoluteDelta = 0;
  let maxX = -1, maxY = -1, minX = a.info.width, minY = a.info.height;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * a.info.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      absoluteDelta += d;
      if (d > threshold) {
        changedPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pixels = Math.max(1, region.width * region.height);
  const bounds = maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  return {
    region, changedPixels, changedRatio: changedPixels / pixels,
    meanAbsoluteRgbDelta: absoluteDelta / (pixels * 3), bounds,
    diffAspectRatio: bounds ? bounds.height / Math.max(1, bounds.width) : null
  };
}

function backgroundAssimilationMetrics(idle, state, background, rect) {
  const region = normalizeRect(rect, idle.info.width, idle.info.height);
  let baselineOccupied = 0;
  let backgroundAssimilated = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * idle.info.width + x) * 4;
      const baseDistance = Math.abs(idle.data[i] - background.data[i]) + Math.abs(idle.data[i + 1] - background.data[i + 1]) + Math.abs(idle.data[i + 2] - background.data[i + 2]);
      const stateDistance = Math.abs(state.data[i] - background.data[i]) + Math.abs(state.data[i + 1] - background.data[i + 1]) + Math.abs(state.data[i + 2] - background.data[i + 2]);
      if (baseDistance > 90) {
        baselineOccupied++;
        if (stateDistance < 24) backgroundAssimilated++;
      }
    }
  }
  return {
    baselineOccupied, backgroundAssimilated,
    ratio: backgroundAssimilated / Math.max(1, baselineOccupied),
    interpretation: 'Potential exposed background inside the idle silhouette; moving-region values are evidence, not an automatic tear verdict.'
  };
}

function similarityMetrics(reference, candidate, mask = null, rect = null) {
  const region = normalizeRect(rect || { x: 0, y: 0, width: reference.info.width, height: reference.info.height }, reference.info.width, reference.info.height);
  let weightedDelta = 0;
  let weightTotal = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * reference.info.width + x) * 4;
      const weight = mask ? mask.data[i + 3] / 255 : 1;
      if (weight < 0.05) continue;
      weightedDelta += weight * (
        Math.abs(reference.data[i] - candidate.data[i]) +
        Math.abs(reference.data[i + 1] - candidate.data[i + 1]) +
        Math.abs(reference.data[i + 2] - candidate.data[i + 2])
      );
      weightTotal += weight * 3;
    }
  }
  return {
    similarityPercent: 100 * (1 - weightedDelta / Math.max(1, weightTotal * 255)),
    weightedPixels: weightTotal / 3,
    method: mask ? 'alpha-weighted normalized RGB absolute similarity' : 'normalized RGB absolute similarity',
    region
  };
}

function gate(id, passed, actual, expected, severity = 'required', note = '') {
  return { id, status: passed ? 'pass' : 'fail', severity, actual, expected, note };
}

function unsupportedGate(id, capability, note) {
  return { id, status: 'unsupported', severity: 'required', actual: capability, expected: 'supported', note };
}

async function diffHeatmap(a, b) {
  const output = Buffer.alloc(a.info.width * a.info.height * 4);
  for (let i = 0; i < output.length; i += 4) {
    const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    const intensity = Math.min(1, Math.max(0, (delta - 18) / 210));
    output[i] = Math.round(10 + 245 * intensity);
    output[i + 1] = Math.round(28 + 195 * Math.max(0, intensity - 0.35) / 0.65);
    output[i + 2] = Math.round(26 * (1 - intensity));
    output[i + 3] = 255;
  }
  return sharp(output, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toBuffer();
}

async function unsupportedPlaceholder(label) {
  return sharp({ create: { width: 1254, height: 1254, channels: 4, background: '#dfeae4' } })
    .composite([{ input: Buffer.from(
      `<svg width="1254" height="1254"><rect x="90" y="90" width="1074" height="1074" rx="44" fill="#0b2522"/><text x="627" y="580" text-anchor="middle" fill="#e8f2ed" font-family="Arial,sans-serif" font-size="64">${label}</text><text x="627" y="670" text-anchor="middle" fill="#e5c66f" font-family="Arial,sans-serif" font-size="42">UNSUPPORTED · NO EVIDENCE</text></svg>`
    ) }]).png().toBuffer();
}

async function makeContactSheet(entries, destination) {
  const thumbWidth = 480;
  const thumbHeight = 480;
  const labelHeight = 52;
  const columns = 3;
  const rows = Math.ceil(entries.length / columns);
  const composites = [];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const thumb = await sharp(item.buffer)
      .resize(thumbWidth, thumbHeight, { fit: 'contain', background: '#e6efe9' })
      .extend({ bottom: labelHeight, background: '#0b2522' })
      .composite([{ input: Buffer.from(
        `<svg width="${thumbWidth}" height="${labelHeight}"><text x="18" y="34" fill="#d9ece3" font-family="Arial,sans-serif" font-size="22">${item.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`
      ), top: thumbHeight, left: 0 }])
      .png().toBuffer();
    composites.push({ input: thumb, left: (i % columns) * thumbWidth, top: Math.floor(i / columns) * (thumbHeight + labelHeight) });
  }
  await sharp({ create: { width: columns * thumbWidth, height: rows * (thumbHeight + labelHeight), channels: 4, background: '#102e2a' } })
    .composite(composites).png().toFile(destination);
}

await fs.mkdir(outDir, { recursive: true });
const { server, baseUrl } = await startStaticServer();
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const url = `${baseUrl}/viewer/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const api = window.__LIVE2D_DEBUG__;
    const canvas = document.querySelector('#stage') || document.querySelector('canvas');
    const legacyReady = document.querySelector('#load')?.classList.contains('hidden');
    return Boolean(canvas && (api || legacyReady));
  }, null, { timeout: 30000 });
  await page.waitForTimeout(200);

  const debugInfo = await page.evaluate(async () => {
    const api = window.__LIVE2D_DEBUG__;
    if (!api) {
      let legacy = {};
      try { legacy = { wind: typeof state !== 'undefined', blink: typeof blinkAmount === 'function', renderAt: typeof render === 'function' }; } catch {}
      return { available: false, version: null, capabilities: { states: ['idle', 'wind', 'blink'], regions: {} }, legacy };
    }
    if (api.ready && typeof api.ready.then === 'function') await api.ready;
    const capabilities = typeof api.getCapabilities === 'function' ? await api.getCapabilities() : (api.capabilities || {});
    return { available: true, version: api.version || null, capabilities, legacy: null };
  });

  const canvasSize = await page.locator('#stage, canvas').first().evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
  const regions = { ...DEFAULT_REGIONS };
  for (const [name, rect] of Object.entries(debugInfo.capabilities?.regions || {})) {
    if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height)) regions[name] = rect;
  }
  const advertisedStates = new Set(debugInfo.capabilities?.states || []);
  const legacyStates = new Set(['idle', 'wind', 'blink']);
  const stateSupport = Object.fromEntries(Object.keys(stateSpecs).map(name => [name, debugInfo.available ? advertisedStates.has(name) : legacyStates.has(name)]));

  async function resetRuntime() {
    await page.evaluate(async () => {
      const api = window.__LIVE2D_DEBUG__;
      if (api && typeof api.reset === 'function') await api.reset();
      else {
        try {
          state.mode = 'model'; state.wind = 0; state.turbulence = 0;
          state.blink = false; state.highlights = false; state.pointerX = 0; state.pointerY = 0;
        } catch {}
      }
    });
  }

  async function captureState(name, sample) {
    const dataUrl = await page.evaluate(async ({ name, sample }) => {
      const api = window.__LIVE2D_DEBUG__;
      if (api) {
        if (typeof api.setState !== 'function' || typeof api.renderAt !== 'function') throw new Error('Debug API requires setState() and renderAt()');
        await api.setState(name, sample.options || {});
        await api.renderAt(sample.timeMs);
      } else {
        if (typeof state === 'undefined' || typeof render !== 'function') throw new Error('Legacy viewer globals are not reachable');
        state.mode = 'model'; state.highlights = false; state.pointerX = 0; state.pointerY = 0;
        if (name === 'idle') { state.wind = 0; state.turbulence = 0; state.blink = false; }
        if (name === 'wind') { state.wind = sample.options.wind ?? 2.4; state.turbulence = sample.options.turbulence ?? 0.06; state.blink = false; }
        if (name === 'blink') { state.wind = 0; state.turbulence = 0; state.blink = true; }
        render(sample.timeMs);
      }
      const canvas = document.querySelector('#stage') || document.querySelector('canvas');
      return canvas.toDataURL('image/png');
    }, { name, sample });
    const buffer = fromDataUrl(dataUrl);
    const file = path.join(outDir, `${name}-${sample.suffix}.png`);
    await fs.writeFile(file, buffer);
    return { ...sample, file, buffer, raw: await rawImage(buffer, canvasSize.width, canvasSize.height) };
  }

  async function captureReference() {
    const dataUrl = await page.evaluate(async () => {
      const api = window.__LIVE2D_DEBUG__;
      if (api && typeof api.captureReference === 'function') return await api.captureReference();
      try {
        state.mode = 'reference'; state.wind = 0; state.blink = false; state.highlights = false;
        render(500);
      } catch {
        const button = document.querySelector('[data-mode="reference"]');
        if (!button) return null;
        button.click();
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return (document.querySelector('#stage') || document.querySelector('canvas')).toDataURL('image/png');
    });
    if (!dataUrl) return null;
    const buffer = fromDataUrl(dataUrl);
    const file = path.join(outDir, 'reference-display.png');
    await fs.writeFile(file, buffer);
    return { file, buffer, raw: await rawImage(buffer, canvasSize.width, canvasSize.height) };
  }

  async function captureBackground() {
    const dataUrl = await page.evaluate(async () => {
      const api = window.__LIVE2D_DEBUG__;
      if (api && typeof api.captureBackground === 'function') return await api.captureBackground();
      if (typeof drawBackground !== 'function') return null;
      const canvas = document.querySelector('#stage') || document.querySelector('canvas');
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      try { state.mode = 'model'; } catch {}
      drawBackground();
      return canvas.toDataURL('image/png');
    });
    if (!dataUrl) return null;
    const buffer = fromDataUrl(dataUrl);
    await fs.writeFile(path.join(outDir, 'background-only.png'), buffer);
    return { buffer, raw: await rawImage(buffer, canvasSize.width, canvasSize.height) };
  }

  await resetRuntime();
  const captures = {};
  for (const [name, samples] of Object.entries(stateSpecs)) {
    if (!stateSupport[name]) continue;
    captures[name] = [];
    for (const sample of samples) captures[name].push(await captureState(name, sample));
  }
  const referenceCapture = await captureReference();
  await resetRuntime();
  if (captures.idle?.[0]) await captureState('idle', stateSpecs.idle[0]);
  const backgroundCapture = await captureBackground();
  await resetRuntime();
  if (captures.idle?.[0]) await page.screenshot({ path: path.join(outDir, 'ui-idle.png'), fullPage: true });

  const fps = await page.evaluate(async () => {
    const times = [];
    await new Promise(resolve => {
      let first = null;
      const step = timestamp => {
        if (first === null) first = timestamp;
        times.push(timestamp);
        if (timestamp - first < 2500) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    const intervals = times.slice(1).map((value, index) => value - times[index]);
    return { samples: times.length, elapsedMs: times.at(-1) - times[0], intervals };
  });
  fps.effectiveFps = (fps.samples - 1) * 1000 / Math.max(1, fps.elapsedMs);
  fps.p50FrameTimeMs = percentile(fps.intervals, 0.5);
  fps.p95FrameTimeMs = percentile(fps.intervals, 0.95);
  delete fps.intervals;

  let telemetry = null;
  if (debugInfo.available) {
    telemetry = await page.evaluate(async () => {
      const api = window.__LIVE2D_DEBUG__;
      return typeof api.getTelemetry === 'function' ? await api.getTelemetry() : null;
    });
  }

  const stateMetrics = {};
  for (const [name, frames] of Object.entries(captures)) {
    const pair = diffMetrics(frames[0].raw, frames[1].raw, { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height });
    const perRegion = {};
    for (const [regionName, rect] of Object.entries(regions)) perRegion[regionName] = diffMetrics(frames[0].raw, frames[1].raw, rect);
    stateMetrics[name] = { pair, perRegion };
  }

  const baseRaw = captures.idle?.[0]?.raw;
  const transitionMetrics = {};
  if (baseRaw) {
    for (const [name, frames] of Object.entries(captures)) {
      if (name === 'idle') continue;
      const target = frames[1].raw;
      transitionMetrics[name] = {
        full: diffMetrics(baseRaw, target, { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height }),
        perRegion: Object.fromEntries(Object.entries(regions).map(([regionName, rect]) => [regionName, diffMetrics(baseRaw, target, rect)]))
      };
      if (backgroundCapture) {
        transitionMetrics[name].anchorBackgroundAssimilation = backgroundAssimilationMetrics(baseRaw, target, backgroundCapture.raw, regions.anchors);
      }
    }
  }

  const sourceReference = await rawImage(await fs.readFile(path.join(root, 'assets', 'runtime', 'reference-preview.png')), canvasSize.width, canvasSize.height);
  const characterMasterBuffer = await fs.readFile(path.join(root, 'assets', 'runtime', 'character-master.png'));
  const characterMaster = await rawImage(characterMasterBuffer, canvasSize.width, canvasSize.height);
  const identity = {
    referenceDisplay: referenceCapture ? similarityMetrics(sourceReference, referenceCapture.raw) : null,
    canvasAlignedWholeCharacter: similarityMetrics(sourceReference, characterMaster, characterMaster),
    canvasAlignedFace: similarityMetrics(sourceReference, characterMaster, characterMaster, regions.face),
    caveat: 'Reference-display similarity checks source presentation integrity only. The alpha-weighted character metrics compare the aligned extracted raster to the source and are the relevant fidelity evidence.'
  };

  const gates = [];
  gates.push(gate('browser-console-clean', consoleErrors.length === 0, consoleErrors, [], 'required'));
  gates.push(gate('fps-minimum', fps.effectiveFps >= THRESHOLDS.minimumFps, fps.effectiveFps, `>= ${THRESHOLDS.minimumFps}`, 'required'));
  gates.push(gate('p95-frame-time', fps.p95FrameTimeMs <= THRESHOLDS.maximumP95FrameTimeMs, fps.p95FrameTimeMs, `<= ${THRESHOLDS.maximumP95FrameTimeMs} ms`, 'required'));
  if (identity.referenceDisplay) gates.push(gate('reference-display-integrity', identity.referenceDisplay.similarityPercent >= THRESHOLDS.referenceDisplaySimilarityPercent, identity.referenceDisplay.similarityPercent, `>= ${THRESHOLDS.referenceDisplaySimilarityPercent}%`, 'diagnostic', 'Not a character-fidelity score.'));
  gates.push(gate('character-reference-similarity', identity.canvasAlignedWholeCharacter.similarityPercent >= THRESHOLDS.characterAlignedSimilarityPercent, identity.canvasAlignedWholeCharacter.similarityPercent, `>= ${THRESHOLDS.characterAlignedSimilarityPercent}%`, 'required'));
  gates.push(gate('face-reference-similarity', identity.canvasAlignedFace.similarityPercent >= THRESHOLDS.characterAlignedSimilarityPercent, identity.canvasAlignedFace.similarityPercent, `>= ${THRESHOLDS.characterAlignedSimilarityPercent}%`, 'required'));

  if (stateSupport.wind) {
    const hair = stateMetrics.wind?.perRegion.hair;
    const cloth = stateMetrics.wind?.perRegion.cloth;
    gates.push(gate('wind-hair-visible', hair?.changedPixels >= THRESHOLDS.minimumChangedPixels, hair?.changedPixels ?? 0, `>= ${THRESHOLDS.minimumChangedPixels} changed pixels`, 'required'));
    gates.push(gate('wind-cloth-visible', cloth?.changedRatio >= THRESHOLDS.minimumChangedRatioWithinRegion, cloth?.changedRatio ?? 0, `>= ${THRESHOLDS.minimumChangedRatioWithinRegion}`, 'required'));
  } else gates.push(unsupportedGate('wind-system-supported', false, 'No wind state was advertised.'));

  if (stateSupport.arm) {
    const arm = stateMetrics.arm?.perRegion.arms;
    gates.push(gate('arm-motion-visible', arm?.changedRatio >= THRESHOLDS.minimumChangedRatioWithinRegion, arm?.changedRatio ?? 0, `>= ${THRESHOLDS.minimumChangedRatioWithinRegion}`, 'required'));
  } else gates.push(unsupportedGate('arm-motion-supported', false, 'The viewer exposes no deterministic arm state.'));

  if (stateSupport.step) {
    const feet = stateMetrics.step?.perRegion.legsFeet;
    gates.push(gate('leg-foot-motion-visible', feet?.changedRatio >= THRESHOLDS.minimumChangedRatioWithinRegion, feet?.changedRatio ?? 0, `>= ${THRESHOLDS.minimumChangedRatioWithinRegion}`, 'required'));
  } else gates.push(unsupportedGate('leg-foot-motion-supported', false, 'The viewer exposes no deterministic step state.'));

  if (stateSupport.blink) {
    for (const [side, regionName] of [['left', 'eyeLeft'], ['right', 'eyeRight']]) {
      const metric = stateMetrics.blink?.perRegion[regionName];
      gates.push(gate(`blink-${side}-visible`, metric?.changedPixels >= THRESHOLDS.minimumChangedPixels, metric?.changedPixels ?? 0, `>= ${THRESHOLDS.minimumChangedPixels} changed pixels`, 'required'));
      gates.push(gate(`blink-${side}-shape`, metric?.diffAspectRatio !== null && metric.diffAspectRatio <= THRESHOLDS.maximumBlinkDiffAspectRatio, metric?.diffAspectRatio, `<= ${THRESHOLDS.maximumBlinkDiffAspectRatio} diff-bounds height/width`, 'required', 'Tall change bounds usually indicate a skin-colour oval covering the eye rather than eyelid deformation.'));
    }
  } else gates.push(unsupportedGate('blink-supported', false, 'No blink state was advertised.'));

  for (const name of ['wind', 'arm', 'step']) {
    if (!transitionMetrics[name]) continue;
    const anchor = transitionMetrics[name].perRegion.anchors;
    gates.push(gate(`${name}-anchor-stability`, anchor.changedRatio <= THRESHOLDS.maximumAnchorChangedRatio, anchor.changedRatio, `<= ${THRESHOLDS.maximumAnchorChangedRatio}`, 'required'));
    const holes = transitionMetrics[name].anchorBackgroundAssimilation;
    if (holes) gates.push(gate(`${name}-anchor-no-background-hole`, holes.ratio <= THRESHOLDS.maximumAnchorHoleRatio, holes.ratio, `<= ${THRESHOLDS.maximumAnchorHoleRatio}`, 'required'));
  }

  const requiredGates = gates.filter(item => item.severity === 'required');
  const summary = {
    result: requiredGates.every(item => item.status === 'pass') ? 'pass' : 'fail',
    pass: gates.filter(item => item.status === 'pass').length,
    fail: gates.filter(item => item.status === 'fail').length,
    unsupported: gates.filter(item => item.status === 'unsupported').length,
    requiredTotal: requiredGates.length
  };

  const contactEntries = [];
  for (const name of Object.keys(stateSpecs)) {
    for (const frame of captures[name] || []) contactEntries.push({ label: `${name} / ${frame.suffix}`, buffer: frame.buffer });
  }
  for (const name of ['arm', 'step']) {
    if (!stateSupport[name]) contactEntries.push({ label: `${name} / unsupported`, buffer: await unsupportedPlaceholder(name.toUpperCase()) });
  }
  if (referenceCapture) contactEntries.push({ label: 'reference display', buffer: referenceCapture.buffer });
  const diffEvidence = {};
  for (const name of ['wind', 'arm', 'step', 'blink']) {
    const frames = captures[name];
    if (!frames) continue;
    const buffer = await diffHeatmap(frames[0].raw, frames[1].raw);
    const file = path.join(outDir, `diff-${name}.png`);
    await fs.writeFile(file, buffer);
    diffEvidence[name] = file;
  }
  await makeContactSheet(contactEntries, path.join(outDir, 'state-contact-sheet.png'));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result: summary.result,
    summary,
    environment: { url, browser: 'Microsoft Edge via Playwright', viewport: { width: 1600, height: 1100 }, canvas: canvasSize, debug: debugInfo },
    thresholds: THRESHOLDS,
    regions,
    stateSupport,
    gates,
    identity,
    stateMetrics,
    transitionMetrics,
    performance: fps,
    telemetry,
    consoleErrors,
    evidence: {
      directory: outDir,
      contactSheet: path.join(outDir, 'state-contact-sheet.png'),
      uiScreenshot: path.join(outDir, 'ui-idle.png'),
      differenceHeatmaps: diffEvidence,
      captures: Object.fromEntries(Object.entries(captures).map(([name, frames]) => [name, frames.map(frame => frame.file)]))
    },
    limitations: [
      'Automated background-assimilation is a tear/hole signal, not a substitute for human review of the contact sheet.',
      'Arm and step acceptance require deterministic states exposed through window.__LIVE2D_DEBUG__.',
      'Reference-display similarity is deliberately excluded as proof of model fidelity.'
    ]
  };
  await fs.writeFile(path.join(outDir, 'visual-acceptance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: path.join(outDir, 'visual-acceptance-report.json'), contactSheet: report.evidence.contactSheet, summary }, null, 2));

  if (strict && summary.result !== 'pass') process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
