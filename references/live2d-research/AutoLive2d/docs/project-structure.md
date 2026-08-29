# Project Structure

This document explains where future agents should look before changing Auto Live2D Studio.

## Root

```text
AutoLive2d/
  AGENTS.md
  LICENSE
  NOTICE
  index.html
  package.json
  package-lock.json
  start-desktop.bat
  start-dev-server.bat
  tsconfig.json
  vite.config.ts
  desktop/
  src/
  public/
  scripts/
  docs/
  third_party/see-through/
```

- `package.json`: npm scripts and dependencies.
- `vite.config.ts`: Vite React config plus the `/api/sample-psd?preset=<id>` development endpoint.
- `start-dev-server.bat`: Windows helper that installs dependencies if needed and starts the dev server.
- `start-desktop.bat`: Windows helper for the Electron shell used by camera tracking and OBS preview.
- `AGENTS.md`: concise task routing and invariants for coding agents.
- `third_party/see-through`: vendored Apache-2.0 image-to-PSD splitter with local Windows, WebUI, and low-VRAM changes.
- `.gitignore`: ignores dependencies, build output, model weights, inference workspaces, local validation images, secrets, and logs.

## Source Tree

```text
src/
  main.tsx
  App.tsx
  styles.css
  types/rig.ts
  lib/
```

### `src/main.tsx`

React entry point. It mounts `App` into the page.

### `src/App.tsx`

Main editor UI and orchestration layer.

Responsibilities:

- sample PSD loading
- project state
- canvas stage
- selection and alpha hit testing
- parameter sliders and expression presets
- tracking panel
- layer, bone, widget, binding, depth, inertia, and coordinate editors
- draft save/load
- replacement/template/runtime/finished-pack import/export
- small runtime popup sync through `BroadcastChannel`

Most visible UI changes start here, but geometry and rendering behavior usually belongs in `src/lib`.

### `src/styles.css`

Editor layout, panels, canvas stage, controls, dark/light theme, and stage background styling.

### `src/types/rig.ts`

Central data model. Important types:

- `RigProject`
- `PsdLayerAsset`
- `MeshBinding`
- `DeformerBinding`
- `DepthTuning`
- `DynamicsTuning`
- `TrackingSettings`
- `TrackingState`
- `LayerAttachment`

Change this file when a field must survive project/template/finished-pack serialization.

## Library Modules

### `src/lib/classify.ts`

Layer-name classification. It maps PSD layer names into semantic part kinds and side labels.

Use this when a new split tool or naming convention produces unknown layers that should be standard parts.

### `src/lib/defaults.ts`

Default bones, parameters, physics templates, depth tuning, dynamics tuning, and tracking settings.

Important defaults include:

- `defaultParameters`
- `defaultDepthTuning`
- `defaultDynamicsTuning`
- `defaultTrackingSettings`
- `defaultHeadRollPivot`
- `maxMouthOpenScaleLimit`

### `src/lib/psdImport.ts`

PSD import pipeline.

Responsibilities:

- read PSD with `ag-psd`
- flatten visible leaf layers into PNG data URLs
- alpha-crop fine facial details
- classify layer names
- split merged paired layers by center alpha valley
- assign bounds, z-order, parent bones, meshes, deformers, pivots, and physics templates
- load built-in sample PSDs from `/api/sample-psd`

### `src/lib/mesh.ts`

Mesh and deformer defaults.

Responsibilities:

- regular grid mesh generation
- per-kind mesh density
- default keyform deformers
- part pivots
- recommended z-order and physics template assignment

### `src/lib/deform3d.ts`

Core editor mesh deformation.

Order of operations:

1. local layer scale/rotation
2. keyform deformers
3. expression-mouth close/open compression
4. manual or proxy-head pseudo-3D projection
5. body/head/parent motion
6. hair/cloth/accessory dynamic tail deformation
7. blink deformation
8. iris socket clamp

This is the main file for pseudo-Z, proxy-head, chin shrink, mouth scaling, blink, iris clamp, and dynamic hair shape.

### `src/lib/preview.ts`

Parameter-to-layer-motion mapping.

Responsibilities:

- tracking state to rig parameters
- body carrier and head carrier transforms
- arm rotation, including per-side rotation reversal from tracking settings
- opacity for mouth/eyes/expression layers
- physics offsets and spring-style runtime values

Face tracking mouth sensitivity and mouth-open tracking upper limit live here.

### `src/lib/tracking.ts`

MediaPipe camera tracking.

Responsibilities:

- load `FaceLandmarker` and optional pose logic
- request camera streams
- produce normalized head, blink, mouth, iris, body, and arm values
- first-frame face calibration zero
- averaged initial arm-pose calibration zero
- interpolation, smoothing, anti-jitter, arm dead zones, and arm rate limits

### `src/lib/depthMap.ts`

Depth-map import and conversion into per-vertex pseudo-Z.

### `src/lib/safetyLimits.ts`

Automatic parameter safety ranges. It estimates head/body limits that avoid broken separation for a new PSD.

### `src/lib/sampleAttachments.ts`

Built-in companion-layer loader for presets such as `u6`.

Reads:

```text
public/samples/<id>/attachments.json
public/samples/<id>/attachments/*.png
```

Supports:

- object attachments
- expression attachments
- clone layers
- proxy grouping
- depth anchoring
- local scale/rotation
- inertia scale

### `src/lib/template.ts`

Template export/apply workflow. Use this for material replacement between already-adapted projects with the same structure.

### `src/lib/replacementPack.ts`

Exports a material-replacement ZIP with structure/reference information for external AI image generation.

### `src/lib/finishedPack.ts`

Exports and imports finished packs. A finished pack contains a ready project with embedded layer images, runtime HTML, template, adapter summary, reference image, layer PNGs, and manifest.

### `src/lib/runtimeExport.ts`

Standalone runtime HTML generator.

The runtime mirrors the editor's deformation math for OBS/small-window use. It includes:

- parameter controls
- expression controls
- background modes
- synced state from the editor through `BroadcastChannel`
- synced editor tracking parameters/settings, including arm rotation reversal
- collapsible panel
- whole-avatar drag
- wheel and slider scale
- runtime-only overscan canvas so out-of-frame hats/accessories remain visible
- eye socket clipping and expression-mouth close/open logic

Do not edit only `deform3d.ts` when changing deformation behavior. If runtime should match the editor, mirror the relevant behavior here too.

## Public Assets

```text
public/samples/
  u3/
  u4/
  u5/
  u6/
```

Each preset usually contains:

- `input.psd`
- optional `input_depth.psd`
- optional `source.png`
- optional `attachments.json`
- optional `attachments/*.png`

The current default sample is `u3`.

## Scripts

### `scripts/inspect-sample-psd.mjs`

Inspects the selected built-in PSD and prints layer/classification information.

### `scripts/validate-ui-flow.mjs`

Playwright regression flow. It loads a sample, captures neutral/expression/extreme screenshots, and checks that the import report is sane. Generated screenshots still need human review.

## Documentation

```text
docs/
  project-algorithms-and-workflow.md
  project-structure.md
  psd-adaptation-guide.md
  screenshot-to-live2d-workflow.md
  deployment-guide.md
  rig-validation-checklist.md
  assets/
```

Future agents should read README first, then the specific document for their task.

## Generated and Ignored Files

- `node_modules/`: installed dependencies.
- `dist/`: production build output.
- `.vite/`: Vite cache.
- `.playwright-*` and `.rig-validation-*`: historical validation screenshots in this workspace. They are not source files and should not be committed unless a user explicitly asks for a visual artifact archive.
- `outputs/`: generated experiment outputs.
