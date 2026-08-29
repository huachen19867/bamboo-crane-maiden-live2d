# 技术日志

## 2026-08-29｜V4 清晰母版生成、真实 alpha 审计与首轮源 PSD

为处理“旧原图人物有效像素和遮挡条件不足”的输入风险，使用内置 imagegen，以旧参考图为身份、服装、发型和配色参考，生成正面全身母版。提示词强制双臂离体、双手五指和双脚完整、无仙鹤/竹林/水印、青绿靛蓝鹤竹纹汉服和正常大小绿眼。首稿把棋盘格烘进 RGB；第二次背景提取得到真 RGBA；第三次去光晕又退回烘焙棋盘格，因此只保留第二次输出 `assets/source/rebuild-v4/character-master-front.png`，两份失败稿删除。可复用判断是：图片看起来像棋盘格不等于有 alpha，必须实际读取 mode、alpha 最小/最大值和透明像素数。

选定母版的主体绝大多数 alpha 为 252–254，但外围带约 27,000 个低 alpha 光晕像素。若直接导入 Cubism，这些不可见光晕会扩大 ArtMesh bbox，重演旧工程的大范围网格问题。`pipeline/v4/build_source_psd.py` 用固定门限把 `<64` 清零、`64–223` 映射为窄抗锯齿、`>=224` 设为 255，并清零全透明像素的隐藏 RGB。清理后权威母版为 `character-master-front-clean.png`，可见/边缘像素 640,029，bbox 为 `(118,12)–(893,1507)`。

同一脚本建立 `model/cubism-v4/bamboo-crane-maiden-v4-source.psd`。所有像素层按实际 alpha bbox 裁切，首轮 11 层覆盖头、双手袖口、双脚、躯干腰封、左右袖和左中右裙；隐藏 `ReferenceMasterFront` 只作指南，空的 `90_UNDERPAINT_TODO` 明确阻止在没有隐藏底绘时直接做动作。分区重建未分配像素为 0、逐像素差异为 0；`psd-tools` 会把空透明画布展平为黑底，因此 PSD 合成验证只比较角色实心像素，633,430 个实心像素 RGB 差异为 0，6,599 个抗锯齿边缘单独记录。不能把黑底展平行为误报成素材缺层。

当前 V4 只解决了“清晰、无遮挡、可开始拆分”的风险，没有完成脸部独立眼口、头发发束、肩肘腕/髋膝踝底绘或任何 Cubism 关键形。下一道门固定为先拆 `ArtHeadCombined` 的脸底/眼/眉/嘴/前后发，再补一条右臂链的肩肘腕隐藏重叠；没有这两项，不进入全身参数与 Physics。

全身母版的头部实际 bbox 只有约 265×319，因此另生成 1254×1254 头部细节指南。第一稿的双眼相对脸宽偏大，按老板此前“卡姿兰大眼”红线直接拒绝，没有放入工作区；随后只缩小眼裂、虹膜、瞳孔与睫毛约 18% 宽/15% 高，得到 `head-detail-guide-v1.png`。该指南不与全身母版配准，只能帮助重绘细节，不能直接替换 `ArtHeadCombined`；否则会再次以高分辨率为名改变角色比例。

## 2026-08-29｜紧急止损、六项目源码研究与工作区大清洗

老板叫停旧制作后，先把质量问题从“参数没调好”重新定性为“输入素材和建模路线不成立”。当前 2160×2160 原图是完整场景，不是可绑定立绘：人物有效像素有限、姿态非正面、仙鹤遮手、衣摆和披帛高度重叠。中性帧可以通过贴回参考像素获得高相似度，但任何抬臂、转身和迈步都会需要原图中不存在的上臂、肘背、腕背、裙内腿脚和连续刺绣。以后素材门不通过，禁止通过增加 Rotation、缩小动作或堆 Physics 继续掩盖。

下载并只读研究了 `AutoLive2d`、`see-through`、两份 `EasyVtuber` 和两份 `Anime2.5DRig`。可复用总判断是：see-through 只适合多 seed 生成候选语义层、遮挡猜测和深度排序；AutoLive2d/Anime2.5DRig 依赖严格命名、清晰正面 PSD，以规则网格、小幅动作、眼口差分、虹膜裁切、参数平滑和根梢双弹簧获得尚可观感；EasyVtuber 是 THA 神经逐帧重演，不生成 PSD、ArtMesh 或 Cubism。没有一个项目能从模糊单图自动恢复生产级全身关节底绘。详细源码路径、许可证、下载哈希和迁移边界见 `docs/REFERENCE_PROJECTS_RESEARCH_2026-08-29.md`。

AutoLive2d 在本机执行 `npm ci`、`npm run build` 成功，版本 1.22.0；审计发现旧版 `nanoid` 与 `postcss` 两个高危传递依赖，未运行 `npm audit fix`，避免污染参考源码。Anime2.5DRig 样例实跑解析 20 个部件、12 个发束，1280×1280 画布显示 60fps；这只证明准备好的样例可运行。see-through 和 yuyuyzl EasyVtuber 快照缺模型权重，不能声称已在当前角色上推理验证。

清洗遵循“原图、最新可回退工程、研究源码和关键证据保留；缓存、错误素材、失败中间产物删除”。删除前逐项解析绝对路径并核对体积，没有使用工作区根目录作为递归目标。已删除下载 ZIP、AutoLive2d 的 `node_modules/dist`、`tmp`、逐步 Editor 截图、旧交付 ZIP、错误的 `body-underpaint-v1.png`、低质量候选图、旧网页/MOC 产物、旧 Viewer/启动器/构建验收脚本和历史 Cubism 检查点；已安装的 Cubism Editor、受控 Python、参考原图、V3 seam-fix/前一回退及研究证据保留。最终工作文件约 0.93GB；计入本地提交并执行标准 `git gc` 后，整个目录由约 4.38GB 降到 1.42GB，释放约 2.96GB，`.git` 约 484MB且未重写历史。被 Git 跟踪的旧产物可从历史恢复，未跟踪临时材料直接删除后不保证恢复。精确保留集和下一步见 `docs/HANDOFF_2026-08-29.md`。

本轮研究与清洗已经做成本地 Git 提交；补写日志后使用 `git commit --amend` 将状态收进同一提交。没有执行 `git push`，远端仍停在此前状态。

新的执行顺序固定为：清晰人物母版 → 候选分层与人工补绘 → 扁平研究 PSD 小动作预检 → 官方 Cubism 中逐关节中性/双极值/中间值 → 连续播放 → Physics → 操演/动捕。每个阶段先推演一组连续可逆操作，在质量门截图；不再每点一步就截图，也不把后序测试通过外推成前序美术质量通过。

## 2026-08-28｜V3 seam-fix 回灌、材料归档与可交接状态

为修复 V3 中躯干底图与动态右袖同时可见导致的静止袖子残影，`tools/build_arm_rebuild_psd_seamfix.py` 生成了 `bamboo-crane-maiden-arm-rebuild-v3-seamfix-v1.psd`。正确的 Cubism 回灌不是“从 PSD 创建模型”，而是“文件 → 打开 PSD → 选择已有 V3 模型 → 重新导入设置选替换旧 PSD → 不删除未使用原画 → 另存为新 CMO3”；这样保留既有 `RotShoulderR → WarpArmRRoot → RotElbowR → WarpForearmR → RotWristR → WarpHandR` 与肘腕参数。当前保存工程为 `model/cubism/bamboo-crane-maiden-arm-rebuild-v3-seamfix-v1.cmo3`，SHA-256 `27C9F08ED548175F4A8931B0E22729548D9DD1A1351C1E28E3CBE5B10B4AEA40`；未修补 V3 仍保留为安全回退。

