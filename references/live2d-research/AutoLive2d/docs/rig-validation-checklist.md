# Rig Validation Checklist

Run this checklist after changes to PSD import, rig defaults, deformation, physics, camera tracking, presets, or runtime export.

## Build

- Run `npm run build`.
- TypeScript errors are failures.
- Vite chunk-size warnings are currently informational.

## Sample Presets

- Start the dev server.
- Load preset `u3` from the import panel. It is the default sample.
- Load preset `u4` from the import panel.
- Load preset `u5` from the import panel.
- Load preset `u6` from the import panel and confirm companion obj/expression layers appear in the report.
- For each preset, confirm the import report shows:
  - `0 个未识别图层`
  - automatic safety limits
  - head/body parameter ranges constrained by the safety limits

## Visual Regression Checks

Check both manual depth and proxy-head modes.

- Neutral pose: eyes in sockets, face not concave, neck/top wear not sliding, no wrong z-order exposure.
- Expressions: `默认`, `开心`, `生气`, `睡着`, `左看`, `右看`, `惊讶`.
- Head extremes: `头部 X`, `头部 Y`, `头部 Z` at min, max, and neutral.
- Body extremes: `身体 X`, `身体 Y`, `身体 Z` at min, max, and neutral. Neck must stay welded to torso/collarbone.
- Iris extremes: `眼球 X`, `眼球 Y` at min and max. The iris can be clipped by the socket, but the visible pupil must not leave the eye opening.
- Mouth open: set `嘴开合` to max and confirm the mouth scales around its fixed face position without vertical drift. Adjust `嘴张开上限` if the open mouth is too large.
- Arms: set `左臂抬起` and `右臂抬起` to `1`. Each arm should rotate outward from the shoulder root, not inward toward the torso, and keep a wide enough torso connection. If a model rotates inward, enable the corresponding `左臂旋转反转` or `右臂旋转反转` tracking option and recheck editor and runtime preview.
- u6/companion attachments: hats may extend above the canvas; glasses must not include hat brim material; expression overlays should be cropped from aligned full-character differentials rather than generic isolated icons.
- Dynamics: breath, front hair, side hair, back hair, and accessory tips should move subtly. Hair roots should stay close to the face/head.
- Head Z: the full head, including proxy-head deformation, rotates around the adjustable neck/head pivot. Hair may lag with inertia, but the face parts must not split.
- Backgrounds: checker, green, white, black, and transparent.
- Runtime: export runtime HTML and open the small-window preview.
- Runtime small window: verify drag, wheel/slider scale, panel hide/show, background modes during tracking, synced arm/body parameters, arm rotation reversal, and hat/accessory overscan beyond the square canvas.

## Camera Tracking Checks

- Test `省电`, `均衡`, and `质量` tiers.
- Starting tracking must not freeze the page.
- First successful face tracking should calibrate the current real head angle as model zero.
- First successful pose/arm tracking should average the initial real arm positions as arm zero, so enabling tracking does not immediately rotate the avatar arms.
- Balanced tier must at least drive head, blink, mouth, iris, and small body motion.
- Quality tier should not enable heavy pose/arm tracking unless the pose checkbox is enabled.
- Toggle preview mode between camera video and tracking points. Points mode should hide the video image and show only landmark dots/status.
- Check iris vertical tracking. If the model barely looks up/down, increase `上下灵敏`; if it jitters, lower it slightly.
- Check tracking stabilization: `补帧` defaults to `2x`; `强制平滑` and `防抽搐` should reduce sudden landmark jumps without freezing normal head/eye movement. Arm tracking should be slower and steadier than head tracking, with no rapid twitching when the real arms are held still.
- Check tracking mouth limit: `嘴巴` in `面捕头部上限` should cap camera-driven mouth open without affecting manual mouth sliders or expression presets.
- Stop tracking and confirm the camera stream releases.

## Automated UI Script

With a dev server running:

```bash
npm run validate:ui -- --url http://127.0.0.1:5173 --preset u3 --out .rig-validation-u3
npm run validate:ui -- --url http://127.0.0.1:5173 --preset u4 --out .rig-validation-u4
npm run validate:ui -- --url http://127.0.0.1:5173 --preset u5 --out .rig-validation-u5
npm run validate:ui -- --url http://127.0.0.1:5173 --preset u6 --out .rig-validation-u6
```

If Playwright is not installed locally, run:

```bash
npx -p playwright node scripts/validate-ui-flow.mjs --url http://127.0.0.1:5173 --preset u3 --out .rig-validation-u3
```

The script captures neutral, expression, parameter extreme, arm, and proxy-head screenshots. Review the images manually; a screenshot being generated is not by itself a visual pass.
