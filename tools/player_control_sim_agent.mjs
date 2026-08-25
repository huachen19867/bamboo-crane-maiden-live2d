import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'exports', 'player-sim');
await fs.mkdir(outputDir, { recursive: true });

const bundledModules = process.env.CODEX_WORKSPACE_NODE_MODULES
  || path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const require = createRequire(path.join(bundledModules, '__player_control_sim_resolver.cjs'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  throw new Error(`Playwright is required. Set CODEX_WORKSPACE_NODE_MODULES to the bundled node_modules directory. ${error.message}`);
}

const nowIso = () => new Date().toISOString();
const startedAt = nowIso();
const tests = [];
const requirements = [];
const consoleErrors = [];
const consoleWarnings = [];

function record(name, status, evidence = {}, requirement = '') {
  tests.push({ name, status, requirement, evidence });
}

function requirement(id, description, evidencePath) {
  requirements.push({ id, description, evidencePath });
}

function flattenNumbers(value, prefix = '', result = {}) {
  if (typeof value === 'number') {
    result[prefix] = value;
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('__')) continue;
      flattenNumbers(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function numericDelta(a, b, include = /.*/) {
  const aa = flattenNumbers(a);
  const bb = flattenNumbers(b);
  const changes = [];
  for (const key of new Set([...Object.keys(aa), ...Object.keys(bb)])) {
    if (!include.test(key) || !Number.isFinite(aa[key]) || !Number.isFinite(bb[key])) continue;
    const delta = bb[key] - aa[key];
    if (Math.abs(delta) > 1e-4) changes.push({ path: key, before: aa[key], after: bb[key], delta });
  }
  return changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

function allFinite(value) {
  return Object.entries(flattenNumbers(value)).filter(([, number]) => !Number.isFinite(number));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Static server did not become ready: ${lastError?.message || 'timeout'}`);
}

function findPython() {
  const candidates = [
    process.env.PLAYER_SIM_PYTHON,
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python'
  ].filter(Boolean);
  return candidates[0];
}

async function snapshot(page) {
  return await page.evaluate(async () => {
    const api = globalThis.live2dControl;
    if (api && typeof api.getSnapshot === 'function') {
      const value = await api.getSnapshot();
      return { __source: 'live2dControl', ...value };
    }
    try {
      const legacy = (0, eval)(`typeof state !== 'undefined' ? state : null`);
      if (legacy) {
        return {
          __source: 'legacy-state',
          mode: legacy.mode,
          input: { pointer: { x: legacy.pointerX, y: legacy.pointerY }, keys: [] },
          physics: { wind: legacy.wind, turbulence: legacy.turbulence },
          options: { blink: legacy.blink, highlights: legacy.highlights }
        };
      }
    } catch {}
    return { __source: 'none' };
  });
}

async function apiInfo(page) {
  return await page.evaluate(async () => {
    const api = globalThis.live2dControl;
    if (!api) return { present: false, methods: [], version: null, bindings: null };
    const methods = ['getSnapshot', 'dispatchInput', 'reset', 'tick', 'getBindings'].filter(name => typeof api[name] === 'function');
    let bindings = null;
    if (typeof api.getBindings === 'function') bindings = await api.getBindings();
    return { present: true, methods, version: api.version ?? null, bindings };
  });
}

async function dispatch(page, event) {
  return await page.evaluate(async value => {
    const api = globalThis.live2dControl;
    if (!api || typeof api.dispatchInput !== 'function') return { supported: false };
    const result = await api.dispatchInput(value);
    return { supported: true, result: result ?? null };
  }, event);
}

async function reset(page) {
  return await page.evaluate(async () => {
    const api = globalThis.live2dControl;
    if (!api || typeof api.reset !== 'function') return false;
    await api.reset();
    return true;
  });
}

async function pressAndSample(page, key, holdMs = 280, settleMs = 650) {
  const before = await snapshot(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  const held = await snapshot(page);
  await page.keyboard.up(key);
  await page.waitForTimeout(80);
  const released = await snapshot(page);
  await page.waitForTimeout(settleMs);
  const settled = await snapshot(page);
  return { before, held, released, settled };
}

const port = Number(process.env.PLAYER_SIM_PORT) || await freePort();
const baseUrl = process.env.PLAYER_SIM_URL || `http://127.0.0.1:${port}/viewer/`;
let serverProcess = null;
let browser = null;

try {
  if (!process.env.PLAYER_SIM_URL) {
    serverProcess = spawn(findPython(), ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(baseUrl);
  }

  browser = await chromium.launch({
    headless: process.env.PLAYER_SIM_HEADFUL !== '1',
    executablePath: process.env.PLAYWRIGHT_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const load = document.querySelector('#load');
    return !load || load.classList.contains('hidden');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(350);
  const initialScreenshot = path.join(outputDir, 'baseline.png');
  await page.screenshot({ path: initialScreenshot, fullPage: true });
  const initial = await snapshot(page);
  const api = await apiInfo(page);

  record('viewer-loads', response?.ok() && initial.__source !== 'none' ? 'pass' : 'fail', {
    url: page.url(), httpStatus: response?.status(), snapshotSource: initial.__source, screenshot: initialScreenshot
  }, 'P0: viewer loads and exposes observable state');

  const ui = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll('button,input,select,[role="button"],[tabindex]')]
      .filter(element => !element.disabled && element.getBoundingClientRect().width > 0)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        text: (element.innerText || element.labels?.[0]?.innerText || element.getAttribute('aria-label') || '').trim(),
        type: element.getAttribute('type'),
        ariaLabel: element.getAttribute('aria-label')
      }));
    const text = document.body.innerText;
    return {
      interactive,
      documentsKeyboard: /WASD|键盘|快捷键|操偶/i.test(text),
      documentsGamepad: /手柄|gamepad/i.test(text),
      documentsMocap: /动捕|摄像头|mocap/i.test(text),
      documentsWindDrag: /拖拽.{0,8}风|风场.{0,8}拖/i.test(text)
    };
  });
  const discoverabilityPass = ui.documentsKeyboard && ui.documentsGamepad && ui.documentsMocap && ui.documentsWindDrag;
  record('ui-control-discoverability', discoverabilityPass ? 'pass' : 'fail', ui,
    'P0: UI explains keyboard, gamepad, mocap and pointer wind interaction');

  record('debug-control-api', api.present && ['getSnapshot', 'dispatchInput', 'reset', 'getBindings'].every(method => api.methods.includes(method)) ? 'pass' : 'fail', api,
    'P0: stable automation/debug API is present');

  const canvas = page.locator('#stage');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Stage canvas is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const pointerCenter = await snapshot(page);
  await page.mouse.move(box.x + box.width * .82, box.y + box.height * .24);
  await page.waitForTimeout(80);
  const pointerMoved = await snapshot(page);
  const pointerChanges = numericDelta(pointerCenter, pointerMoved, /pointer|gaze|eye|head/i);
  record('mouse-gaze', pointerChanges.length ? 'pass' : 'fail', { changes: pointerChanges.slice(0, 12) },
    'P0: pointer movement controls gaze/head parameters');

  const modeButtons = page.locator('[data-mode]');
  const modeCount = await modeButtons.count();
  let modeEvidence = { count: modeCount, transitions: [] };
  if (modeCount >= 2) {
    for (let index = 0; index < modeCount; index++) {
      await modeButtons.nth(index).click();
      await page.waitForTimeout(40);
      modeEvidence.transitions.push({ index, snapshot: await snapshot(page) });
    }
  }
  const modes = new Set(modeEvidence.transitions.map(item => item.snapshot.mode).filter(Boolean));
  record('mode-switch-ui', modes.size >= 2 ? 'pass' : 'fail', modeEvidence,
    'P1: visible mode switch changes runtime mode');

  const windSlider = page.locator('#wind');
  let windEvidence = { present: await windSlider.count() > 0 };
  if (windEvidence.present) {
    await windSlider.fill('2.1');
    await page.waitForTimeout(80);
    windEvidence.snapshot = await snapshot(page);
    windEvidence.output = await page.locator('#windValue').inputValue().catch(async () => await page.locator('#windValue').textContent());
  }
  record('wind-slider', windEvidence.present && /2\.1/.test(String(windEvidence.output)) ? 'pass' : 'fail', windEvidence,
    'P1: visible wind control changes wind magnitude and readout');

  await reset(page);
  const beforeDrag = await snapshot(page);
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .35, { steps: 8 });
  const duringDrag = await snapshot(page);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterDrag = await snapshot(page);
  await page.waitForTimeout(700);
  const dragSettled = await snapshot(page);
  const dragChanges = numericDelta(beforeDrag, duringDrag, /wind|cloth|hair|physics|drag|impulse/i);
  const reboundChanges = numericDelta(afterDrag, dragSettled, /wind|cloth|hair|physics|velocity|offset/i);
  record('pointer-wind-drag-and-rebound', dragChanges.length && reboundChanges.length ? 'pass' : 'fail', {
    duringDragChanges: dragChanges.slice(0, 20), reboundChanges: reboundChanges.slice(0, 20)
  }, 'P0: pointer drag creates directional wind; release produces decaying physical rebound');

  const locomotionRegex = /params|body|root|hip|pelvis|leg|knee|ankle|foot|weight|position/i;
  for (const key of ['w', 'a', 's', 'd', 'q', 'e']) {
    await reset(page);
    const samples = await pressAndSample(page, key);
    const heldChanges = numericDelta(samples.before, samples.held, locomotionRegex);
    const releaseChanges = numericDelta(samples.held, samples.settled, locomotionRegex);
    const keyRecorded = JSON.stringify(samples.held.input?.keys || samples.held.input || '').toLowerCase().includes(key);
    record(`keyboard-${key.toUpperCase()}`, heldChanges.length && releaseChanges.length ? 'pass' : 'fail', {
      keyRecorded, heldChanges: heldChanges.slice(0, 16), releaseChanges: releaseChanges.slice(0, 16)
    }, `P0: ${key.toUpperCase()} changes locomotion/turn parameters and releases smoothly`);
  }

  await reset(page);
  await page.keyboard.down('w');
  const footSamples = [];
  for (let index = 0; index < 12; index++) {
    await page.waitForTimeout(90);
    footSamples.push(await snapshot(page));
  }
  await page.keyboard.up('w');
  const feetAvailable = footSamples.every(sample => sample.feet && sample.feet.left && sample.feet.right);
  const contactSamples = feetAvailable
    ? footSamples.flatMap(sample => ['left', 'right'].map(side => ({ side, ...sample.feet[side] }))).filter(foot => foot.contact)
    : [];
  const maxSupportSlide = contactSamples.reduce((max, foot) => Math.max(max, Math.abs(Number(foot.slidePx) || 0)), 0);
  const contactTransitions = feetAvailable ? footSamples.reduce((count, sample, index) => {
    if (!index) return 0;
    return count + ['left', 'right'].filter(side => sample.feet[side].contact !== footSamples[index - 1].feet[side].contact).length;
  }, 0) : 0;
  record('foot-lock-and-weight-transfer', feetAvailable && contactSamples.length > 0 && maxSupportSlide <= 2 && contactTransitions > 0 ? 'pass' : 'fail', {
    feetAvailable, maxSupportSlidePx: maxSupportSlide, contactTransitions,
    samples: footSamples.map(sample => sample.feet || null)
  }, 'P0: walking transfers weight while contact foot stays within 2px of anchor');

  for (const [key, expected] of [['z', 'wave'], ['x', 'sleeve'], ['c', 'bow'], ['v', 'point']]) {
    await reset(page);
    const samples = await pressAndSample(page, key, 220, 450);
    const actionText = JSON.stringify(samples.held.action ?? samples.held.actions ?? samples.held.driver ?? '').toLowerCase();
    const armChanges = numericDelta(samples.before, samples.held, /arm|shoulder|elbow|wrist|hand|finger|action/i);
    record(`action-${key.toUpperCase()}-${expected}`, actionText.length > 2 && armChanges.length ? 'pass' : 'fail', {
      actionState: samples.held.action ?? samples.held.actions ?? null, changes: armChanges.slice(0, 16)
    }, `P0: ${key.toUpperCase()} triggers ${expected} action and arm/hand parameters`);
  }

  for (const key of ['1', '2', '3', '4']) {
    await reset(page);
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
    const expressionSnapshot = await snapshot(page);
    const expressionText = JSON.stringify(expressionSnapshot.expression ?? expressionSnapshot.expressions ?? '').trim();
    record(`expression-${key}`, expressionText.length > 2 ? 'pass' : 'fail', {
      expression: expressionSnapshot.expression ?? expressionSnapshot.expressions ?? null
    }, `P1: numeric key ${key} selects a visible expression state`);
  }

  await reset(page);
  const gamepadBase = await snapshot(page);
  const gamepadDispatch = await dispatch(page, {
    type: 'gamepad', index: 0, connected: true,
    axes: [0.75, -0.55, 0.35, -0.2],
    buttons: [{ index: 0, pressed: true, value: 1 }, { index: 6, pressed: true, value: 0.7 }]
  });
  await page.waitForTimeout(180);
  const gamepadActive = await snapshot(page);
  await dispatch(page, { type: 'gamepad', index: 0, connected: true, axes: [0, 0, 0, 0], buttons: [] });
  await page.waitForTimeout(550);
  const gamepadSettled = await snapshot(page);
  const gamepadChanges = numericDelta(gamepadBase, gamepadActive, /input|params|body|arm|leg|head|root|gamepad/i);
  const gamepadRelease = numericDelta(gamepadActive, gamepadSettled, /params|body|arm|leg|head|root|gamepad/i);
  record('gamepad-equivalent-input', gamepadDispatch.supported && gamepadChanges.length && gamepadRelease.length ? 'pass' : 'fail', {
    dispatchSupported: gamepadDispatch.supported,
    activeChanges: gamepadChanges.slice(0, 20), releaseChanges: gamepadRelease.slice(0, 20)
  }, 'P0: injected gamepad state drives character and returns smoothly on release');

  await reset(page);
  const mocapDispatch = await dispatch(page, {
    type: 'mocap', source: 'player-sim', confidence: 1,
    face: { eyeLOpen: 0.55, eyeROpen: 0.6, mouthOpen: 0.25 },
    pose: { headX: 0.35, headY: -0.15, armR: 0.4, armL: -0.2 }
  });
  await page.waitForTimeout(120);
  const mocapOnly = await snapshot(page);
  await page.keyboard.down('z');
  await page.waitForTimeout(180);
  const blended = await snapshot(page);
  await page.keyboard.up('z');
  await dispatch(page, { type: 'mocap', source: 'player-sim', active: false });
  const sourceText = JSON.stringify(blended.driver ?? blended.drivers ?? blended.sources ?? '').toLowerCase();
  const priorityObservable = /mocap|动捕/.test(sourceText) && /action|keyboard|操偶/.test(sourceText);
  const blendChanges = numericDelta(mocapOnly, blended, /arm|hand|action|driver|source|head|face|eye|mouth/i);
  record('mixed-driver-priority', mocapDispatch.supported && priorityObservable && blendChanges.length ? 'pass' : 'fail', {
    dispatchSupported: mocapDispatch.supported, driverState: blended.driver ?? blended.drivers ?? blended.sources ?? null,
    changes: blendChanges.slice(0, 24)
  }, 'P0: action input overrides relevant arm channels while mocap retains face/head and physics remains active');

  await reset(page);
  const randomKeys = ['w', 'a', 's', 'd', 'q', 'e', 'z', 'x', 'c', 'v', '1', '2', '3', '4'];
  let seed = 0x2d5a2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const heldKeys = new Set();
  for (let index = 0; index < 180; index++) {
    const kind = Math.floor(random() * 4);
    if (kind === 0) {
      const key = randomKeys[Math.floor(random() * randomKeys.length)];
      if (heldKeys.has(key)) { await page.keyboard.up(key); heldKeys.delete(key); }
      else { await page.keyboard.down(key); heldKeys.add(key); }
    } else if (kind === 1) {
      await page.mouse.move(box.x + random() * box.width, box.y + random() * box.height);
    } else if (kind === 2 && api.present) {
      await dispatch(page, { type: 'gamepad', index: 0, connected: true, axes: [random() * 2 - 1, random() * 2 - 1, 0, 0], buttons: [] });
    } else {
      const slider = random() > .5 ? page.locator('#wind') : page.locator('#turbulence');
      if (await slider.count()) {
        const min = Number(await slider.getAttribute('min'));
        const max = Number(await slider.getAttribute('max'));
        const step = Number(await slider.getAttribute('step')) || 1;
        const raw = min + random() * (max - min);
        const stepped = Math.min(max, Math.max(min, min + Math.round((raw - min) / step) * step));
        await slider.evaluate((element, value) => {
          element.value = String(value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }, stepped);
      }
    }
    if (index % 18 === 0) await page.waitForTimeout(16);
  }
  for (const key of heldKeys) await page.keyboard.up(key);
  await dispatch(page, { type: 'gamepad', index: 0, connected: false, axes: [0, 0, 0, 0], buttons: [] });
  await page.waitForTimeout(1000);
  const chaosSettled = await snapshot(page);
  const nonFinite = allFinite(chaosSettled);
  const chaosScreenshot = path.join(outputDir, 'after-randomized-input.png');
  await page.screenshot({ path: chaosScreenshot, fullPage: true });
  record('randomized-input-stability', !nonFinite.length && !consoleErrors.length ? 'pass' : 'fail', {
    events: 180, seed: '0x2d5a2026', nonFinite, consoleErrors, screenshot: chaosScreenshot,
    finalSnapshot: chaosSettled
  }, 'P0: 180 deterministic out-of-order inputs do not produce NaN, crash or console errors');

  record('console-clean', consoleErrors.length === 0 ? 'pass' : 'fail', { consoleErrors, consoleWarnings },
    'P0: no browser console/page errors during all scenarios');

  requirement('REQ-INPUT-01', 'Mouse gaze and directional wind drag are distinct and observable.', 'tests.mouse-gaze + tests.pointer-wind-drag-and-rebound');
  requirement('REQ-INPUT-02', 'WASD moves/steps; Q/E turns; releases decay without snapping.', 'tests.keyboard-*');
  requirement('REQ-BODY-01', 'Walking changes body/hip/leg/foot parameters with support-foot lock <= 2 px.', 'tests.foot-lock-and-weight-transfer');
  requirement('REQ-ACTION-01', 'Z/X/C/V trigger arm/hand actions and numeric keys select expressions.', 'tests.action-* + tests.expression-*');
  requirement('REQ-DRIVER-01', 'Gamepad and mocap equivalent inputs participate in priority-based channel blending.', 'tests.gamepad-equivalent-input + tests.mixed-driver-priority');
  requirement('REQ-STABILITY-01', 'Randomized mixed inputs recover without non-finite state or console errors.', 'tests.randomized-input-stability + tests.console-clean');
  requirement('REQ-UX-01', 'The UI teaches keyboard, gamepad, mocap and drag-to-wind interaction.', 'tests.ui-control-discoverability');

  const counts = tests.reduce((summary, test) => {
    summary[test.status] = (summary[test.status] || 0) + 1;
    return summary;
  }, { pass: 0, fail: 0, blocked: 0, skipped: 0 });
  const report = {
    schemaVersion: 1,
    agent: 'player-control-sim',
    startedAt,
    finishedAt: nowIso(),
    target: { root, url: baseUrl, api },
    summary: { ...counts, total: tests.length, verdict: counts.fail === 0 ? 'pass' : 'fail' },
    requirements,
    tests,
    console: { errors: consoleErrors, warnings: consoleWarnings }
  };
  const reportPath = path.join(outputDir, 'player-control-sim-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ reportPath, summary: report.summary, api: report.target.api }, null, 2));
  process.exitCode = counts.fail === 0 ? 0 : 1;
} catch (error) {
  const fatal = {
    schemaVersion: 1,
    agent: 'player-control-sim',
    startedAt,
    finishedAt: nowIso(),
    target: { root, url: baseUrl },
    summary: { pass: 0, fail: 1, blocked: 0, skipped: 0, total: 1, verdict: 'fatal' },
    fatal: { name: error.name, message: error.message, stack: error.stack },
    tests,
    console: { errors: consoleErrors, warnings: consoleWarnings }
  };
  await fs.writeFile(path.join(outputDir, 'player-control-sim-report.json'), `${JSON.stringify(fatal, null, 2)}\n`, 'utf8');
  console.error(error.stack || error.message);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (serverProcess) serverProcess.kill();
}
