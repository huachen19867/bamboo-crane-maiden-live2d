# 竹鹤少女 · 全身 Live2D 操演系统

> 当前状态（2026-08-26）：`runtime-mvp-v1` 是一次技术导出验证，已能由官方 Viewer 加载和播放，但视觉评审失败：存在拼接感、贴片旋转感和不合格的眼部结构。它不是可交付角色，只保留为失败样本与运行时格式参考。后续重建的验收标准见 `docs/USER_ACCEPTANCE_SPEC.md`。

这是依据参考图制作的全身角色原型。网页运行时已验证头、躯干、双臂、骨盆、双腿、双脚、发丝、衣袖、裙摆和披帛的控制需求，但旧实现依赖 PNG 分片，不能替代 Cubism 的连续 ArtMesh 变形。正式交付将以官方 Cubism Editor 实际打开、保存和导出的工程为准；现有自动生成 `.cmo3` 仅保留作技术实验。

## 怎么玩

### Cubism 技术样品（非成品）

在 PowerShell 中运行：

```powershell
.\Run-MVP-Viewer.ps1
```

Viewer 打开后，在左侧展开 `motions → Idle → MVP_idle.motion3.json`，点击下方“播放”。该样品用于检查导出路径与 Motion3 播放，不可用作视觉质量基准或最终角色交付。运行时包位于 `model/cubism/runtime-mvp-v1/`。

在 PowerShell 中运行：

```powershell
.\Start-Preview.ps1
```

浏览器打开 `http://127.0.0.1:8765/viewer/` 后，可以在四种驱动之间直接切换。“自动待机”负责呼吸、眨眼、重心微动和环境风；“人工操偶”接受鼠标、键盘与手柄；“摄像头动捕”在本机分析画面运动并映射头部与左右肩臂，同时允许键盘动作局部覆盖；“编排演出”按 16 秒时间轴执行回眸、挥袖、阵风、半步、指鹤和行礼。

键盘使用 `WASD` 移步、`Q/E` 转身、`Z` 挥袖、`X` 双袖舒展、`C` 行礼、`V` 指鹤引风，`1–4` 切换表情。鼠标移动控制视线和轻微转头，在舞台拖拽会形成定向风，按住 `Shift` 风力加倍。手柄左摇杆控制步态，右摇杆控制头与手臂，A/B/X/Y 触发动作。点击飘落花瓣可以接取，点击仙鹤会触发回眸、抬手与翅风回应。

驱动不是四选一的死开关。实际通道优先级为人工动作、时间轴、动捕、手柄、自动待机、二次物理；例如动捕控制脸和头时，按 `Z` 只接管右臂，衣摆与头发仍继续计算。

## 全身与物理实现

运行时参数覆盖头部三轴、身体三轴、呼吸、左右肩肘腕、骨盆与重心、左右膝脚、双眼开合与视线。步态按骨盆转移、膝弯、脚部抬起和左右接触状态推进，支撑脚公开锚点与 `slidePx`，自动操纵验收要求接触脚滑移不超过 2px。

二次物理包含左右头发、发梢、左右袖摆、左中右裙片和上下披帛。默认风速 1.2m/s、湍流 6%；舞台拖拽、`V` 动作、手柄扳机和编排时间轴都会向同一风场注入脉冲。2048 发丝指 2048 个逻辑子模拟，最终聚合到可稳定实时渲染的发组，并不伪称 2048 个独立矢量网格。

眨眼周期为 1.52 秒。双眼使用独立眼图层纵向变形和细睫毛闭合线，不再用大块肤色椭圆盖眼。摄像头模式的默认实现是无需云服务的本地光流映射；需要更精确的人脸、姿态或手指关键点时，可由 MediaPipe、VTube Studio/OSC 适配器等调用 `window.live2dControl.dispatchInput({ type: 'mocap', ... })` 注入归一化数据。

## 模型与素材

正式 Cubism 源 PSD 是 `model/cubism/bamboo-crane-maiden-source.psd`，当前编辑工程是 `model/cubism/bamboo-crane-maiden-editor.cmo3`；`model/cubism/bamboo-crane-maiden-shoulders-param-continuous-v1.cmo3` 是已保存的双肩连续参数里程碑。可直接用 `tools/CUBISM/CubismEditor5.exe` 打开正式 `.cmo3`。不要把旧的 `model/bamboo-crane-maiden.cmo3` 当作正式工程：它是参考项目的实验写出物，官方 Editor 已验证其对象 ID 和 ArtMesh 数据不合法。

`model/live2d/bamboo-crane-maiden.model3.json` 及同目录 `.moc3`、纹理、物理和动作仍属于旧网页原型。它们用于保留键鼠、手柄、动捕和时间轴接口，不代表当前 Cubism 重制版已经导出；正式运行时包必须等 Editor 内参数和物理完成后重新导出。

`assets/runtime/character-master-4k.png` 是透明运行纹理，`exports/character-master-8k.png` 是 7680×7680 RGBA 归档图。8K 文件由高质量重采样得到，不等于原生 8K 手绘细节。角色透明蒙版来自隔离图，RGB 纹理由统一坐标配准后的参考图采样，因此实际分层纹理与参考角色保持像素一致，而不是用“参考图显示模式”冒充模型相似度。

## 重建与验证

完整重建使用：

```powershell
.\Build-All.ps1
node tools\verify_viewer.mjs
```

合并验证会真实启动 Microsoft Edge，先运行视觉验收，再运行玩家操纵模拟。当前视觉门禁 20/20 通过，透明角色整人和面部 alpha 加权相似度均为 100%，浏览器控制台错误为 0；玩家模拟 26/26 通过，覆盖拖拽风、WASD/QE、脚底锁定、Z/X/C/V、表情、手柄、动捕混合和 180 次确定性乱序输入。总报告位于 `exports/viewer-verification.json`，视觉联系人图位于 `exports/visual-acceptance/state-contact-sheet.png`。

模型报告位于 `exports/model-build-report.json`，最终交付审计使用：

```powershell
python tools\audit_delivery.py
python tools\package_delivery.py
```

详细门槛和证据见 `docs/VERIFICATION.md`，可复用判断与踩坑记录见 `docs/TECH_LOG.md`。

## 参考项目与边界

`image2live2d-upstream/` 保存了参考工程源码。本项目使用它生成 Live2D/nijilive/Cubism 目标，并修复了托管 GPU 异常路径的资源释放竞态；上游测试结果为 513 passed、10 skipped。单张成品图无法凭空恢复被遮挡的真实绘制内容，本项目通过固定连接区底片、自由端分层和参考纹理配准降低穿帮，但若要达到商业级大角度侧身、完整手指逐节或 360° 旋转，仍需要原画师提供专门的 PSD 分层与遮挡补绘。