seam-fix 版本的 `ParamElbowR` 和 `ParamWristR` 均在 `-1 / -0.5 / 0 / +0.5 / +1` 实测，联系人图为 `exports/cubism-v3-seamfix-existing-elbow-sequence-contact.png` 和 `exports/cubism-v3-seamfix-existing-wrist-sequence-contact.png`。这仍只是右臂局部连续参数门：尚未导出 seam-fix 对应 runtime，也未验证连续 Motion3 播放；左臂、腿脚、面部、衣发 Physics 与统一驱动均未完成。

停工交接时，把根目录的 14 张 Editor 导入截图移入 `exports/authoring-archive/2026-08-26-editor-import/`，把本轮 63 张逐步操作截图移入 `exports/authoring-archive/2026-08-28-v3-seamfix/`，把 321 个临时脚本/截图移入 `tmp/cubism-v3-seamfix-workbench/`；没有删除任何源 PSD、CMO3、运行包或主证据。`.gitignore` 明确忽略这两类本地过程材料。下一位执行者只需先读 `docs/HANDOFF_2026-08-28.md`，再从 seam-fix CMO3 导出至一个新 runtime 目录；旧 `runtime-arm-v3` 绝不覆盖。

## 2026-08-28｜V3 右肘参数与右腕五档连续复核

本轮继续使用官方 Live2D Cubism Editor 5.3.03，目标工程为 `model/cubism/bamboo-crane-maiden-arm-rebuild-v3.cmo3`。在已存在的 `RotShoulderR → WarpArmRRoot → RotElbowR → WarpForearmR → RotWristR → WarpHandR` 链上，先把 `ParamElbowR` 的中性和正向关键形轴心校到候选肘点，再用 `Ctrl + Drag` 将负向关键形的轴心同样移到肘部；正负方向手柄收敛到约 ±5°，避免用大角度掩盖袖口底绘问题。随后在 `-1 / -0.5 / 0 / +0.5 / +1` 五档实际切换并捕获联系人图 `exports/cubism-v3-elbow-sequence-contact-sheet.png`，未观察到参数跳变、整幅人物被带动或躯干重复袖片。

右腕 `ParamWristR` 也按同样的五档进行实机复核，联系人图为 `exports/cubism-v3-wrist-sequence-contact-sheet.png`；变化集中在手与袖口局部，镜头和躯干保持不动。两组操作完成后把参数恢复到 `0.0`，保存正式 V3 工程，并复制为 `model/cubism/bamboo-crane-maiden-arm-rebuild-v3-elbow-wrist-sequence-v1.cmo3`。当前工程及该里程碑 SHA-256 均为 `F5B07C0802B54C97FF0E972E5CD9EE6DF79753273673DA1F7F7E20218A696822`。

质量边界必须保留：肘部在原始单图的袖口遮挡区仍可看到透明/浅色断口风险，根因是隐藏的上臂、肘背和腕背没有完整重绘；五档通过只说明局部参数连续可驱动，不能宣称右臂已经达到商业级无缝效果。尝试把 `WarpForearmR` 负向关键形的一个边界点外推约 10 px 后，视觉改善不足且会改变袖面轮廓，已通过 Editor 的“撤销”恢复并保存安全版本。下一次第一步应是为 `UnderpaintElbowR / UnderpaintWristR` 增加来自实际右袖的窄幅重叠底绘，或在 Editor 中对前臂近肘网格做成组修形；修补通过前不继续放大肘角，也不进入腿脚和物理导出。

## 2026-08-28｜V3 右腕第一版：正式 Editor 内建立独立旋转、局部 Warp 与正反极值

本轮继续的对象是 `model/cubism/bamboo-crane-maiden-arm-rebuild-v3.cmo3`，不是旧网页 PNG 拼片或旧正式工程。先以 `bamboo-crane-maiden-arm-rebuild-v3-pre-wrist-v1.cmo3`（SHA-256 `7670B1182BEAFA3EF0C86232AC6D50AD207958749F969482E73D845F1F2500D6`）保存腕部前回退点；在官方 Live2D Cubism Editor 5.3.03 中复核右侧层级为 `RotShoulderR → WarpArmRRoot → (ArtArmRShoulderSleeve, RotElbowR → WarpForearmR → (ArtArmRForearmSleeve, RotWristR → WarpHandR → ArtHandR))`。所有这三个 Warp 的显示控制框均限于对应袖段或手部，未触及躯干或整个人物。

在 `WarpHandR` 被选中的前提下，用“设为所选对象的父级”建立了 `RotWristR`，轴心用 `Ctrl + Drag` 从手掌中央校到袖口与手的连接处（画布坐标约 `770.5, 425.1`）；随后新增独立参数“右腕旋转”／ID `ParamWristR`，范围 `-1 / 0 / +1`，并分别为 `RotWristR` 和 `WarpHandR` 生成三个关键形。正、反极值通过 Rotation Deformer 的方向手柄分别设为约 `+8° / -8°`（根据 79 px 轴线与 11 px 横向偏移，约 `7.9°`）；中性仍为原图姿态。实机三档清洁画面已保留为 `exports/cubism-arm-r-wrist-minus-v1.png`、`exports/cubism-arm-r-wrist-neutral-v1.png`、`exports/cubism-arm-r-wrist-plus-v1.png`：当前幅度内没有看到棋盘格漏底、浅色旧底绘、重复静态袖子或手臂以外区域被带动。

这只是右腕的第一道结构门，不能外推成“右臂自然动作完成”。`WarpHandR` 已拥有独立关键形，但尚未完成针对袖口体积、手背透视和手指的手工网格修形；参数也还缺 `-0.5 / +0.5` 两档、中间连续性联系人图、连续播放和运行时导出。肘部虽然已有 `RotElbowR / WarpForearmR` 层级，尚未绑定独立参数和双极值；右肩、左臂、腿脚、衣发 Physics 与操演/动捕也都仍未完成。下一步必须先让肘部通过同样的中性、正反极值和局部 Warp 门，再把腕部补到五档并重新审看袖口。

保存后的当前工程 SHA-256 为 `D259B8DB3DF762BD7B8A03E2DD43D2D1F7FE8A9F7B5A437326FC84F9A0D36F1A`，同哈希回退为 `model/cubism/bamboo-crane-maiden-arm-rebuild-v3-wrist-rotation-v1.cmo3`。Cubism 本版本创建 Rotation Deformer 后会遗留一个隐藏 `SunAwtDialog`，它会拦截保存；可复用的安全处置是只显示该已核对句柄并点击其“关闭”按钮，随后再 `Ctrl+S`，不能用 `Alt+F4` 或结束 Editor 进程。

## 2026-08-26｜V2 面部暂存工程已由官方 Editor 实际导入；动态眼睑仍未通过

`bamboo-crane-maiden-face-rebuild-v2.psd` 已在 Live2D Cubism Editor 5.3.03 中选择“从 PSD 文件创建模型”并成功打开。Editor 的 Part 树可见 `HeadFaceV2` 和标注为 `Legacy*` 的身体组，变形器树可见左右 `ArtEyeWhite / ArtIris / ArtPupil / ArtHighlight / ArtUpperLid / ArtLowerLid` 以及闭眼线；中性画布与本地 PSD 预览一致。新工程仅另存为 `model/cubism/bamboo-crane-maiden-face-rebuild-v2.cmo3`，大小 `7,019,892` 字节、SHA-256 `5195A9313A98DF54FA4041950EC717CB183B52B52CA0C7ACA049F81EBFC69CD9`。它由既有忽略规则保留在本地，当前正式 `bamboo-crane-maiden-editor.cmo3` 没有被覆盖或修改。

