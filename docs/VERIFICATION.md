# 全身 Live2D 验收报告

验收日期：2026-08-25。环境：Windows、Microsoft Edge Headless、Python 3.12、Node.js。所有结论来自当前工作区的实际构建、浏览器截图和输入模拟，不以代码存在代替运行证据。

## 总结

| 验收面 | 结果 | 关键证据 |
| --- | --- | --- |
| 视觉验收 | 20 pass / 0 fail / 0 unsupported | `exports/visual-acceptance/visual-acceptance-report.json` |
| 玩家操纵 | 26 pass / 0 fail | `exports/player-sim/player-control-sim-report.json` |
| 透明角色整人相似度 | 100% | 参考图 RGB 经同一注册蒙版采样，alpha 加权 RGB 绝对相似度 |
| 透明角色面部相似度 | 100% | 独立面部 ROI，同上算法 |
| 性能 | 约 60 FPS，P95 帧间隔约 17ms | 2.5 秒真实 RAF 采样 |
| 浏览器错误 | 0 | 两套完整场景的 console/pageerror 监听 |
| 模型结构 | lint 0，参数 sweep 通过，MOC3 字节往返一致 | `exports/model-build-report.json` |

这里的 100% 不是“切到参考原图显示”所得。验收器直接读取 `assets/runtime/character-master.png` 的透明角色母版，以其 alpha 为权重，与 `reference-preview.png` 比较 RGB；参考显示完整度另有独立指标。实现采用隔离图提供 alpha、参考图提供配准后的 RGB，这一方法适用于角色姿态与参考一致且已有可靠透明蒙版的场景，不代表被遮挡区域被真实还原。

## 动作与物理门槛

视觉 Agent 通过 `window.__LIVE2D_DEBUG__` 在确定性时间点抓取 `idle`、`wind`、`arm`、`step`、`blink`。头发与衣料必须在各自 ROI 内产生可见差分，手臂和腿脚必须有独立差分；腰封连接区在风、抬手和迈步状态下变化比例不超过 2%，背景洞比例不超过 0.1%。双眼闭合差分包围盒高宽比必须不超过 0.65，以排除肤色椭圆盖眼。

当前结果中，头发、左右袖、三片裙摆和两组披帛均产生独立运动。抬手与半步状态可重复取证，连接区门槛全部通过。双眼闭合差分可见且形状通过。关键帧、差分热图和总览都保存在 `exports/visual-acceptance/`。

玩家 Agent 真实发送鼠标、键盘和归一化手柄/动捕输入，验证 `WASD`、`Q/E`、`Z/X/C/V`、`1–4`、拖拽风场和释放回弹。连续按住 `W` 的 12 次采样出现左右脚接触切换，所有接触脚 `slidePx <= 2`。动捕控制头脸时，键盘动作会覆盖相应手臂通道；180 次固定随机种子的乱序输入后，状态没有 NaN、崩溃或控制台错误。

## 驱动能力边界

“自动待机、人工操偶、摄像头动捕、编排演出”均已在页面中实现。内置摄像头动捕采用本地低分辨率光流，把运动中心和左右半区能量映射到头部、骨盆与肩臂，优点是离线、无需上传，缺点是没有精确手指关键点。`window.live2dControl` 提供稳定的外部动捕注入契约，支持把 MediaPipe、OSC 或其他跟踪器的脸/姿态数据与键盘动作和二次物理混合。

## 模型交付边界

标准 Live2D `.moc3` 已实际解码并重编码，结果逐字节一致；`.model3.json` 引用目标全部存在。`.cmo3` 是参考仓库的实验性写出结果，当前机器未安装专有 Cubism Editor 5，因此“文件已生成、头部结构正确”可以确认，“Editor 5 内完全可编辑且无警告”仍需在拥有授权的软件中做最终人工验收。

## 复验命令

```powershell
node tools\verify_viewer.mjs
python tools\audit_delivery.py
```

发布门禁也可以单独运行：

```powershell
node tools\visual_acceptance_agent.mjs --strict
node tools\player_control_sim_agent.mjs
```
