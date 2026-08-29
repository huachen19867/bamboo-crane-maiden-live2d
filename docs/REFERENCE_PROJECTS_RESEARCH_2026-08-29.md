# 单图 Live2D 参考项目研究（2026-08-29）

## 结论先行

当前竹鹤少女路线已经暂停。原始参考图虽然是 2160×2160，但人物在整幅场景中占比有限，面部和手部有效像素不足，人物侧身、仙鹤遮手、衣摆与披帛高度重叠。继续拿它直接切片，只能在中性帧贴回原图；一旦抬臂、转身或迈步，就会暴露缺失底绘、重复袖片和贴片旋转。下述项目能减少候选分层、快速预览或面捕接入的工作量，不能恢复原图里不存在的清晰细节和真实遮挡背面。

六份源码快照均下载到 `references/live2d-research/`。研究后的正式路线不是把其中任一仓库直接当成“一键 Cubism”，而是：先取得清晰、干净、正面、可分层的人物母版；再生成候选 PSD 并人工补全关节遮挡；用轻量运行时做小动作预检；只有素材质量门通过后，才进入官方 Cubism Editor 建网格、关键形、Glue、遮挡和 Physics。

## 下载快照与许可证

GitHub 主站连接在下载时反复重置，因此使用 `codeload.github.com` 获取各仓库 `main` 分支 ZIP；展开目录不含 `.git`，是 2026-08-29 的源码快照，不应冒充可追溯的 Git clone。原 ZIP 已在记录哈希后从工作区删除。

| 本地目录 | 上游 | 许可证 | 下载 ZIP SHA-256 |
|---|---|---|---|
| `AutoLive2d` | `Fenglin-Maple/AutoLive2d` | Apache-2.0 | `2DE2A38E74986E865B93B75ECFB78AB0DF26C8F513EC8027B1F205212827F06F` |
| `see-through` | `shitagaki-lab/see-through` | Apache-2.0 | `720589C55CF8A985AF25CE535A0BC7C2E6BF0051711716DE394FC992A5688B9A` |
| `EasyVtuber-GunwooHan` | `GunwooHan/EasyVtuber` | GPL-3.0 | `1C5A10D314BCB0E075E514F7AD83E0CA0ADD5E9730CB500914D2A234A7DA53DD` |
| `EasyVtuber-yuyuyzl` | `yuyuyzl/EasyVtuber` | MIT | `97DE2DD44E2FF58514096AF8164F0DA0609F31A1DAD435442AAB51C8F474F2F0` |
| `Anime2.5DRig-852wa` | `852wa/Anime2.5DRig` | MIT | `5867CEC7F6FE4694C0B7A12B40C18F3A51784028C639578771D23B8C88697C2C` |
| `Anime2.5DRig-izumix77` | `izumix77/Anime2.5DRig` | MIT | `4822D9754B7056A1AD4C2324156064D51DFB7067ABF3E57C70CF5E400C983023` |

许可证结论只覆盖仓库源码。模型权重、训练数据、Live2D Cubism SDK/Editor 和角色美术仍可能有独立授权条件，复用或发布前必须另查。

## 为什么它们至少“看得过去”

共同点不是自动化程度高，而是把难题限制在可控范围内：示例素材清晰、正面、比例稳定，PSD 按算法预期命名；头、脸、眼口和头发只做小幅一致运动；眼口有专门的开闭差分；虹膜受眼白裁切；输入先归一化、校零、平滑和限速；头发按发根固定、发梢柔软处理；每个角色还有人工调参。它们把“准备好的静态立绘稍微活起来”做完整了，并没有自动解决全身关节、被遮挡底绘或复杂衣纹连续性。

这也是旧工程失败的反证：旧工程从模糊场景图硬切，眼睛没有原画级开闭差分，袖、手、躯干和腿脚缺少隐藏重叠，却先加 Rotation 和动作。动作越大，贴片感越明显。缩小动作只能隐藏问题，不能提高建模质量。

## AutoLive2d