这一步确认的是“PSD 能被官方 Editor 解析为真实 Part/ArtMesh”，不是“眨眼已经自然”。导入后 Editor 面板有标准左右眼开闭参数，但尝试以旧窗口坐标直接拨动滑块时，落点与新布局不一致，临时改变了左眼开闭/微笑的会话显示值，未得到可靠的 0、0.5、1 三态截图。没有在这之后保存 V2，因此该临时显示值没有进入已保存 `.cmo3`；也没有任何动态结果可据此声称已经完成。重新打开模型时又因文件对话框焦点不可靠而弹出工作区的 Explorer 窗口，已只关闭该由本次操作打开的窗口，没有修改文件。

可复用的纠正是：同一模型窗口内可批量执行的操作继续批量做；但跨“欢迎页、文件打开、PSD 导入、模型设置、已打开模型”这些不同对话框时，不得沿用截图坐标。后续在继续眼睑参数前，先以当前窗口截图或可访问控件定位数值字段/默认值命令，确认能把两眼恢复为中性后再批量设置 `0 / 0.5 / 1`；若不能可靠定位，就停在 V2 不保存，优先完善可复现的 UI 定位而非反复试点。

## 2026-08-26｜面部 V2 静态分层预检：以真实源像素拆开眼睛，不再扩大眼贴片

按照质量重置后的第一道门，新增 `tools/build_face_rebuild_psd.py`，但没有改写当前官方 PSD、`.cmo3` 或 `runtime-mvp-v1`。该脚本先检查 V1 生成层是否齐全，再把原始中性角色像素重组成独立的 V2 暂存 PSD：`model/cubism/bamboo-crane-maiden-face-rebuild-v2.psd`。它的身体组明确命名为 `Legacy*`，提醒后续不能把旧躯干、手脚和裙片误当作连续关节已经完成；新 `HeadFaceV2` 则把每一侧眼睛拆成 `EyeWhite / Iris / Pupil / Highlight / UpperLid / LowerLid`，闭眼线仍保留为独立 ArtMesh。

静态验收不是用参考图回显，而是重新打开 V2 PSD 后合成其真实可见层，和当前透明母版比较。报告 `exports/cubism-face-rebuild-v2-report.json` 的 alpha 加权 RGB 相似度为 `0.9998101890`、Alpha IoU 为 `0.9945044830`，满足此预检的 `>= 0.99` 门槛；全身预览和面部特写分别保存为 `exports/cubism-face-rebuild-v2-preview.png` 与 `exports/cubism-face-rebuild-v2-face-close.png`。面部特写确认仍是参考图的自然眼宽与眼距，不是为了“动态高光”人为放大的大眼。

该结果的边界必须保持：V2 目前只证明静态分层合成和源像素比例正确，尚未导入 Cubism 创建 ArtMesh、没有绑定上下眼睑关键形、没有运行闭眼/视线参数，更没有解决四肢或衣发。因此不能把这次通过称为“眨眼已经自然”或“全身已重建”。下一步是把 V2 PSD 以独立工程导入官方 Editor，先完成眼睑的 `0 / 0.5 / 1` 实际形变并检查开眼、半闭、闭眼，再考虑移植到正式重建主线。

运行脚本时系统 `python` 命令不在 PATH；本机可复用的受控运行时是 `tools/_runtime/python312/python.exe`。调用方式为 `& (Resolve-Path 'tools\\_runtime\\python312\\python.exe') tools\\build_face_rebuild_psd.py`。该脚本会只清理 `assets/cubism/rebuild-v2/face-layers/*.png` 这一个可再生目录，不会触碰 V1 分层、候选资产或任何 Editor 文档。

## 2026-08-26｜第二次质量复盘：把老板的成品定义和工作纪律写成不可绕过的约束

这次复盘不把“Viewer 能打开”“Motion3 有曲线”“浏览器测试通过”当作质量成果。老板对现有导出的直接评价是：人物像碎片拼起来，夸张的大眼脱离原角色，一动就是贴片绕轴旋转。这个评价与当前技术事实一致：`model/cubism/runtime-mvp-v1/` 能加载 `.moc3` 和 `MVP_idle.motion3.json`，却没有 `physics3.json`，其 `.model3.json` 也没有 `Physics` 引用；因此它只能证明最小导出与播放通路，不能证明衣发物理、全身连续性或可操演质量。它保留为失败样本和导出格式参考，不能再写作“可交付 MVP”。

截至本条记录，Git 已跟踪的正式 Editor 快照是 `model/cubism/bamboo-crane-maiden-editor.cmo3`，实际大小 `56,990,746` 字节、SHA-256 `834161A3D2BB02B2B238981BDB35695C493FDC3EFF8126A8B81DE6B32873FCBE`。这个哈希只说明本地工程状态被保存，不构成视觉验收；双肩里程碑 `bamboo-crane-maiden-shoulders-param-continuous-v1.cmo3` 只可作为右肩九档、左肩三档小范围连续性的历史证据。当前工程仍缺少可审阅的连续面部重绘、肘腕、髋膝踝、脚接触、衣发 Physics 与统一运行时接入，不能将若干旧里程碑相加为“全身已完成”。

### 这轮真正暴露的工程失误

第一，错误地把单图自动切层和补洞底片当作可直接绑定的原画。自动切层可以保持中性画面，却没有恢复被袖子、腰带、裙片、头发遮住的身体、衣纹和眼睑结构；大动作时自然只能露底、重影或成为贴片。以后单图层仅可用作坐标和采样参考，关节底绘必须按目标运动方向补全并在遮挡区保留重叠。

第二，错误地把“先加参数、再缩小 Rotation 幅度”当作建模。Rotation Deformer 只应提供骨骼方向，不能替代关节形状。肩、肘、腕、髋、膝、踝都要先完成中性、正极值、反极值和中间值的局部 Warp 形变、必要的 Glue/Mask/Draw Order 与底绘遮挡，再接动作和物理；肉眼还能看出整片绕一点转，即使没有透明裂缝也判失败。

第三，验收次序和汇报不诚实。自动化过去覆盖的是旧 Canvas 原型的文件、输入和像素变化，不能回答“像不像同一个人”“眼睛是否失真”“衣纹是否连续”。以后前序视觉门不通过，后序 Viewer、参数或输入测试都不能宣布完成；任何里程碑必须同时写清已验证范围、未验证范围和不能外推的结论。

第四，工作节奏被 UI 操作牵着走。每点一步就截图，既慢又掩盖了缺少完整建模计划的问题。新的约束是先推演当前稳定面板中接下来的依赖操作，连续完成一组可逆改动；截图只放在面部比例、关节正反极值和中间值、保存、导出、实际播放这些质量门。若 UI 状态、父级归属或数据安全不确定，再用截图确认，而不是把截图数量误当作严谨。

### 老板要求的工程解释

目标是固定镜头下仍有生命感的全身角色，不是“只有 1.52 秒眨眼”的演示。待机需要呼吸、轻微重心和头部微动；头发、衣袖、裙摆、披帛在稳定锚点外有独立的风与回弹。手、手臂、躯干、腿、脚和支撑脚切换同属第一优先级，不能因为需求最初从眨眼举例，就默认其余部分静止。四类驱动——自动待机、键鼠/手柄操演、摄像头或 OSC 动捕、时间轴演出——最终必须写入同一组 Cubism 参数；动捕至少控制脸、头、上半身和手臂，手势与腿脚可由操演快捷键或时间轴补足。

