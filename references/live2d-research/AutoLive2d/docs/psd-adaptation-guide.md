# PSD Adaptation Guide for Auto Live2D Studio

This guide is for future AI agents adapting new normalized PSD characters to this project.

## Current Built-In Presets

- `u3` is the default startup example and should remain the first regression target.
- `u4` is a selectable example preset in the import panel.
- `u5` is the first screenshot-to-character generated preset.
- `u6` is a screenshot-generated preset with automatic companion obj/expression PNG layers.
- Built-in PSD files live under `public/samples/<preset>/input.psd`.
- Optional depth maps can be stored next to the PSD, for example `public/samples/u4/input_depth.psd`.
- Optional auto-mounted companion layers live at `public/samples/<preset>/attachments.json` and `public/samples/<preset>/attachments/*.png`.

To add a new preset:

1. Copy the adapted PSD to `public/samples/<id>/input.psd`.
2. Add the id to `SamplePsdPreset` in `src/lib/psdImport.ts`.
3. Add the id and label to `samplePresets` in `src/App.tsx`.
4. Add the id to `samplePsdPaths` in `vite.config.ts`.
5. Add `attachments.json` if the preset needs built-in hats, glasses, props, expression overlays, or other ready-to-open differentials.
6. Run `SAMPLE_PSD_PRESET=<id> npm run inspect:sample`.
7. Run UI validation for the preset with `npm run validate:ui -- --preset <id>` after the dev server is running.

## PSD Structure Target

- Use a front-facing T-pose or near T-pose character when possible.
- Keep one semantic body part per layer. Separate left/right layers are best.
- If both eyes, irises, lashes, brows, arms, or hands are in one layer, the importer can split them from the center alpha valley, but manual separation is more reliable.
- Keep transparent padding reasonable. Very tiny junk layers should be removed before import.
- Use readable layer names. English, Chinese, or mixed names are fine if they contain hints such as `face`, `front hair`, `back hair`, `side hair`, `eye`, `iris`, `eyelash`, `brow`, `mouth`, `nose`, `neck`, `body`, `top`, `arm`, `hand`, or equivalent Chinese words.
- See-through category names such as `topwear`, `bottomwear`, `handwear`, `headwear`, `neckwear`, `eyewear`, `tail`, `wings`, and `objects` are accepted by the importer. `tail/wings`, `objects`, hats, ornaments, and other non-standard accessory layers are imported as `obj` attachments unless manually changed.
- Do not flatten shadows/highlights from one body part into another. Face shadows should stay with face or a face overlay, not with hair.

## Recommended Layer Set

- Back hair: behind face, neck, and body. Default pseudo-Z should be farther than neck.
- Torso/top wear: the main body anchor. Arms default below the torso.
- Neck: visually welded to the upper torso/collarbone. Neck and the top edge of clothes should use close pseudo-Z near their shared vertices.
- Face plate: one opaque or mostly opaque face base.
- Facial details: eye whites, irises, lashes/lids, brows, nose, and mouth. These are head children and must follow the face completely.
- Front/side hair: above the face. Long strands need denser meshes and tail-weighted physics.
- Accessories: hair ornaments should usually be head or front-hair children. Dangling feathers/tassels should get accessory inertia.

## Z Order

Larger `z` draws above smaller `z`.

Suggested order from back to front:

`back hair -> arms/hands -> torso/top wear -> neck -> face/ears -> eye whites -> irises -> mouth/nose -> brows/lashes -> side hair -> front hair -> accessories`

Head proxy mode must still respect this layer order. A farther pseudo-Z must not let a back layer pass in front of a front layer.

## Pseudo-Z and Head Proxy