定位：React/TypeScript + Canvas/WebGL 的自研 Live2D-style 运行时，不是 Cubism 导出器。PSD 由 `ag-psd` 展平，依据中英文层名关键词分类，再按真实 alpha 包围盒裁切并套规则矩形网格。主要入口为 `src/lib/psdImport.ts`、`classify.ts`、`mesh.ts`、`deform3d.ts` 和 `runtimeExport.ts`。

可借鉴：语义命名审计；左右眼/虹膜拆分；draw Z 与伪深度分离；头部椭圆壳的小角度投影；身体作为颈和头父级；虹膜裁切；发根低权重、发梢高权重的弹簧；面捕中性零位、平滑、死区和速率限制；极值截图验收。

不可直接借鉴：它的普通层网格仅约 `4×4`，五官 `5×5`，脸 `6×6`，头发约 `11×8` 或 `14×8`，网格不沿轮廓、衣纹或关节拓扑布点；默认关键形大量依赖整层平移、旋转和缩放。完成包是 Canvas 三角形仿射渲染 HTML，不是 `.cmo3/.moc3`。`ParamMouthForm` 虽被声明和面捕写入，但没有完整嘴形变实现。

仓库里的 Cubism 5.4 alpha 外部 API 脚本只给已导入模型创建 Part、Deformer 和参数键，且硬编码样例 ArtMesh ID。API 不能写 ArtMesh 顶点和 Warp 控制点；脚本的大多数 Warp 关键形仍是中性，也不保存 CMO3、不导出 MOC3。当前项目的 5.3.03 工程不能直接套用。

验证：在本机执行 `npm ci` 与 `npm run build` 成功，版本 1.22.0。生产依赖审计报告旧版 `nanoid` 与 `postcss` 两个高危传递依赖；没有运行自动修复，以免改写参考源码。构建生成的 `node_modules/` 和 `dist/` 已在验证后删除。UI 首次自动验收失败是因为脚本只找 Playwright 自带 Chromium，而本机只有系统 Edge，不是应用构建失败。

## see-through

定位：单图语义分层、遮挡补绘、逐层深度与 PSD 生成器，不包含网格、参数、物理或动作绑定。主链路是 `LayerDiff3D → Marigold depth → further_extr → PSD/depth PSD`，入口为 `inference/scripts/inference_psd.py` 和 `common/utils/inference_utils.py`。

可借鉴：用多层扩散模型联合生成脸、眼、前后发、颈、上衣、下装等候选；用深度建议图层顺序；用连通域拆左右眼、耳和手部服饰；对旧版合并头发做深度聚类和补绘。它适合生成“第一版候选 PSD”，能节省手工抠层，但所有候选仍须与原图复合比对和人工修正。

不可直接借鉴：输出通常只有约 23 个粗语义层，不能给出生产级的肩/上臂/肘/前臂/腕/手掌/手指、腰髋膝踝、独立裙片、上下眼睑、牙齿和口腔。扩散补绘是在猜遮挡内容；透明输入还会限制输出 alpha，不能自动得到中性轮廓之外的关节延拓。深度只用于排序，不能替代底绘和网格。

源码审计还发现 `blended_alpha > 256` 用于 `uint8` 数组，条件永远为假，因此组合层的隐藏深度回填不能完全信任。当前快照不含模型权重，本轮没有在竹鹤少女原图上宣称推理成功。

## Anime2.5DRig 两个版本

定位：纯浏览器 WebGL1 自动绑定/预览器，不是 PSD 转 Cubism。它解析顶层像素层，按名称建立内存中的 slot、锚点和规则网格，运行时直接变形；导出最多是清理后的 PSD、角色调参 JSON 或 WebM，不产生 CMO3、MOC3、model3、physics3。

852wa 版从 `face/eyewhite/irides/mouth/neck` 的 alpha 包围盒推导锚点；普通层约每 42px 一格，头发约每 30px 一格。眼白、睫毛和眼口差分用 `smoothstep` 交叉淡化，虹膜通过 stencil 留在眼白内。头发按 alpha 下轮廓峰值拆成 2–6 个发束，每束用 stiff/soft 两套二阶弹簧，根部硬、梢部软。