“8K、虹膜高光、风速、2000+ 发丝、衣物刚性”等表述以参考图的二维绘画风格和可观察效果为准：8K 是归档/纹理清晰度目标，不把人物改成写实 3D；高光应随虹膜且受眼睑裁切，不能把眼睛做大；风速和材料数值必须落到可复验的 Cubism 分段物理参数，不能虚报有限元或 2000 张独立网格。衣物固定端稳定、自由端才随风回弹，防止整件衣服像纸板一起旋转。

老板还要求我主动推演后续，而不是机械地“截一张图做一步”。这已经写入 `docs/USER_ACCEPTANCE_SPEC.md` 的工作方式条款：稳定、可逆的连续操作应批处理，只有质量门与不确定状态才检查；发现问题时必须在证据足够的第一时间报告位置、根因、影响和下一道验证门，不能等老板看出成品问题后才承认。老板允许主线使用 Terra xhigh、难点由 Sol xhigh 攻坚、独立低风险审计交给 Luna xhigh；该分工只能用于边界清楚的并行工作，最终质量判断仍由主线统一，不能将子任务局部通过拼成整体完成。

### 后续执行门与第一件事

重建顺序固定为：先审计参考图和现有 PSD，标出只能定位的旧切层与必须重绘的遮挡区；再单独建立脸底、眼白、虹膜、瞳孔、高光、上下眼睑和睫毛并做静态脸部比例审阅；随后每次只让一个关节链通过中性、双极值和中间值，再扩大到连续全身；最后才建立衣发 Physics 并接入四类驱动。每一门必须以实际 Editor 截图、导出包和播放行为取证，不能用代码存在或旧网页的测试绿灯替代。

本次日志同步修订了 `docs/USER_ACCEPTANCE_SPEC.md`，明确“先快点做出可使用成品”不授权静默降级，明确全身、玩法、动捕和工作节奏，以及“已保存”和“已验收”是两件事。以后停工时还须留下下一次的第一步、当前哈希与远端推送状态；网络导致推送失败时只能报告“本地已保存、远端未确认”。

## 2026-08-26｜右肩补片窄廊修复后，完成双肩连续参数保存

重新导入当日重建的 PSD 后，正式 Cubism 工程已对右肩 `-1 / -0.75 / -0.5 / -0.25 / 0 / 0.25 / 0.5 / 0.75 / +1` 逐档做实机截图检查，左肩复核 `-1 / 0 / +1`。右肩接缝在九个档位均未观察到棋盘格漏底、深青色梯形、灰白横纹、直边补片、重复衣纹或参数跳变；证据为 `exports/cubism-right-shoulder-continuity-contact-sheet.png` 及同名前缀的逐档截图。此处的判定只覆盖肩部现有小幅旋转，不外推为肘腕、腿脚或衣物物理完成。

重要的默认值检查：曾发现右肩会话值停在 `0.8`，保存前用参数面板的“将所有参数值设为默认”复核为 `0.0`，并再次截图 `exports/cubism-right-shoulder-after-set-all-default.png`。之后保存时，Cubism 提示有 7 张未使用原画，选择了“否(N)”，未删除任何素材。正式工程已保存为 `model/cubism/bamboo-crane-maiden-editor.cmo3`，并复制同哈希里程碑 `model/cubism/bamboo-crane-maiden-shoulders-param-continuous-v1.cmo3`；二者均为 `56,986,210` 字节，SHA-256 为 `6BBB29046585A87A5E4FF7DAAF31E90F9561C8280E739585C947F1408F226318`。

当前屏幕缩放下，默认参数面板最初被“工具详情”和“检视面板”挤出画面。可安全通过“视窗”菜单暂时隐藏这两个只读面板，让参数列表显示；选中下方变形器树的 `RotShoulderR/L` 后，再输入数值字段。每次输入前必须确认该字段显示了对应的肩参数名称；若字段未聚焦，`Ctrl+A` 会选择整个模型。Cubism 保存会弹出“未使用的原画”提示，绝不能按默认的“是(Y)”。

## 2026-08-25｜暂停交接：保留右肩安全工程，拒绝保存未通过补片

暂停前重新导入了 20:50 构建的 PSD，在 `右肩 上下 = +1` 极值确认灰白横纹已经消失，但隐藏连接层仍露出明显的深青色梯形，因此该状态没有保存进正式 `.cmo3`。磁盘上的 `model/cubism/bamboo-crane-maiden-editor.cmo3` 与回退点 `bamboo-crane-maiden-shoulder-r-warp-v1.cmo3` 均为 `50,921,670` 字节，SHA-256 同为 `8A43D218BE5B798814FA168E837052959F276B8E6BF320BEA074F94F51C173B6`，可作为下次继续工作的权威安全状态。

`tools/build_cubism_psd.py` 已把下一版补绘策略改为“从右侧真实袖面镜像延拓纹理、只平滑合成像素，并收窄连接多边形”，且通过 Python 语法检查；这版代码尚未重新构建 PSD、重新导入或目视验收，不能标记为修复完成。下次从运行构建脚本开始，检查 `UnderpaintArmRUpper.png` 后再重新导入；若右肩 `+1` 仍出现色块，继续缩窄连接轮廓，不保存 Editor 临时状态。

## 2026-08-25｜GitHub 复用边界：Editor 建模、运行时与动捕必须分层选型

复核了 `Wzhang3912/image2live2d`、Live2D 官方 `CubismWebSamples` / `CubismNativeSamples` / `CubismUnityComponents`、`guansss/pixi-live2d-display`、`emilianavt/OpenSeeFace` 和 `DenchiSoft/VTubeStudio`。当前工程继续复用 `image2live2d` 的 PSD/图层输入、标准参数、网格与物理模板、JSON 兄弟文件生成和 QA 思路，但不直接采用其 `.cmo3` 作为正式成品：该项目 README 明确把 Cubism Editor 目标标为实验性，且本项目先前已在官方 Editor 中验证自动产物存在非法对象 ID 与缺失 ArtMesh 数据。其本地版本为提交 `b3fea7536f2d680897dbf5cce5a13046da75803c`，许可证为 Apache-2.0。

最终运行时优先以 Live2D 官方 Samples 为行为基准：Web 版负责模型装载、参数、动作、物理和点击区域；若后续做 Unity/桌面版，再分别参考 Unity Components 或 Native Samples。`pixi-live2d-display` 可用于快速网页集成，但它不是 Editor 建模器，也不能修复肩肘髋膝接缝。动捕可用 OpenSeeFace 输出头姿、眼口数据并写一层参数映射；VTube Studio 仓库主要用于其公开 API、热键和自定义参数接入，不是 VTube Studio 完整程序源码。官方 Cubism Editor 没有可替代人工网格修形的公开 GitHub 自动建模 API，因此肩、肘、腕、髋、膝、踝、Glue 与物理链仍必须在 Editor 中完成。复用第三方代码前还要分别核对项目许可证与 Live2D Cubism SDK 许可证，不能只按 GitHub 仓库公开状态判断可商用性。

## 2026-08-25｜校准双肩轴并绑定左右肩三关键形

