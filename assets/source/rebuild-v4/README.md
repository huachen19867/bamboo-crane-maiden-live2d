# V4 清晰人物母版

## 文件角色

`character-master-front.png` 是 2026-08-29 使用内置 imagegen 生成并选定的正面全身母版，SHA-256 为 `0790D02B1A0ECC65EAAB1B54D5ACBC05FF6B0CA717AD54CD5746CA9D8F12B2E1`。它是真 RGBA，但生成器在人物外围保留了低 alpha 光晕，不可直接导入 Cubism。

`character-master-front-clean.png` 由 `pipeline/v4/build_source_psd.py` 确定性生成：alpha `<64` 清零，`64–223` 映射为窄抗锯齿边缘，`>=224` 设为完全不透明，同时清零全透明像素的隐藏 RGB。其 SHA-256 为 `C3341CD2A8D35F1C6E35175CD9F8DC2CB078312A28A5E177D1F09E58DAC1FB80`，这是 V4 PSD 的权威中性纹理母版。

`layers/` 是首轮几何分区，不是完成原画。各 PNG 已裁到实际 alpha bbox，禁止把它们放回全画布后再导入 Cubism。

`head-detail-guide-v1.png` 是 1254×1254 的隐藏重绘指南，SHA-256 为 `50E25B16F65A6DD6D238FC34051942C0B874256427B7F49C8212F2CFA6D46F51`。首稿眼睛偏大，被拒绝；接受版只把双眼宽约缩小 18%、高约缩小 15%，恢复成年女性的中等杏眼比例。它不与全身母版像素对齐，不能直接粘进 PSD，只用于绘制脸底、眼白、虹膜、上下眼睑、睫毛、眉和口型时取结构与细节。

## 最终生成提示词

使用内置 imagegen，以旧 `assets/source/reference.png` 为唯一身份、服装、配色和线稿参考。核心提示如下：

> Redraw the same young adult Chinese fantasy woman as a clean, high-detail, front-facing full-body character master suitable for professional 2D rigging. Preserve her soft oval face, natural medium-sized green eyes, black-brown high rounded bun with jade ornaments, slim adult proportions, layered teal/turquoise/indigo hanfu, navy sash, pale mint collar, and bamboo/crane gold embroidery. Neutral upright front view; arms 25–30 degrees away from torso; both open hands with five clear fingers; legs and shoes fully visible; no limb crosses torso; no sleeve covers a hand; no crane, bamboo, prop, scene, text, logo, or watermark. Entire figure inside frame. Polished Chinese watercolor anime illustration, crisp ink contours, transparent background.

随后进行两次背景提取修正。第二次输出获得真实 alpha 并被选为母版；第三次“去光晕”尝试又把棋盘格烘进 RGB，已删除。光晕最终由确定性 alpha 门处理，不再反复生成以避免身份和服装漂移。

## 视觉裁决

通过：正面全身；头、双手、双脚完整；左右手臂与躯干有空间；无仙鹤、竹林、水印；服装青绿/靛蓝、竹鹤纹、盘发与绿眼身份连续；眼睛未做成旧 MVP 的夸张贴片比例。

未完成：分辨率仅 1024×1536；双袖仍是大衣片；脸部、眼口和头发尚未独立绘制；裙片互相覆盖处没有隐藏延拓；当前母版只解决“素材清晰且无遮挡”风险，不自动等于商业级分层原画。

生成来源、角色和拒绝稿理由另见 `source-manifest.json`。