- Manual depth and proxy-head depth should both render acceptably.
- The proxy ellipsoid center should be near the midpoint between the eyes, not low near the chin.
- Use `faceNeckBlend` to bring lower-face depth closer to the neck when the head/neck connection separates.
- Use `frontHairNeckBlend` to pull bangs/side strands closer to the neck and face while keeping them visually above the face.
- Use `backHairNeckBlend` to tune how close back hair sits to the neck. Start farther by default, then blend closer only as needed.
- Use `chinShrink` when the chin stays too large during head X/Y turns.
- Use `eyeVerticalOvershoot` so irises can move vertically beyond the socket while clipping hides the overflow.
- Use `mouthOpenScaleLimit` to cap how large the mouth can grow. Mouth open should scale around its own center and must not translate vertically on the face. The editor currently allows values up to `2.4` (240%) for oversized/open-mouth styles.
- Object/accessory layers may intentionally extend outside the normalized canvas. Hats, wings, capes, and props can use negative `x/y` or coordinates above `1.0`; the stage clips the visible result. Do not force these layers back inside `0..1` if the visible placement needs overflow.
- The component coordinate panel can set per-layer X, Y, draw Z, average pseudo-Z, local scale, and local rotation. Local scale/rotation are non-destructive vertex transforms around the layer geometric center and are saved in project/template/finished-pack exports.

## Hair Dynamics

- Hair roots should stay close to face/head motion. Root-level breath and physics offsets should be small.
- Hair tips should carry most inertia. The current implementation weights tail deformation by vertex `v`, so lower vertices move more than roots.
- Back hair should usually have the strongest inertia and the densest mesh.
- Side hair/front long strands should have medium inertia. Short bangs need less.
- Accessories use their own inertia, especially feather or tassel tips.
- Mesh density matters: for long hair, prefer at least `11 x 8`; for broad back hair, prefer `14 x 8` or denser if performance is acceptable.

## Bones and Pivots

- Body is the parent of neck.
- Neck is the parent of head.
- Face, eyes, brows, mouth, ears, front hair, side hair, back hair, and hair accessories are head children unless intentionally attached elsewhere.
- Arms and hands are body children.
- Arm pivots should be near the shoulder root, slightly outside the arm crop if that preserves a wider shoulder connection during arm raise.
- Test arm raise visually. With the default screen-space convention, the viewer-left/character-left arm rotates outward to the left, and the viewer-right/character-right arm rotates outward to the right. If one side folds inward, enable that side's `左臂旋转反转` / `右臂旋转反转` tracking option instead of renaming or re-cutting the layer.
- Body tracking should be small. Head motion is body motion plus head-local motion, never independent from the body chain.

## Adaptation Flow

1. Import the PSD and inspect the import report.
2. Fix unknown critical standard layers by renaming layers or manually assigning kind/side. Non-standard extras should stay as `obj` attachments and be parented to the nearest standard part.
3. Check automatic left/right splits for eyes, brows, lashes, irises, arms, and hands.
4. Fix `z` order so arms are under torso and facial details are above face.
5. Compare manual depth and proxy-head depth at head X/Y extremes.
6. Tune pseudo-Z and face sliders: face-to-neck, front-hair-to-neck, back-hair-to-neck, chin shrink, eye vertical overshoot, and mouth open scale limit.
7. Select each arm and tune pivot X/Y until the shoulder connection stays wide during arm raise.
8. Test the per-side arm rotation reversal checkboxes and keep the setting with the project/template if the PSD's arm direction is inverted.
9. Check blink, left blink, right blink, mouth open, iris X/Y, head X/Y/Z, body X/Y/Z, breath, and hair/accessory inertia.
10. Save a parameter snapshot after tuning.
11. Export project JSON and template JSON before using the PSD as a template for texture replacement.
12. Export a finished pack ZIP when the character should be handed to another deployment of this project.

## Differential PSDs

- Use `挂载 obj PSD` for no-hat/hat-front/hat-back/prop differential splits.
- Use `表情差分 PSD` for heart eyes, shocked eyes, blush, mouth cavity, glowing eyes, white eye rings, and spiral eyes.
- Expression layers should use one `exclusiveGroup` when they compete, for example `eye-expression`.
- Use separate groups when effects can stack, for example `eye-expression` and `face-overlay`.

Accessory differential rules:

- For hats, generate at least a no-hat base and a full-character with-hat differential. Prefer one additional prompt/image for a hat-only transparent reference if image2 can preserve alignment.
- Split the hat into rear/crown and front/brim only after checking the full-character placement. The rear/crown layer usually sits behind front hair; the brim/front layer sits above front hair and may cover only the upper hair/forehead.
- If separate generated hat front/back images drift in style or crop, generate one complete standalone hat instead. Remove any fake checkerboard background by edge-connected flood fill, then cut the hat by a user-approved brim guide line. Use the full image for the back layer and clone filler, and only the guide-line-above region for the front layer.
- Crop only opaque hat pixels. Do not leave face, hair, glasses, or checker/background material in the hat PNG.
- Glasses should be a face child. Crop them as a standalone eyewear layer; do not include hat brim material above the glasses.
- If a crop needs to sit above the canvas, record negative `bounds.y` in `attachments.json` instead of scaling the whole accessory smaller.

