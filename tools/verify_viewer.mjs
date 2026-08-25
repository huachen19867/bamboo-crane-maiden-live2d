import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportsDir = path.join(root, 'exports');

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { script, status: result.status, signal: result.signal, error: result.error?.message || null };
}

await fs.mkdir(exportsDir, { recursive: true });
const visualRun = run('visual_acceptance_agent.mjs', ['--strict']);
const playerRun = run('player_control_sim_agent.mjs');

const visualPath = path.join(exportsDir, 'visual-acceptance', 'visual-acceptance-report.json');
const playerPath = path.join(exportsDir, 'player-sim', 'player-control-sim-report.json');
const visual = JSON.parse(await fs.readFile(visualPath, 'utf8'));
const player = JSON.parse(await fs.readFile(playerPath, 'utf8'));
const passed = visualRun.status === 0 && playerRun.status === 0
  && visual.result === 'pass' && player.summary?.verdict === 'pass';

const summary = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  verdict: passed ? 'pass' : 'fail',
  visual: {
    process: visualRun,
    summary: visual.summary,
    wholeCharacterSimilarityPercent: visual.identity?.canvasAlignedWholeCharacter?.similarityPercent,
    faceSimilarityPercent: visual.identity?.canvasAlignedFace?.similarityPercent,
    report: path.relative(root, visualPath)
  },
  playerControl: {
    process: playerRun,
    summary: player.summary,
    report: path.relative(root, playerPath)
  },
  evidence: {
    contactSheet: 'exports/visual-acceptance/state-contact-sheet.png',
    playerBaseline: 'exports/player-sim/baseline.png',
    randomizedInputRecovery: 'exports/player-sim/after-randomized-input.png'
  }
};

const output = path.join(exportsDir, 'viewer-verification.json');
await fs.writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, verdict: summary.verdict, visual: summary.visual.summary, player: summary.playerControl.summary }, null, 2));
if (!passed) process.exitCode = 1;
