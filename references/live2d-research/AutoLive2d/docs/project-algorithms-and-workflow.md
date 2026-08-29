# Auto Live2D Studio Algorithms and Workflow

This document summarizes the project internals for future agents adapting PSDs or changing rig behavior.

## Main Pipeline

1. Import a normalized character PSD.
2. Flatten visible leaf layers and classify each layer into semantic parts.
3. Auto split paired layers when needed: eyes, irises, lashes, brows, arms, and hands.
4. Build a regular mesh for each layer and attach default deformers.
5. Assign parent bones, recommended z-order, physics templates, pivots, and pseudo-Z.
6. Render every layer through the mesh deformation pipeline.
7. Optionally apply proxy-head projection for head parts.
8. Drive parameters manually, through expression presets, or through MediaPipe tracking.
9. Mount obj/expression differential PSDs, sample companion PNG layers, or manifest-defined clone layers when a generated split has extra parts, volume-fill layers, or expression overlays.
10. Export project/template/runtime/replacement/finished packs.

## Detailed End-to-End Algorithm

All geometry is stored in normalized canvas coordinates. `x=0..1` maps left to right, `y=0..1` maps top to bottom, and vertex pseudo-Z is a small signed depth value used only by the deformation/projection math. Draw order is still controlled by layer `z`; pseudo-Z must never let a lower visual layer pass above a higher visual layer.

The complete flow is:

1. Source normalization
   - A source image or PSD should be front-facing and upper-body, preferably T-pose or relaxed T-pose.
   - The character should fit the 768 square composition used by the current samples.
   - Large accessories, hats, glasses, and expression variants should be generated as full-character differentials first, then split/cropped. Do not generate tiny isolated eye/mouth icons unless they already match the base face perspective, paint style, and eye spacing.

2. PSD parsing and layer extraction
   - `src/lib/psdImport.ts` reads PSDs with `ag-psd`.
   - Visible leaf layers become transparent PNG data URLs.
   - Each layer receives `bounds` and `naturalBounds` in normalized coordinates.
   - Fine facial features are alpha-cropped so full-canvas PSD layers do not produce huge, uneditable meshes.
   - Layer names are classified by `src/lib/classify.ts`.

3. Semantic repair
   - Paired eyes, irises, lashes, brows, arms, and hands can be split by the center alpha valley.
   - Arms default under torso/topwear.
   - Neck, face, facial features, hair, and accessories are assigned to the body/head hierarchy.
   - Unknown or non-standard layers become `obj` attachments instead of being discarded.

4. Initial binding
   - `src/lib/mesh.ts` creates a regular mesh per layer.
   - Hair/accessories receive denser meshes than small facial details because inertia is applied per vertex.
   - `makeDefaultDeformers` adds parameter keyforms for head X/Y/Z, mouth scale, body motion, breath, and hair/accessory offsets.
   - `defaultPivotForKind` assigns pivots. Arm/hand pivots should be at the shoulder root, not the crop center.
   - `recommendedPhysicsTemplate` assigns hair, cloth, accessory, and arm follow templates.

5. Parameter evaluation
   - Parameters come from sliders, expression presets, saved snapshots, or MediaPipe tracking.
   - `src/lib/preview.ts` converts parameters into layer-level motion: body carrier, head carrier, arm rotation, mouth visibility, physics, and opacity.
   - Body motion is the root for neck and head. Head motion is always body motion plus head-local motion, preventing the neck/head "decapitation" gap.
   - Arm raise uses screen-space outward rotation: left-side arms rotate positive, right-side arms rotate negative. This is mirrored in `src/lib/runtimeExport.ts`.

6. Vertex deformation
   - `src/lib/deform3d.ts` starts from saved mesh vertices.
   - Parameter keyframes deform vertices around a pivot.
   - Mouth open scales around the mouth center; vertical translation is suppressed so the mouth does not drift on the face.
   - Manual pseudo-Z uses saved `mesh.depths`, compressed by `compactManualDepth` to reduce tearing.
   - Proxy-head pseudo-Z projects head vertices to an eye-centered ellipsoid for rounded head X/Y turns.
   - Head Z is planar roll around the adjustable neck/head pivot, then combined with current projection.
   - Hair/cloth/accessory inertia is weighted by vertex position so roots stay near the face/body while tips drag.
   - Iris vertices are clamped to the current eye socket; vertical overshoot is allowed, but clipped by the socket mask.

7. Rendering and picking
   - Each non-proxy layer renders through a full-stage canvas using triangle texture mapping.
   - Proxy-head mode composites head parts by z and projected depth but still respects layer z priority.
   - Selection hit testing reads the canvas alpha at the pointer. Transparent pixels no longer select the rectangular canvas.
   - Selected layer highlight uses alpha-shaped `drop-shadow`, so the actual opaque silhouette glows rather than the PNG rectangle.
   - Manual X/Y editing may move a layer partly outside the canvas. This is required for hats, wings, and props whose crop extends beyond the visible frame.