izumix77 版增加脸/发椭球壳、身体椭圆柱、五点侧脸曲线、前发生发线固定区、头顶回绕、身体滞后、胸部经验曲线、调参 JSON 和 WebM。值得迁移的是“中性差值必须为零”“每角色保存调参”“发根固定区”和统一驱动合成；不应迁移规则矩形网格、胸部经验壳或整片 handwear 位移。

硬前提：PSD 顶层必须直接是像素层，不能是 Group；名称必须匹配；左右眼最好在同一层形成两个可分连通域；开闭眼和开闭口需要同画风专用差分；前后发轮廓必须能被纵向扫描读出毛尖。现有三份竹鹤少女 PSD 顶层都是 Group，直接载入会得到 0 个可用层，且没有完整 `mouth_open/mouth_close`。

验证：自带样例实际运行，解析 20 个部件和 12 个发束，画布 1280×1280，页面显示 60fps。证据保存在 `exports/reference-research/anime25drig-sample-neutral.png`、`anime25drig-sample-driven.png` 和 `anime25drig-sample-report.json`。这证明样例链路可运行，不证明当前角色素材合格。

## EasyVtuber 两个版本

定位：TalkingHeadAnime2/3/4 神经重演，不是 PSD/Cubism。GunwooHan 版是 `MediaPipe FaceMesh → 约 42 维姿态 → face_morpher → face_rotator → combiner`；yuyuyzl 扩展为 45 维驱动，加入 OneEuroFilter、多进程共享内存、TensorRT/ONNX、RIFE、超分和 Spout2。

可借鉴：面捕中性校准、阈值和角度限制；眼口特征归一化；OneEuroFilter 与短历史平滑；AAA/III/UUU/OOO 嘴型的有界分解；把 FaceMesh、iFacialMocap 和 OpenSeeFace 汇总到统一驱动接口；面捕、推理和输出进程解耦。

不可直接借鉴：它们把一张 RGBA 角色图和姿态向量直接生成下一帧 RGBA，没有 PSD、ArtMesh、Glue、Cubism 参数或可编辑模型。THA4 角色仍需要专用 512×512 图片、face/body 权重、YAML、面罩和训练数据，不能从任意单图自动获得可编辑全身模型。yuyuyzl 快照没有实际模型权重，所以本轮只做源码审计。

## 对当前项目的执行路线

第一道门是素材，不是 Editor。应先重新生成或取得清晰人物母版：无竹林、无仙鹤遮挡、无水印，优先正面或轻微三分之二角，全身比例和服饰纹样与目标一致；面部、双手、双脚至少要有足够像素供独立重绘。当前原图保留作身份、服装、配色和场景参考，不再直接作为可绑定纹理母版。

第二道门是 PSD。可以用 see-through 多 seed 生成候选，再由人工统一画风、清边和补全遮挡。正式 PSD 必须先满足 alpha 真裁层、语义命名和关节重叠；脸至少拆脸底、眼白、虹膜、瞳孔、高光、上下眼睑、睫毛、眉、开闭口差分；四肢至少拆到肩/上臂/肘/前臂/腕/手，腿脚拆到髋/大腿/膝/小腿/踝/脚；发束、袖、裙、披帛按固定端与自由端分组。

第三道门是快速预检。另导一份扁平研究 PSD 给 Anime2.5DRig/AutoLive2d，检查命名、锚点、眼口裁切、发根稳定和小幅动作是否协调。这份预览不能成为正式交付，也不能把规则网格结果回灌为 Cubism 成品。

第四道门才是官方 Cubism：沿轮廓和关节走向建 ArtMesh；每条关节链先做中性、双极值和中间值的局部 Warp，再加 Rotation；用 Glue/共享父变形器维持接缝，Clipping/Draw Order 解决遮挡；最后接 Physics 和统一驱动。每一门都要看中性、极值、连续播放，不能用代码存在、帧率或“像素发生变化”替代视觉验收。

旧 V3 seam-fix 只保留为失败路线的最新回退和 Cubism 层级参考。它不能在当前低清素材上继续堆参数；若新素材未到位，下一位执行者应停在素材规格/候选生成阶段，而不是继续动旧 CMO3。
