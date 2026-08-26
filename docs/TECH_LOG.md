# 技术日志

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