本次继续只在 Live2D Cubism Editor 5.3.03 的正式工程中操作。先打开画布顶部的 ArtMesh 与 Deformer 显示开关，再对 `RotShoulderR` 和 `RotShoulderL` 使用 `Ctrl + Drag` 移轴，因此只移动 Rotation Deformer 的轴心，不改变子级中性位置。右肩轴最终位于窗口局部约 `(1825, 690)`，左肩轴位于约 `(1628, 745)`；证据为 `exports/cubism-rotshoulderr-pivot-final.png` 与 `exports/cubism-rotshoulderl-pivot-final.png`。

两个 Rotation Deformer 已分别绑定标准参数 `右肩 上下` 和 `左肩 上下` 的 `-1 / 0 / +1` 三关键形。右肩在参数三点对应实际 `+8° / 0° / -8°`，两端目视未出现透明裂缝；左肩最初测试 `-8°` 时暴露出一块悬空底绘，说明“轴心正确”不等于“大动作已连续”。当前将左肩安全范围收紧为 `-4° / 0° / +4°`，两端未再观察到碎片或漏底；后续必须通过 `WarpArmL/R` 修正肩口体积和底绘遮挡后才能放大角度，不能把缩小动作当成最终解决方案。验收截图为 `exports/cubism-right-shoulder-param-minus-plus8.png`、`exports/cubism-right-shoulder-param-plus-minus8.png`、`exports/cubism-left-shoulder-param-minus-minus4.png` 和 `exports/cubism-left-shoulder-param-plus-plus4.png`。

在 2560×1600、Editor 最大化布局下，肩参数滑块的 `-1 / 0 / +1` 点击位置约为屏幕 `x=709 / 817 / 926`；`左肩 上下` 行中心约 `y=1371`，`右肩 上下` 约 `y=1410`。Rotation 检视面板的角度输入框中心约为屏幕 `(650, 802)`。必须先单击字段并确认 `0.0` 文本被选中，再粘贴数值；字段没有取得焦点时发送 `Ctrl+A` 会选中全模型。这个坐标只适用于本次最大化布局，窗口尺寸或面板高度变化后必须重新截图。

保存时对“未使用的原画有5张，要删除吗？”选择了“否”。正式文件与里程碑 `model/cubism/bamboo-crane-maiden-shoulder-params-v1.cmo3` 均为 `44,842,966` 字节，SHA-256 均为 `F589F86EBAED3A74DCD1C86EB70D7DE69EE554BA84E0AF1562CD9DCF74FAC9A8`。当前仍未完成肩部 Warp 修形、肘腕、髋膝踝、物理或运行时导出。

## 2026-08-25｜消除半闭眼双影，建立左右手臂独立 Cubism 层级

本次继续只在 Live2D Cubism Editor 5.3.03 的正式工程中制作，网页 PNG 拼片版没有再作为模型质量基线。双眼原先只在 `0 / 1` 两端绑定不透明度，`EyeOpen=0.5` 时睁眼纹理与闭眼睫毛各以 50% 同时出现，形成明显双影。现在四个 ArtMesh 均增加中间关键点：`ArtEyeClosedR/L` 在 `0 / 0.5 / 1` 为 `100 / 0 / 0%`，`ArtEyeR/L` 为 `0 / 100 / 100%`。`0 / 0.5 / 1` 三档已在 Editor 中目视验收，证据为 `exports/cubism-eyes-closed-continuous-final.png`、`exports/cubism-eyes-half-continuous.png` 和 `exports/cubism-eyes-open-continuous-final.png`。

手臂结构从共享 `WarpArmsSleeves` 向下拆成两条独立链：`RotShoulderR → WarpArmR → ArtArmR` 与 `RotShoulderL → WarpArmL → ArtArmL`。两个局部 Warp 都使用 `5 × 5` 分割并勾选“考虑子元素的关键点”，因此边界只拟合各自整臂而不是整画布。该里程碑只证明左右整臂可以独立进入后续参数绑定；肩轴尚未移动到解剖关节，肘腕也尚未建立局部关键形，不能把层级存在说成手臂动作已经完成。

Cubism 的 Java/AWT 会残留不可交互的“形状的特殊粘贴选项”空白窗口。窗口关闭按钮不可靠，但可只对确认过句柄和尺寸的该 `SunAwtDialog` 调用 `ShowWindow(..., SW_HIDE)`，不要结束 Editor 进程。参数面板的纵向位置会随检视面板内容改变；无对象选中时，左右眼行中心约为窗口本地 `y=918 / 995`，滑块左中右约为 `x=635 / 701 / 767`。直接在错误坐标发送 `Ctrl+A` 会选中全模型并触发特殊粘贴窗口，因此每次变更布局后必须重新截图确认。

正式文件与里程碑 `model/cubism/bamboo-crane-maiden-eyes-arm-hierarchy-v1.cmo3` 均为 `44,828,917` 字节，SHA-256 均为 `9B5ABE8C875E98BDCD932656F49E3A910C0C8DCC267B9D03D1124A51828DFFF2`。保存时仍会询问是否删除 5 张未使用原画，必须选择“否”，否则会破坏当前闭眼睫毛和回退素材。

## 2026-08-25｜Cubism 双眼与颈根头部旋转里程碑

正式工程已在 Live2D Cubism Editor 5.3.03 内完成双眼独立网格和头部颈根旋转的第一版绑定。`ArtEyeR` / `ArtEyeL` 分别挂在 `WarpEyeR` / `WarpEyeL` 下，并绑定标准左右眼开合 `0 / 1`；闭眼时脸底与头发不再被整块压缩。当前闭眼线仍有少量绿色虹膜残线，后续应新增独立闭眼睫毛 ArtMesh，用不透明度反向驱动，不再继续压缩整只眼睛。

新增 `RotHead` Rotation Deformer 并放在 `WarpHeadFace` 上级。可复用的校轴流程是：先将子 Warp 临时脱离为 `[Root]`，在无子级状态下把 Rotation Deformer 轴心移到解剖关节，再将子 Warp 挂回。直接带着子级拖轴会一起拉动头脸，造成颈肩裂口。`Angle Z -30 / +30` 当前映射为实际 `-12° / +12°`，旋转轴已位于颈根，头脸和发根连续跟随，躯干与双臂保持不动，未观察到明显透明断口。

正式工程与回退点 `model/cubism/bamboo-crane-maiden-head-anglez-neckpivot-v1.cmo3` 均为 `33,917,905` 字节，SHA-256 均为 `D07A72A06E3649EC60C3944034274A780FAB6E27FF89EA618DDFE4DB57E9A573`。联系表为 `exports/cubism-head-anglez-neckpivot-contact-sheet.png`，双眼闭合证据为 `exports/cubism-eyes-both-closed-refined.png`。这一里程碑仍只完成头部与双眼；双臂、双腿仍是合并区域 Warp，不能声称已消除全身“拼片感”。

## 2026-08-25｜修复 Cubism 整画布网格，重建真实局部连续变形底座

本次复核发现此前所谓区域 Warp 仍有根本性缺陷：`tools/build_cubism_psd.py` 把每张带透明区的 PNG 以完整 `1254 × 1254` 尺寸写入 PSD，29 个 PixelLayer 的记录边界全是 `(0, 0, 1254, 1254)`。Cubism 因而把局部 ArtMesh 和 Warp 的拟合范围理解成整张画布；选中 `WarpHeadFace` 后网格覆盖全角色，不能据此声称已经实现连续局部变形。

