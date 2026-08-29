# Deployment Guide

This guide teaches a future agent how to install, run, validate, and hand off Auto Live2D Studio.

## Requirements

- Windows is the primary tested environment.
- Node.js and npm must be available on PATH.
- A modern Chromium-based browser is recommended.
- Camera tracking requires browser permission to access the local webcam.
- For OBS use, install OBS separately and capture either the small runtime window or exported runtime HTML.
- The see-through PSD splitter is only required when producing new split PSDs from source images. Built-in presets and finished packs can be loaded without it.

## Optional: Install the Bundled see-through PSD Splitter

AutoLive2d vendors a modified Apache-2.0 copy of see-through at `third_party/see-through`. It is only needed when turning a source image into a new split PSD; the editor and bundled presets work without its Python environment or model weights.

On Windows, install the bundled copy from the AutoLive2d repository root:

```powershell
cd .\third_party\see-through
powershell -ExecutionPolicy Bypass -File .\setup_windows.ps1
```

The setup script creates `.venv`, installs the CUDA/Python dependencies, and creates the local `assets` junction. Start its browser UI with:

```powershell
.\launch_webui.bat
```

Open `http://127.0.0.1:7861`. Model weights are downloaded on first use into `third_party/see-through/workspace/models` and are intentionally not stored in Git.

If a source archive intentionally omits `third_party/see-through`, clone the upstream project instead:

```powershell
git clone https://github.com/shitagaki-lab/see-through.git see-through
cd .\see-through
$env:SEE_THROUGH_ROOT = (Get-Location).Path
```

The upstream repository is `shitagaki-lab/see-through`, "Single-image Layer Decomposition for Anime Characters". Its official setup uses Python 3.12:

```powershell
conda create -n see_through python=3.12 -y
conda activate see_through
pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

Create the `assets` link expected by the inference scripts. If symbolic links are blocked by Windows permissions, copy `common\assets` to `assets` instead.

```powershell
New-Item -ItemType SymbolicLink -Path assets -Target common\assets
```

Quick inference smoke test:

```powershell
python inference\scripts\inference_psd.py --srcp assets\test_image.png --save_to_psd
```

Expected output is under:

```text
third_party\see-through\workspace\layerdiff_output\<image-name>\
```

For the Auto Live2D screenshot workflow, use the PSD result as `public/samples/<id>/input.psd`. If this machine already has local NF4 model folders, the lower-VRAM command in [Single Screenshot Workflow](screenshot-to-live2d-workflow.md) can be used instead of the full model command.

## First-Time Setup

```powershell
git clone https://github.com/Fenglin-Maple/AutoLive2d.git
cd AutoLive2d
npm install
```

If dependencies already exist, this is not needed again.

## Start the Editor

```powershell
npm run dev
```

The server binds to:

```text
http://127.0.0.1:5173/
```

If port `5173` is busy, Vite prints the next available URL.

Windows shortcut:

```text
start-dev-server.bat
```

The batch file changes to the project directory, installs dependencies if `node_modules` is missing, and starts the dev server.

## Start the Desktop Shell

For camera tracking while using the OBS/runtime small window, prefer the Electron desktop shell instead of a normal Edge/Chrome tab. The shell still loads the same Vite app, but it disables Chromium background throttling and applies the same setting to runtime popup windows.

```powershell
npm run desktop
```

Windows shortcut:

```text
start-desktop.bat
```

The desktop launcher starts Vite on the first available local port, then opens Electron with `AUTO_LIVE2D_DESKTOP_URL` pointing at that URL. Camera permission is handled by the desktop shell. If the runtime window is placed in front and the editor window is behind it, tracking should keep running because both windows have `backgroundThrottling: false`.

The desktop shell also starts Electron's `prevent-app-suspension` power-save blocker and disables native occlusion throttling. The main editor window defaults to 90% zoom and a larger content size so the UI does not feel oversized compared with the browser build.

When the runtime popup opens, it immediately receives the editor's current parameters, tracking settings, and background state. It also announces readiness through `BroadcastChannel`, so the editor pushes a full state payload without waiting for the editor tracker to emit a frame. The popup can start its own local tracker with the same face/pose settings as the editor, including pose FPS, pose/body/arm limits, and arm reversal.

To recreate the local Windows shortcut with the bundled icon:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/create-shortcut.ps1
```

## Production Build

```powershell
npm run build
```

This runs TypeScript and Vite. Current Vite chunk-size warnings are informational. TypeScript errors are failures.

Preview the built output:

```powershell
npm run preview
```

## Load Built-In Samples

1. Open the local editor URL.
2. Choose a preset from `示例预设`.
3. Click `加载示例 PSD`.

Current presets:

- `u3`: default stable example.
- `u4`: alternate PSD/depth example.
- `u5`: generated screenshot preset.
- `u6`: generated screenshot preset with automatic accessories and expression overlays.

If a sample endpoint fails, check `vite.config.ts` and confirm the PSD exists under `public/samples/<id>/input.psd`.

## Camera Tracking

1. Choose performance tier, resolution, FPS, smoothing, interpolation, and anti-jitter.
2. Set `面捕头部上限` for X/Y/Z.
3. Set the `嘴巴` limit in the same group to cap tracking-driven mouth open.
4. For pose/arm tracking, use `均衡` or `质量` mode and enable `姿态/手臂识别`. Tune `姿态FPS` to `10`, `20`, or `30` depending on hardware, then adjust `姿态`, `手臂`, and the left/right arm rotation reversal checkboxes if a model's arms rotate inward.
5. Click `启动面捕`.
6. The first successful face recognition calibrates the current real head angle as model zero. The first few successful pose frames calibrate current real arm positions as model arm zero.

