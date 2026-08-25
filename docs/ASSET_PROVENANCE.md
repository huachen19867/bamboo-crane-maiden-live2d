# 素材来源与生成说明

参考图来自用户提供的 `codex-clipboard-90a5f9bb-9fb6-463c-89fe-90066644568b.png`，项目内保存为 `assets/source/reference.png`。角色透明母版使用 Codex 内置 image generation 工具的编辑模式生成；之后在本地做连通背景剔除、Alpha 抗锯齿、语义图层切分和高分辨率重采样。没有使用需要 `OPENAI_API_KEY` 的 CLI 回退路径。

最终生成提示词如下：

```text
Use case: background-extraction
Asset type: Live2D character master artwork with transparent background
Primary request: Extract the central young woman character from the reference image as a clean full-body transparent PNG. Preserve her identity and appearance as faithfully as possible: exact face, green eyes, dark brown Chinese updo with loose curled side locks and turquoise ornament, pose, anatomy, teal-blue-and-jade layered hanfu, navy sash, gold linework, bamboo-leaf and crane embroidery, long flowing ribbon-like skirt panels, hands and shoes. Reconstruct only tiny areas hidden by scene overlap if necessary.
Input image: Image 1 is the sole edit target and strict identity/style/composition reference.
Style/medium: preserve the original delicate hand-painted anime watercolor/ink illustration; do not make it photorealistic or 3D.
Composition/framing: same full-body pose and proportions, centered with generous transparent margin; keep all garment tails in frame.
Constraints: genuinely transparent background with alpha; change only the background/extraction; preserve the character design and palette; no new accessories; no text; no logo; no watermark; exclude every bamboo stalk, bamboo leaf, flower petal, bird/crane, ground, glow, scenery, and the original bottom-right logo. Do not crop hair, sleeves, skirt, ribbons, hands, or feet.
Avoid: photorealism, different face, different pose, redesign, simplified clothing pattern, added objects, solid or checkerboard background.
```

生成服务实际返回了烘焙棋盘格 RGB 图，而不是 Alpha；`tools/build_assets.py` 通过边缘连通的中性背景识别和封闭亮灰区域补充检测修复为透明图。该处理会保护面部区域，避免误删眼白。