Expression differential rules:

- Prefer full-character expression differentials over isolated symbols. Prompt image2 to keep the exact same head pose, eye spacing, face shape, lighting, and line art, changing only the target expression.
- Run the full expression image through see-through, then take the useful eye/mouth/face PSD layer or crop. This keeps the style and perspective closer to the base portrait.
- Avoid shipping tiny standalone icon overlays if they do not match the base eye position. A heart-eye overlay may be cute but is invalid if it floats away from the original iris/eye socket.
- For mouth-open patches, obtain an oral cavity from a full open-mouth portrait; the patch should look like the same character's anime mouth, not a generic emoji mouth.
- If no high-quality full differential is available, leave the expression out or mark it experimental rather than silently adding a visibly mismatched overlay.
- For left/right eye overlays, set `kind: "iris"` and the correct `side` so the normal iris clamp and eye movement apply. Then hide glasses during QA and compare the expression overlay alpha center against the standard iris alpha center. If the symbol is off-center, shift the painted pixels inside the PNG frame; do not alter the standard iris layer or eye movement math.
- For open-mouth overlays, compare the expression mouth alpha center against the standard mouth alpha center at closed and open states. If it drifts above or below the standard mouth, adjust the expression layer `bounds` so the patch center is locked to the standard mouth center.

For built-in examples, transparent PNG companion layers can replace manual differential PSD imports:

- Put cropped transparent PNGs under `public/samples/<id>/attachments/`.
- Record normalized bounds, kind, parent bone, z, physics, and attachment metadata in `attachments.json`.
- For volume-fill experiments, use `cloneOf` entries in `attachments.json` instead of duplicating PNG files. A clone copies an imported PSD layer and can blend its average pseudo-Z toward a target kind such as `face`; keep clone opacity low and verify head-turn extremes. Do not raise a back-hair clone's draw `z` just because its pseudo-Z is near the face; keep draw order in the back-hair band. Clone front/back hair can be tuned separately with `frontHairCloneNeckBlend` and `backHairCloneNeckBlend`.
- Use `attachment.proxyGroup: "back"` for head accessories that must render in the proxy-head back composite, such as a hat rear layer. Use `attachment.depthAnchor: "neck"` for low-opacity volume fillers that should follow the head but project at neck pseudo-Z.
- Use `object` attachments for hats, glasses, props, feathers, and cleanup patches.
- Use `expression` attachments for eye/mouth/face overlays.
- Keep competing eye variants in the same `exclusiveGroup`, usually `eye-expression`.

## Runtime and OBS Notes

- The editor supports checker, green, white, black, and transparent backgrounds.
- OBS can capture the small preview window as a window capture and use a Chroma Key filter on the green background.
- For cleaner compositing, prefer exporting/opening runtime HTML with a transparent background and using it as an OBS Browser Source if the OBS environment supports transparency.
- Blob popup URLs from the editor are convenient for quick checks but less stable for OBS scenes than exported runtime HTML or a local dev URL.
- The editor-opened small runtime window syncs live parameters and tracking settings from the main editor through `BroadcastChannel`, including body/arm parameters and per-side arm rotation reversal.
- The small window's local tracker can run face and pose/arm tracking with the same settings as the editor. Confirm pose FPS, pose/body/arm limits, and arm reversal still produce the same model motion in the editor and runtime popup.
- If the small window background is changed locally, tracking sync should not override it. This allows green-screen capture while the editor stays in checker or another mode.
- Small-window runtime supports whole-avatar drag and scale. Use the `缩放` slider or the mouse wheel over the stage for framing.
- Runtime preview uses an overscan canvas around the original square stage so accessories that extend above/outside the PSD canvas, such as hats, remain visible. This overscan is runtime-only; the main editor still uses the normal canvas frame.