修复方式是在写 PSD 时先读取 alpha 的非空包围盒，裁出真实像素区域，再把包围盒左上角通过 `PixelLayer.frompil(..., top=..., left=...)` 写回原始画布坐标。旧源文件已保留为 `model/cubism/bamboo-crane-maiden-source-fullcanvas-v1.psd`；新的正式源仍为 `model/cubism/bamboo-crane-maiden-source.psd`，体积从 `53,183,466` 降至 `12,097,190` 字节，29 个 PixelLayer 均不再是整画布边界。重新合成后的中性相似度仍为 `99.9938%`，Alpha IoU 为 `99.5009%`，说明裁层没有改变中性外观。

Cubism 还有第二个坑：只选中 Part 后执行“创建弯曲变形器”，新增对象虽然显示在该 Part 下，但默认追加目标可能把 `ReferenceNeutral` 和后续对象一起纳入，网格仍会铺满画布。可靠做法是展开 Part，明确多选该区域的全部 ArtMesh，再创建 Warp 并勾选“考虑子元素的关键点”。当前正式工程已按此方法建立 `WarpHeadFace`、`WarpRibbons`、`WarpArmsSleeves`、`WarpTorso`、`WarpSkirt`、`WarpLegsFeet`；每个网格均已在 Editor 中目视确认只覆盖对应真实区域。

`WarpHeadFace` 已绑定标准参数 `Angle X` 的 `-30 / 0 / +30` 三个关键形，极值采用上部控制点水平剪切、下部逐渐收束的方式，避免整块头图绕点旋转。验证图为 `exports/cubism-trimmed-head-anglex-contact-sheet.png`；头部 ROI 的极值相对中性分别有 `30,877` 和 `31,661` 个变化像素，左右极值之间有 `33,874` 个变化像素。正式工程 `model/cubism/bamboo-crane-maiden-editor.cmo3` 大小为 `6,878,144` 字节，SHA-256 为 `4F3944006F669275C4AC80AFB91D57E9724B8898F66CE8B9F1E8A4245137B73A`，同哈希里程碑为 `model/cubism/bamboo-crane-maiden-trimmed-continuous-regions-v1.cmo3`。

当前边界必须说清：新的正式工程已经解决“透明整画布层导致局部 Warp 失真”并完成六个连续区域及头部左右转，但尚未重新加入 Rotation Deformer、眨眼、Angle Y/Z、四肢关键形、Glue、物理和运行时导出。旧 `head-anglez-v1` 与 `rotation-hierarchy-v1` 只作为旧源路线的历史回退点，不能与新正式工程的完成度相加。

## 2026-08-25｜官方 Cubism 工程与 Warp 层级里程碑

正式路线已在 Live2D Cubism Editor 5.3.03 中落地。源 PSD 为 `model/cubism/bamboo-crane-maiden-source.psd`，正式编辑工程为 `model/cubism/bamboo-crane-maiden-editor.cmo3`。旧的 `model/bamboo-crane-maiden.cmo3` 在官方 Editor 中出现 24 个非法对象 ID 和缺失 ArtMesh 顶点，已确认只保留作失败样本。PSD 共 29 个合法像素层，其中 13 个是肩肘、腰髋、腿脚的隐藏补绘；中性 alpha 加权 RGB 相似度为 99.9938%，Alpha IoU 为 99.5009%。

当前 Warp 树使用“区域 Warp → 局部 Warp → ArtMesh”：`WarpHeadFace` 下挂双眼、发梢、发根和头底，`WarpRibbons` 下挂上下披帛，`WarpArmsSleeves` 下挂左右臂，`WarpTorso` 下挂身体，`WarpSkirt` 下挂左中右裙片，`WarpLegsFeet` 下挂左右脚。正式文件与里程碑 `model/cubism/bamboo-crane-maiden-warp-hierarchy-v1.cmo3` 的 SHA-256 已核对一致。该里程碑尚无 Rotation Deformer、参数关键形、Glue、物理或运行时导出，不能称为可操演成品。

Cubism 是 Java/AWT 界面，Win32 坐标操作必须以原始分辨率截图为准。应用中的图片预览会把 2160×1200 截图缩到 2048 像素宽；直接读取预览坐标会产生约 31 像素纵向误差，刚好错选一行。可靠做法是从 2560×1600 全屏截图裁出 501×701 的原尺寸 Part 面板，再读取行中心。每次保存、切换父级或重开文件后都要重新截图，因为 Part 面板会自动滚动，不能跨操作复用旧行号。

“创建弯曲变形器”对话框在这个版本中会残留为不可交互的空白 `SunAwtDialog`，挡住工具详情的父级下拉框。文件保存后应重启正式 Editor 进程，再以带引号的路径启动：`CubismEditor5.exe "<absolute .cmo3 path>"`；未加引号时工作区空格会让启动器只打开空白 Editor。父级列表顺序会随新增和重挂变形器动态变化，禁止沿用旧索引或用 `Home/Down` 猜选；必须打开当前下拉列表，滚动到可见的完整名称后点击，并用工具详情和变形器树双重验收。

## 2026-08-25｜从 PNG 切片原型切换到官方 Cubism 连续形变

本次视觉复核确认：旧网页虽然通过了既定动作和输入门禁，但肩、腰、袖片、裙片等区域仍呈现明显“碎片拼接”感。根因不是弹簧参数不足，而是运行时主要让整块 PNG 绕枢轴旋转；现有自动 MOC 报告也显示只有 1 个 Warp Deformer、0 个 Rotation Deformer、0 个 Glue、0 个 Drawable Mask，无法支撑全身大动作的连续形变。以后不能再把“动作存在”和“像 Cubism 一样连续”混为同一验收结论。

正式路线改为 Live2D Cubism Editor 5.3 稳定版。`model/bamboo-crane-maiden.cmo3` 是 image2live2d 的实验写出物，在官方 Editor 未安装、未实际打开保存之前不得称为可编辑工程。官方下载安装页要求用户本人接受软件授权协议；自动化可以准备素材和打开下载页，但不能代替用户同意 EULA 或处理许可证认证。

重制规范沉淀在 `docs/CUBISM_REBUILD.md`。可复用判断是：单图关节分层必须先补全被遮挡的身体和衣物底绘，相邻关节在不可见区保留重叠；Rotation Deformer 只负责方向，Warp Deformer 恢复体积，Glue/共享父变形器维持接缝，Clipping Mask 与 Draw Order 处理遮挡。中性姿态的 95% 相似度和大动作的无裂缝、无重复残影必须分成两套门禁，不能通过显示原图整帧来冒充模型质量。

## 2026-08-24｜单图到 Live2D/Cubism 多目标交付

本次判断的关键点是先区分“标准 Live2D 包”“Cubism 可编辑工程”和“网页里会动的图片”。参考仓库的 CLI 默认只写 Live2D JSON 兄弟文件，`model3.json` 会引用一个并未生成的 `.moc3`；只有显式向 `Live2DEmitter` 注入 `native_moc_writer` 才会得到完整 MOC。以后复用该仓库时不要只看 README 或 `.model3.json` 存在与否，应检查引用目标是否真实存在，并用 `read_moc3 → write_moc3` 做字节往返校验。

当前可复用的完整构建入口是工作区根目录的 `Build-All.ps1`。它先运行 `tools/build_assets.py`，再运行 `tools/build_model.py`。后者会安全清理 `model/live2d/` 的旧生成物，防止重复构建留下旧纹理；清理前严格验证目标的父目录就是当前工作区的 `model`，避免递归删除路径计算错误。

单张成品图没有分层真值。为同时满足外观和可绑定性，采用双轨：参考模式直接以原图为母版，建立可量化的整帧相似度；透明模式使用背景提取立绘，生成 image2live2d 语义图层。这样不会拿“背景完全不同的透明图”和原始场景做无意义逐像素比较。当前浏览器动态帧对参考母版的归一化像素相似度为 99.3676%，但这个数字只适用于参考模式，不应外推成透明角色身份相似度。

