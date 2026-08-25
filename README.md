# 竹鹤少女 · 全身 Live2D 操演系统

这是依据参考图制作的全身 Live2D 风格角色工程，不是只会眨眼的贴图预览。网页运行时把头、躯干、双臂、骨盆、双腿和双脚作为独立驱动通道；发丝、双袖、三片裙摆和两组披帛分别计算风场、惯性与回弹。工程同时交付标准 Live2D `.moc3 + .model3.json` 包、nijilive `.inp`、实验性 Cubism Editor `.cmo3`、透明 4K/8K 素材与可自动验收的浏览器操演台。

## 怎么玩

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

标准 Live2D 入口是 `model/live2d/bamboo-crane-maiden.model3.json`，其 `.moc3`、纹理、物理、显示信息和动作均位于同一目录。`model/bamboo-crane-maiden.inp` 可在 nijigenerate 中继续编辑。`model/bamboo-crane-maiden.cmo3` 由参考项目的实验写出器生成；当前环境没有专有 Cubism Editor 5，因此只完成结构生成校验，不能声称已在 Editor 内无警告打开。

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