8. Companion layers and differentials
   - Built-in sample companion layers are loaded by `src/lib/sampleAttachments.ts`.
   - Companion bounds may be negative or extend beyond `1.0`; the stage clips the visible result.
   - Object differentials store `attachment.type="object"` and inherit the chosen parent bone/standard part motion.
   - Expression differentials store `attachment.type="expression"`, `exclusiveGroup`, and `expressionKey`.
   - Only the active expression key in a group renders. Use one group for competing eye states and separate groups for stackable effects such as blush.

9. Tracking and runtime
   - `src/lib/tracking.ts` maps MediaPipe landmarks to head, blink, mouth, iris, body, and optional arm parameters.
   - First successful face tracking is the head/eye zero. The first several successful arm-pose frames are averaged into left/right arm zero, so starting tracking does not immediately rotate the avatar arms.
   - Interpolation, forced smoothing, anti-jitter, arm dead zones, and arm rate limits protect the model from landmark jumps.
   - Tracking-driven mouth open is softened and clamped by `tracking.mouthOpenLimit`; manual mouth sliders and expression presets remain free to use the full rig range.
   - Arm rotation can be reversed per side with `tracking.armRotationReverse` when a model's shoulder/arm sign convention is inverted.
   - `src/lib/runtimeExport.ts` mirrors the editor rendering math for standalone preview/OBS use, including arm rotation reversal.
   - Runtime preview supports local background override, collapsible controls, whole-avatar drag, wheel/slider scale, and runtime-only overscan so out-of-frame hats/accessories can render beyond the original square canvas.

## PSD Import

Importer: `src/lib/psdImport.ts`.

- Uses `ag-psd` to read the PSD.
- Leaf layers are converted into PNG data URLs.
- Layer names are classified by `src/lib/classify.ts`.
- Full-canvas fine features are alpha-cropped before mesh generation.
- Center alpha-valley splitting handles merged left/right eyes, irises, lashes, brows, arms, and hands.
- Recommended z-order is applied, but the layer panel can override `z`.
- Built-in presets are served by `vite.config.ts` through `/api/sample-psd?preset=<id>`.

Current preset files live under:

- `public/samples/u3/input.psd`
- `public/samples/u4/input.psd`
- `public/samples/u5/input.psd`
- `public/samples/u6/input.psd`

`u5` was generated from a game screenshot through multi-image `gpt-image-2` editing, using the screenshot as identity reference and a clean green-screen upper-body portrait as composition reference. The resulting image is saved at `public/samples/u5/source.png`; the PSD/depth PSD were produced by see-through with local NF4 models at 768 resolution, 15 steps, and CPU offload.

`u6` follows the same screenshot pipeline, but uses a no-hat/no-glasses main PSD and a companion manifest at `public/samples/u6/attachments.json`. The manifest injects image2-derived hat/glasses `obj` layers and generated expression PNG overlays when the u6 sample is loaded.

The complete single-screenshot-to-finished-rig workflow is documented in `docs/screenshot-to-live2d-workflow.md`.

To add `u5` or later:

1. Put the PSD at `public/samples/u5/input.psd`.
2. Extend `SamplePsdPreset` in `src/lib/psdImport.ts`.
3. Extend `samplePresets` in `src/App.tsx`.
4. Extend `samplePsdPaths` in `vite.config.ts`.
5. If companion layers are needed, add `public/samples/<id>/attachments.json` plus transparent PNGs under `public/samples/<id>/attachments/`.
6. Run `npm run inspect:sample` with `SAMPLE_PSD_PRESET=<id>`.

## Mesh and Keyform Deformation

Mesh generation: `src/lib/mesh.ts`.

- Most facial parts use small meshes.
- Front/side/back hair and accessories use denser meshes for tail inertia.
- Default deformers bind part motion to parameters such as head angle, mouth open, blink, body angle, arms, and breath.

Mesh deformation: `src/lib/deform3d.ts`.

Order of operations:

1. Start from layer mesh vertices.
2. Apply per-layer local scale/rotation around the layer geometric center.
3. Apply parameter keyform deformers.
4. Compute pseudo-3D projection from manual depth or proxy-head depth.
5. Apply parent/body/head motion.
6. Apply cloth or hair tail dynamics.
7. Apply blink deformation.
8. Clamp irises inside the current eye socket.

Mouth open is centered on the mouth pivot and does not translate vertically. `mouthOpenScaleLimit` caps or extends the maximum mouth scale; values above `1.0` add an extra second-stage mouth scale, and the editor currently allows tuning up to `2.4` (240%).