图像生成工具可能把棋盘格当成真实像素返回。只用高亮阈值会留下被衣带或发环封闭的棋盘格块；只用全局中性色删除又会伤到眼白和浅色衣料。当前方案先从画布边缘对高亮中性色做连通搜索，再补充删除全局亮灰核心，并保护面部矩形，最后只对检测到的背景边界做轻微羽化。这个方法适用于背景是浅灰棋盘格、主体有明确色相与描线的插画，不适用于主体本身是大面积纯白无描边的素材。

所谓“2048 发丝”在栅格 Live2D 中不应伪装成 2048 个独立矢量网格。实现采用 2048 个逻辑相位，聚合成 32 个垂直渲染切片，每片 64 条子模拟；它能形成细微不一致的发梢风动，同时保持浏览器开销稳定。发根固定系数 0.95 通过距离根部的位移衰减体现。厘米、米每秒和 GPa 在没有物理世界标尺的 2D 画布中只能作为设计/控制参数；服装 200 GPa 的可观察结果是完全静态，而不是声称进行了真实材料有限元模拟。

浏览器验收脚本是 `tools/verify_viewer.mjs`。它使用系统 Edge，通过 Playwright 抓取两种模式截图，比较相隔 360 ms 的 Canvas 像素，并断言允许区域外变化不超过阈值。这样验证的是“镜头/服装确实不动”，不是仅靠阅读代码推断。当前证据为 520 个动态采样像素、允许区域外 0 个、控制台错误 0 个。脚本还直接采样眨眼函数在两个 1.52 秒周期内的关键时间点，并检查参考模式相似度不低于 95%。

上游全量测试初次出现 1 个失败：托管 GPU 任务在 `release()` 之前就把 `job.status` 暴露为终态，调用方会观察到任务结束但资源引用尚未释放；另外测试中的假服务会进入较长重试。修复位于 `image2live2d-upstream/src/image2live2d/app/server.py`：托管隧道进入分解前再次执行 5 秒健康预检；异常路径先释放 GPU 引用，再发布 `error` 状态。最终结果为 513 passed、10 skipped、0 failed。这个改动只适用于托管 GPU 异常路径，不改变静态 URL 或模型构建逻辑。

Cubism `.cmo3` 是参考仓库的实验写出器产物。当前环境没有安装专有 Cubism Editor 5，所以能证明的是文件已生成、结构生成阶段无异常；不能证明 Editor 的所有版本都能无警告打开。标准 `.moc3` 的验证强度更高，因为完成了实际解码、重编码和字节一致性检查。交付时必须保持这个边界说明。

## 2026-08-25｜把“会动”改造成可复核的视觉验收

新增独立验收入口 `tools/visual_acceptance_agent.mjs`，使用 Playwright 驱动系统 Edge，在确定性时间点抓取 `idle/wind/arm/step/blink`，再以 Sharp 计算区域差分、参考一致性、眨眼差分形状、锚点背景暴露信号和帧率。旧页面未实现统一调试接口时只兼容抓取真实存在的 `idle/wind/blink`；`arm/step` 明确标为 `unsupported`，避免把“代码可能存在”当成视觉证据。可复用接口契约和门槛见 `docs/VISUAL_ACCEPTANCE_AGENT.md`。

本次最重要的验收判断是：参考模式直接画回原图所得的 99% 以上相似度只能证明原图显示完整，不能证明透明角色模型与参考图相似。真正模型证据改用参考图与透明母版的画布对齐 alpha 加权像素比较；首轮基线整人约 73.95%、面部约 45.91%，因此 95% 目标尚未实现。另一个坑是 ROI 相互污染：早期衣料和锚点范围覆盖了头发风动边界，会把头发变化误计为衣料运动和锚点漂移；默认衣料与腰部锚点 ROI 已下移，未来若角色布局变化，应由页面通过调试接口提供准确区域，而不是继续硬编码猜测。

## 2026-08-25｜从眨眼 Demo 重构为全身操演系统

这次需求纠偏的核心不是“再补一条腿或一片衣摆”，而是把驱动、身体、二次物理和玩法分成四个一级子系统。`viewer/app.js` 现以自动待机、人工操偶、动捕、时间轴作为基础驱动源，再按通道应用键盘动作覆盖，最后统一叠加二次物理。稳定的外部接口是 `window.live2dControl`；状态至少公开输入键、驱动来源与优先级、全身参数、左右脚接触/锚点/滑移、风、发丝、衣料、动作和表情。以后接 MediaPipe 或 OSC 时应走这层归一化接口，不要把特定 SDK 直接耦合到渲染器。

腿脚不能只用“整人上下抖”冒充。当前步态以 gait phase 计算骨盆重心、左右膝和脚部抬起，并明确给出 `feet.left/right.contact`、固定锚点与 `slidePx`。玩家验收连续采样接触状态，要求出现支撑脚切换且所有接触帧滑移不超过 2px。确定性视觉测试与实时玩法的参数应分开：验收 `step` 固定腰封连接区、只比较自由腿脚；实时 `WASD` 仍保留骨盆和重心转移。否则一个合理的全身平移会被连接区像素门槛误判为撕裂。

第一次大幅抬臂和衣片位移暴露了典型的单图分层问题：宽多边形从主体底图完全扣除后，移动时肩部和腰部会直接露出舞台。可复用修复不是把动作关小到看不见，而是为没有遮挡补绘的部位保留纹理底片：头/脚保留完整切口，手臂底图只按肤色蒙版扣掉原手以避免双手，袖面保留为遮挡底片；裙片与披帛也在刚性底图中保留参考纹理，再叠加动态自由层。连接区 ROI 必须落在真正固定的腰封像素上，不能覆盖发梢、袖口或裙片边缘。

角色配准使用 `tools/probe_alignment.py` 探测统一缩放/平移，最终采用 0.97、`(+68,+100)`，并在 `tools/build_assets.py` 中同时作用于主图、四肢、眼睛、衣料和 image2live2d 语义层。只变换审计母版会制造虚假高分，所有可渲染层必须共享同一坐标变换。高频像素仍因隔离图与参考图重采样不同而停在约 91%；最终方案以隔离图提供 alpha、已配准参考图提供 RGB，并把同样纹理写入每个实际运行层。这样透明角色整人和面部 alpha 加权相似度均为 100%，适用边界是姿态一致且透明蒙版可靠，不能用于声称遮挡背面被恢复。

眨眼已从肤色椭圆覆盖改成独立眼睛图层纵向压缩，完全闭合时只画细睫毛线。视觉门禁用闭眼差分包围盒高宽比 `<= 0.65` 排除“拿一块皮肤色盖住眼睛”的假实现。物理层采用独立阻尼弹簧，至少包括左右头发、发梢、左右袖、三片裙摆和上下披帛；鼠标拖拽、按键/手柄动作和时间轴向同一个风场注入脉冲，因此释放后可以验收连续回弹，而不是开关式跳变。

最终统一验证入口改为 `node tools/verify_viewer.mjs`，它顺序运行严格视觉 Agent 与玩家操纵 Agent，再写 `exports/viewer-verification.json`。当前结果为视觉 20/20、玩家 26/26，控制台错误 0。单独定位视觉问题用 `node tools/visual_acceptance_agent.mjs --strict`，定位输入问题用 `node tools/player_control_sim_agent.mjs`；前者的联系人图最适合看肩、腰、脚踝穿帮，后者的 JSON 最适合看驱动混合、脚锁和输入释放。