Notes:

- Balanced and quality modes can both drive head, blink, mouth, iris, small body motion, and optional pose/arm tracking with the lightweight pose model.
- Quality mode keeps the higher face-tracking cadence, but pose/arm tracking still uses the lite pose model in every tier. Pose/arm tracking is smoothed separately from head tracking because MediaPipe pose landmarks are usually noisier than face landmarks.
- Point preview mode hides the camera image and shows landmarks/status only.

## OBS Runtime Use

### Small Window

Click `小窗预览`.

The small runtime window supports:

- synced parameters from the editor, including camera tracking
- synced arm-rotation reversal from the editor
- checker/green/white/black/transparent backgrounds
- collapsible settings panel
- drag to move the whole avatar
- mouse wheel and `缩放` slider to scale the whole avatar
- runtime-only overscan so hats/accessories can render outside the original square canvas

For green-screen OBS capture:

1. Set the runtime background to `绿幕`.
2. Hide the panel if needed.
3. Capture the window in OBS.
4. Add a Chroma Key filter.

If the editor is driving tracking, changing background inside the small window should remain local to the small window and should not be overwritten by tracking sync frames.

The small window's local tracker can run face and pose/arm tracking with the same settings as the editor. If the desktop editor is hidden or throttled, the popup can continue driving the avatar locally instead of falling back to idle.

### Exported Runtime HTML

Click `运行时 HTML` to download a standalone runtime page.

This is useful for OBS Browser Source workflows. The exported HTML includes the runtime controls and rendering logic, but it does not receive live editor tracking sync unless opened through the editor's small-window channel.

## Finished Pack Deployment

Use `成品包 ZIP` after adapting a character.

A finished pack contains:

- `project.json`: ready-to-import project with embedded layer images
- `adapter.json`: adaptation summary
- `template.json`: reusable material-replacement template
- `runtime.html`: standalone runtime preview
- `reference.png`: composite reference
- `layers/*.png`: layer debug images
- `manifest.json`

To deploy on another copy of the project:

1. Start that copy of Auto Live2D Studio.
2. Click `导入成品包`.
3. Select the ZIP.
4. The model should open ready-to-use without AI re-adaptation.

## Template / Material Replacement

Use `模板 JSON` and replacement packs when another PSD has the same structure.

Typical flow:

1. Export a template from an adapted character.
2. Generate a new same-structure character image externally.
3. Split it into PSD with see-through.
4. Import the new PSD.
5. Apply the template.
6. Tune only the parts that changed visually.

## Adding a New Built-In Preset

For a new preset id such as `u7`:

1. Put the PSD at `public/samples/u7/input.psd`.
2. Put optional depth at `public/samples/u7/input_depth.psd`.
3. Put optional source image at `public/samples/u7/source.png`.
4. Add `u7` to `SamplePsdPreset` in `src/lib/psdImport.ts`.
5. Add a label to `samplePresets` in `src/App.tsx`.
6. Add the file path to `samplePsdPaths` in `vite.config.ts`.
7. Add `public/samples/u7/attachments.json` and PNG attachments if needed.
8. Run inspect/build/validation.

Inspect:

```powershell
$env:SAMPLE_PSD_PRESET="u7"
npm run inspect:sample
```

Validate:

```powershell
npm run build
npm run validate:ui -- --preset u7 --out ".rig-validation-u7"
```

## Troubleshooting

### White Screen

- Run `npm run build` and fix TypeScript errors.
- Check browser console for failed sample PSD requests or malformed JSON.
- Ensure `attachments.json` is valid JSON, not an HTML 404 response.

### Sample PSD Load Fails

- Confirm `public/samples/<id>/input.psd` exists.
- Confirm the id is present in `vite.config.ts`, `src/lib/psdImport.ts`, and `src/App.tsx`.
- If the error says `Unexpected token '<'`, the app probably fetched an HTML error page instead of JSON/PSD data.

### Camera Opens But Tracking Does Not Move

- Use balanced or quality tier.
- Raise camera resolution to 960x540 or 1280x720.
- Check browser camera permission.
- Make sure the first visible face frame succeeded; that frame becomes calibration zero.
- Lower anti-jitter only if normal movement is being rejected.
- If this happens only when Edge/Chrome is in the background and the runtime popup is in front, use `start-desktop.bat` or `npm run desktop`.

### Mouth Tracking Too Large

- Lower `嘴巴` in `面捕头部上限`.
- The tracking mapping already uses a softened curve, so manual mouth sliders and expression presets remain more expressive than camera tracking.

### Runtime Background Resets During Tracking

- In current runtime, once the small window background is changed locally, tracking sync should not overwrite it.
- If it still resets, check `localBackgroundOverride` in `src/lib/runtimeExport.ts`.

### Hats Or Props Are Clipped In Runtime

- Current runtime uses 28% overscan around the original square canvas.
- If a prop extends beyond that, either move/scale the prop closer or increase `runtimeOverscan` in `src/lib/runtimeExport.ts`.
- Main editor clipping is intentionally unchanged.

### OBS Capture

- Window capture can use the small runtime window.
- Browser Source can use exported `runtime.html`.
- Use green background plus Chroma Key, or transparent background when the capture path supports alpha.

## Handoff Checklist

Before declaring a deployment ready:

1. `npm run build` passes.
2. `u3` loads.
3. Target preset loads.
4. Head/eyes/mouth/body/arms/hair/expression checks pass.
5. Runtime small window opens on the user's machine.
6. OBS background mode behaves as expected.
7. Finished pack import/export is tested for the target character.