## Manual Pseudo-Z

Manual pseudo-Z uses per-vertex depth stored in each layer mesh.

- `compactManualDepth` narrows saved depth into a stable range so layers do not tear apart.
- `faceNeckBlend` moves lower face depth toward neck depth.
- `frontHairNeckBlend` and `backHairNeckBlend` tune hair distance relative to neck/face.
- `chinShrink` reduces oversized chin projection during head turns.
- `eyeVerticalOvershoot` lets irises travel beyond the eye opening while clipping hides overflow.

## Proxy Head Model

Proxy-head mode approximates the head as an ellipsoid centered near the midpoint between both eyes.

Important functions:

- `headShellForKind`
- `proxyHeadDepth`
- `proxyHeadPoint3d`
- `projectProxyHeadPoint`

The idea is not to wrap the whole transparent PNG as a flat sticker. Instead, every mesh vertex is projected onto a pseudo head shell:

- Face and facial details sit on the front shell.
- Front hair/side hair/accessories sit slightly above the front shell.
- Back hair sits on a farther/back shell.
- Layer z-order remains dominant so back parts cannot visually pass in front of front layers.

Head X/Y uses pseudo-3D projection. Head Z is treated as planar roll around an adjustable neck/head pivot, then combined with the current proxy projection.

## Eye System

- Eye socket bounds are inferred from eye-white or lash layers.
- Iris movement is clamped to the socket with controlled vertical overshoot.
- The visible iris is clipped by an almond-shaped socket path.
- Blink is driven by lashes/eye whites; irises recover color quickly after blink so eye-white does not show as a long white flash.
- Left and right blink are tracked independently.

## Hair and Cloth Dynamics

Dynamics are split into root motion and tail motion.

- Hair roots use reduced physics/breath offsets so they stay close to the face/head.
- Tail vertices receive stronger motion based on vertical mesh position.
- Spring state is kept per dynamic hair/accessory layer.
- Back hair generally has the highest inertia; front/side strands and dangling accessories use medium inertia.
- Top-wear physics is weighted so collar/neck vertices stay welded while lower cloth can breathe/sway.

Runtime export mirrors these calculations in `src/lib/runtimeExport.ts`.

## Obj and Expression Attachments

Non-standard accessory/object layers are imported as `obj` attachments. They remain normal mesh layers, but store attachment metadata so agents can re-parent them to a standard layer/bone. This is used for hats, loose props, feathers, and other differential layers.

Built-in sample companion layers are loaded by `src/lib/sampleAttachments.ts`. A sample may ship `attachments.json` and transparent PNG crops; the loader turns each item into a data-URL mesh layer with the declared kind, parent bone, z-order, physics template, inertia scale, local scale/rotation, and attachment metadata. This makes presets such as `u6` open as already-adapted characters without asking a future agent to manually import every differential layer.

Companion layers may also use `cloneOf` instead of `file`. A clone layer specifies a source kind/name and can specify a `depthTargetKind` plus `depthRatio`; the loader copies the imported PSD layer and shifts its average pseudo-Z toward the target layer average. Use low opacity for these layers. They are volume fillers, not replacement art. The u6 preset uses this to place front/back hair clone layers between the original hair shells and the face plate. Keep the clone's draw `z` in its visible layer band, even if its mesh pseudo-Z is blended toward another part. For example, a back-hair volume clone should still draw in the back-hair band so proxy-head compositing does not lift the whole back-hair canvas over face/body layers. The loader writes `attachment.cloneKind` for clone layers so `frontHairCloneNeckBlend` and `backHairCloneNeckBlend` can tune only clone layers while older non-clone presets keep the normal front/back hair sliders.

Attachment metadata can also specify `proxyGroup` and `depthAnchor`. `proxyGroup: "back"` forces a head accessory into the proxy-head back composite, useful for hat rear layers that must stay behind back hair. `depthAnchor: "neck"` keeps the layer's normal parent/motion but uses neck pseudo-Z during projection, useful for low-opacity accessory volume fillers.

Accessory companion layers are allowed to extend beyond the canvas. This matters for hats: a hat crop may need negative `y` so the crown can sit above the visible frame while the brim still covers only the top hair/forehead. Do not clamp accessory bounds back to `0..1` during import.

Expression differential PSDs are imported as `expression` attachments. Each expression layer has an `exclusiveGroup` and `expressionKey`; only the active key for that group is rendered. This supports competitive eye expressions such as heart eyes, spiral eyes, glowing eyes, shocked eyes, blush overlays, and mouth cavity patches.