## 2026-08-26｜正式 Cubism MVP 导出与官方 Viewer 实播

正式工程 `model/cubism/bamboo-crane-maiden-editor.cmo3` 已在本轮保存，保存对话框明确选择“否”，保留 7 张未使用原画。导出采用 Cubism Editor 的“导出为 moc3 文件”，目标目录为 `model/cubism/runtime-mvp-v1/`，得到 `bamboo-crane-maiden-mvp.moc3`、对应 `.model3.json`、`.cdi3.json` 和 `bamboo-crane-maiden-mvp.2048/texture_00.png`。`model3.json` 的纹理相对路径经检查与真实目录一致；官方 Cubism Viewer 5.3.03 成功打开该 `.model3.json`，截图为 `exports/cubism-viewer-mvp-final.png`。

同一保存点额外复制为本地回退 `model/cubism/bamboo-crane-maiden-mvp-fullbody-root-v1.cmo3`，SHA-256 为 `D8A642444B266C7DB06462A9DAADF9EA04EFDABF379456744410829298D9834B`。该 checkpoint 依既有忽略规则不进入 Git；可交付的运行时目录则已单独从忽略规则中豁免，确保推送时包含 `.moc3`、纹理和 Motion3。

为了给 MVP 一个无需网页原型即可播放的待机动作，新增符合 Motion3 v3 结构的 `motions/MVP_idle.motion3.json`，并在 `model3.json` 的 `Motions.Idle` 中登记。曲线驱动左右眼开合、头部 `Angle Z` 和左右肩：周期精确为 1.52 秒，闭眼窗口 0.70–0.80 秒。Viewer 展开 `motions → Idle` 后可选择该文件并点击“播放”；实播两个时间点的模型区域差分为 28,370 像素、边界为 `(1342,473)-(1857,1380)`，属于角色画面而非左侧界面变化，证据为 `exports/cubism-viewer-mvp-motion-evidence.png`。这验证了导出模型、纹理和 Motion3 曲线能共同加载、并实际驱动角色。

本次导出窗口中 `physics3.json` 选项是禁用状态，原因是 `.cmo3` 尚未建立 Cubism Physics 配置；不能为满足文件清单伪造物理文件或声称衣发已经物理化。`Run-MVP-Viewer.ps1` 提供一键启动官方 Viewer 的入口。今后 Editor 操作按“同一对话框内的可逆步骤批量执行，保存、导出和播放才复核”的节奏，避免对每一个鼠标动作都截图确认。

## 2026-08-26｜质量失败复盘与重建约束

老板对 `runtime-mvp-v1` 的实机评价是“人物拼接感严重，眼睛像夸张贴片，一运动就是贴片旋转”。复核后接受该结论：本包只能证明 `.moc3 + model3 + texture + Motion3` 的技术通路，不能证明角色达到 Live2D 的视觉质量；README 和重建规范已把它降级为失败样本。以后不得再把“能导出、Viewer 能加载、像素有变化、单个参数可动”描述成“可用成品”。

根因一是把单张参考图的自动切层当作可直接绑骨的原画。即使裁层坐标正确，袖子下的手臂、腰带下的躯干、裙下双腿、眼睑下的眼球和被头发覆盖的脸仍缺少为大动作准备的连续绘制内容。以前添加的 Underpaint 只是补洞，不能代替按关节方向重新绘制的身体底片。下次先完成新 PSD：相邻部位在遮挡区必须重叠，脸部必须拆为脸底、眼白、虹膜、高光、上眼睑、下眼睑和睫毛，并先在静止状态人工审核比例。

根因二是建模顺序颠倒。当前动作先接了参数和 Rotation Deformer，再试图依靠小幅度来掩盖形变不足；这让肩、头和大衣片看起来是绕轴旋转的贴纸。正确顺序是先为一个关节完成中性、正向极值、反向极值和中间值的局部 Warp 修形，再把 Rotation 作为方向输入，最后才接 Motion / Physics。任何能看出整片图绕点转的帧都要回到网格和底绘，不能缩小幅度后放行。

根因三是验收错位。此前的自动化只覆盖文件完整性、允许区域差分、参数曲线与旧网页输入，无法判断人物是否整体、眼睛是否压脸、衣纹是否连续。新的强制门依次是：先看中性全身和面部，再看每个关节的中间与正反极值，然后看连续播放，再看 Physics，最后才看操演/动捕。任一前序门没有通过，后续测试结果不构成完成证据。

根因四是执行管理失当。为赶出可运行包而保留错误层级、逐鼠标步骤截图、没有在发现质量不足时立即止损，造成大量忙碌但没有把成品变好的工作。以后同一稳定面板内的可逆操作必须批处理；截图只服务于视觉质量门、保存、导出和播放。时间与质量无法同时满足时，要先向老板报告真实边界，不得静默把“完整 Live2D”降格成“技术 MVP”。

老板重新给出的要求已独立写入 `docs/USER_ACCEPTANCE_SPEC.md`：全身连续、固定镜头下的真实待机、1.52 秒眨眼、正常面部比例、关节三姿态修形、衣发物理、操演/动捕/时间轴共用参数、以及静态 95% 相似度与动态质量分离验收。后续任何路线选择先对照该文；与其冲突的旧网页原型、自动拆层数据和技术导出都只能作为素材或失败教训，不能作为成果。

## 2026-08-27｜V2 眼部重建：定位关键形绑定成功条件，并停止错误的整画布 Warp 路线

本轮先验证了 Editor 的原生 Win32 鼠标事件能实际拖动 Java Canvas 的 Warp 分割点；此前 `pywinauto` 的 press/move/release 只会形成看似执行、实际无形变的假阳性。随后在 `WarpEyeR` 被正确选中、右眼开闭为 `0.0` 时点击“新增 3 个关键形”，参数行确实出现 `0 / 0.5 / 1` 三个绿色关键点，其中 `0` 点带红框。这是“当前编辑真的落到参数关键形”而不是直接改基础网格的必要视觉证据。

但本工程当前源层级存在决定性限制：从变形器树直接多选命名为右眼的睫毛、眼白、虹膜、瞳孔等 ArtMesh，再以“设为所选对象的父级”创建 Warp，会把共同父级 `ReferenceNeutral` 及其全体子元素一并纳入，生成覆盖全角色的网格。第一次用 Level 2 框选行带时又会把覆盖矩形内的脸底 ArtMesh 选入，闭眼修形把脸拉坏；两种状态均未保存，绝不能补救后当作局部眨眼。随后关闭 Editor 并核对 `bamboo-crane-maiden-face-rebuild-v2.cmo3` 与 `bamboo-crane-maiden-face-rebuild-v2-pre-eyeblink-v1.cmo3`：两者仍为 7,019,892 字节，SHA-256 同为 `5195A9313A98DF54FA4041950EC717CB183B52B52CA0C7ACA049F81EBFC69CD9`。

后续必须先解决“可独立选中的眼部父级”而不是继续对 `ReferenceNeutral` 试坐标：在 PSD 或 Editor 层级中建立只含右眼六层的中间 Part / 父级，确认新 Warp 选择框严格落在眼周后，才进行 `0 / 0.5 / 1` 的 Level 2 成组收拢和 Level 1 微调。每次新建 Warp 的第一质量门是查看其控制框是否只包眼部；若包含脸底、头发或全身，立即不保存退出。此判断能把失败从“做完一轮后才发现参数全错”提前到一眼可见的结构门。
