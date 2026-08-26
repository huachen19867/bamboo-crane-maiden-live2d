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

## 2026-08-26｜质量重置后的候选补绘参考

为解决单图切层缺少被遮挡身体的问题，使用内置图像生成工具基于参考图生成了非破坏性候选 `assets/source/candidates/identity-preserved-fullbody-v1.png`。候选严格要求保留原角色的姿态、正常比例的绿色眼睛、发髻、青绿汉服、双手与双脚，移除场景；实际结果保留了大体身份与剪影，但生成器仍将透明棋盘烘焙进 RGB，且局部衣纹、脸部线条与参考存在差异。

`tools/prepare_candidate_alpha.py` 复用项目已验证的边缘连通背景算法，把它转换为真实 Alpha 版本 `assets/source/candidates/identity-preserved-fullbody-v1-alpha.png`。该文件的 SHA-256 为 `0A3B63946A25A002F3F38DC782625116234CDC6ADEDDAB607570E0EE09136045`，透明区域约占 69.98%。它仅作为重建 PSD 时被袖、腰带、裙摆和头发遮住区域的结构/取色参考，不替换 `assets/source/reference.png`，不直接参与静态 95% 相似度评分，也不得直接贴到可见层上。

该边界已做过一次保守的轮廓配准量化：候选以 `0.986` 缩放、`(+47,+118)` 平移对齐现有 1254px 参考预览后，候选 Alpha 加权 RGB 的整人相似度仅为 `84.2272%`，面部窗口为 `79.0551%`，远低于 95% 门槛。这不是生成失败后的主观判断，而是禁止其进入可见层的直接证据。既有 `assets/cubism/body-underpaint-v1.png` 也不是替代品：它是另一套浅色服装和裸腿结构，与参考角色的青绿鹤纹服装不一致。两类素材只可作为隐藏解剖/遮挡草图，不可作为动态露出区域的最终纹理。

候选使用的内置生成提示保留在本线程，并要求“同一姿态、同一角色、透明背景、正常眼睛、无场景/文字/水印、补全隐藏结构”。后续若采用其任何像素进入正式 PSD，必须在对应层记录具体来源区域并通过中性合成与关节极值人工审阅。