Expression differentials should normally be generated as full-character images with the same pose, head angle, eye spacing, and paint style as the base portrait. After generation, split the full differential with see-through and crop the useful eye/mouth/face patch from that PSD. This is more reliable than asking image2 for isolated eye or mouth icons, which often creates mismatched symbols that do not align with the base face. The current u6 heart-eye and open-mouth patches follow this full-image -> see-through -> crop path.

Finished pack export lives in `src/lib/finishedPack.ts`. It writes a ZIP with `project.json`, `adapter.json`, `template.json`, `runtime.html`, `reference.png`, and per-layer PNGs. `project.json` embeds the adapted layer images, so a recipient can import the pack without re-running PSD adaptation.

## Tracking

Tracking controller: `src/lib/tracking.ts`.

Face tracking uses MediaPipe `FaceLandmarker`.

Supported outputs:

- head yaw/pitch/roll
- left/right blink
- mouth open/form
- iris X/Y
- small body motion
- optional pose-driven arm/body tracking in balanced and quality modes

Stabilization and pose settings:

- `interpolationMultiplier`: emits in-between states between recognition frames. Default is `2x`.
- `forceSmoothing`: enforces a minimum smoothing strength.
- `antiJitter`: discards sudden short-time landmark jumps and keeps smoothing from the current pose.
- `eyeYGain`: multiplies tracked vertical iris response.
- `mouthOpenLimit`: caps camera-driven mouth open. The mapping uses a softened curve before clamping so a slight real mouth opening does not immediately create a very large model mouth.
- `poseLimit`: scales camera-driven body motion. Default is `1`; the UI allows higher values for models that need stronger pose response.
- `armLimit`: scales camera-driven arm raise. Default is `1`; the UI allows higher values for models that need stronger arm response.
- `poseFps`: caps pose/arm recognition to `10`, `20`, or `30` FPS. All performance tiers use the lightweight pose model; quality mode keeps its higher face cadence but does not switch pose to the full model.
- `armRotationReverse.left/right`: flips the final rendered arm rotation direction for PSDs whose arm layers rotate inward with the default sign.

The first successful face recognition is used as head calibration zero, so a side-mounted camera does not force the avatar to start angled. Pose/arm tracking uses a separate arm-zero calibration: the first few successful pose frames define the current left/right arm positions as zero, and only movement relative to that baseline drives `ParamArmLA` / `ParamArmRA`.

## Runtime / OBS Preview

Runtime export lives in `src/lib/runtimeExport.ts`. It is a standalone HTML renderer that mirrors the editor's mesh, pseudo-Z, eye clamp, blink, expression-mouth, and hair/cloth dynamics math.

Editor-opened small windows receive live parameter, expression, tracking settings, and background state through `BroadcastChannel`. The popup announces `auto-live2d:runtime-ready` as soon as its channel is created, and the editor immediately sends the full current state instead of waiting for the editor tracker to emit a frame. Later changes to tracking settings are also broadcast, so pose FPS, pose/body/arm limits, arm reversal, and angle limits stay aligned. When editor tracking parameters are arriving, the popup stops any local tracker and treats the editor's final parameter payload as the single animation source, keeping editor and popup motion identical for synchronized tracking.

The popup also contains a local tracker for independent use or editor-background fallback. It uses the same face-to-parameter mapping as the editor and can load the lightweight pose model for body and arm tracking when `poseEnabled` is true. The popup uses the same low-resolution pose analysis frame as the editor to avoid freezing the avatar when pose recognition is enabled.

The runtime UI has:

- background mode selector: checker, green, white, black, transparent
- idle toggle
- whole-avatar scale slider
- parameter sliders
- expression buttons
- collapsible settings panel

Viewport controls:

- Drag the avatar stage to move the whole model for OBS framing. This changes only the runtime container transform, not rig coordinates.
- Use the mouse wheel over the stage or the `缩放` slider to scale the whole model from 35% to 220%.
- Press `H` or double-click the stage to toggle the settings panel.

Runtime-only overscan:

- The editor stage still uses the original project canvas.
- Runtime layer canvases are expanded by `runtimeOverscan = 0.28`.
- Original normalized coordinates are drawn into the center of the expanded canvas, so vertices with negative coordinates or coordinates above `1.0` remain visible in the small window.
- This is intended for hats, wings, props, and other accessories that should be visible for OBS even when they extend outside the square PSD canvas.

## Validation Flow

For any rig or algorithm change:

1. Run `npm run build`.
2. Load u3 and u4 presets.
3. Check manual and proxy-head modes.
4. Test expressions and parameter extremes.
5. Check iris X/Y, blink recovery, mouth open, arms, body chain, hair inertia, and background modes.
6. Test tracking tiers and the point-only preview mode.
7. Export runtime HTML if runtime code changed.

See `docs/rig-validation-checklist.md` for the operational checklist.
