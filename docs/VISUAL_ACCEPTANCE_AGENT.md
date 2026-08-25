# 视觉验收 Agent

本验收体系独立于角色实现，目标是用可重复证据判断“是否真的动了、是否只动了该动的部位、动作是否穿帮、画面是否仍像参考角色”。它不会把参考原图原样显示的高相似度冒充模型相似度，也不会把未实现的动作记为通过。

## 运行方法

在工作区根目录执行：

```powershell
$env:NODE_PATH = 'C:\Users\陈化\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tools\visual_acceptance_agent.mjs
```

脚本会自行启动只读静态 HTTP 服务，以 Playwright 驱动系统 Edge，用 Sharp 做逐像素分析。默认模式始终写出报告并返回成功，适合建立基线；发布门禁使用严格模式：

```powershell
node tools\visual_acceptance_agent.mjs --strict
```

严格模式只要有一个 required 门槛失败或必需状态不受支持，就返回非零退出码。证据统一写入 `exports/visual-acceptance/`，其中 `visual-acceptance-report.json` 是机器可读结论，`state-contact-sheet.png` 用于人工总览，单独的 PNG 保留每个关键状态原帧。

若普通 Node 找不到依赖，脚本会自动查找 Codex Desktop 的内置依赖；也可通过 `CODEX_NODE_MODULES` 显式指定 Node 包目录。

## 最小调试接口

完整验收要求页面暴露 `window.__LIVE2D_DEBUG__`。建议接口如下：

```js
window.__LIVE2D_DEBUG__ = {
  version: '1.0',
  ready: Promise.resolve(),
  getCapabilities() {
    return {
      states: ['idle', 'wind', 'arm', 'step', 'blink'],
      regions: {
        hair: { x: 0.2, y: 0.01, width: 0.48, height: 0.36, normalized: true },
        face: { x: 0.36, y: 0.08, width: 0.18, height: 0.18, normalized: true },
        eyeLeft: { x: 0.40, y: 0.11, width: 0.06, height: 0.07, normalized: true },
        eyeRight: { x: 0.46, y: 0.11, width: 0.06, height: 0.07, normalized: true },
        arms: { x: 0.18, y: 0.17, width: 0.53, height: 0.36, normalized: true },
        cloth: { x: 0.14, y: 0.24, width: 0.72, height: 0.58, normalized: true },
        legsFeet: { x: 0.28, y: 0.65, width: 0.30, height: 0.34, normalized: true },
        anchors: { x: 0.31, y: 0.21, width: 0.24, height: 0.25, normalized: true }
      }
    };
  },
  async reset() {},
  async setState(name, options) {},
  async renderAt(timeMs) {},
  async getTelemetry() {
    return { activeState: 'idle', anchors: {}, footContacts: {} };
  }
};
```

`setState()` 接收的验收状态和选项如下：`idle` 使用 `phase`；`wind` 使用 `phase/wind/turbulence`；`arm` 使用 `phase/side/amount`；`step` 使用 `phase/side`；`blink` 使用 `phase/amount`。`renderAt()` 必须在返回前把给定时间的确定性画面绘制到主 Canvas；同样输入应得到同样像素，不能继续依赖不可控的真实 `requestAnimationFrame` 时间。

接口可以额外提供 `captureReference()` 与 `captureBackground()`，返回 PNG data URL。若没有，验收器会在兼容的旧版 Viewer 中自行取证。`getTelemetry()` 建议提供关节锚点、左右脚接触状态、活动驱动模式和渲染统计，用于把“视觉上像”升级为“视觉与内部状态相互印证”。

## 当前门槛

角色参考一致性采用从参考图和透明角色母版直接计算的 alpha 加权 RGB 相似度，目标为 95%；参考模式原样显示的完整度另行记录，但明确不作为角色一致性的证据。眨眼要求左右眼都有可见差分，且闭眼差分包围盒高宽比不超过 0.65，用于拦截用大块肤色椭圆覆盖眼睛的伪眨眼。风场必须分别在头发和衣料区域产生至少 0.2% 的变化；默认衣料 ROI 从 `y=430` 开始，避免把头发越界变化误算成衣料运动。手臂和腿脚必须存在确定性动作状态并产生区域差分。

锚点稳定门槛为状态切换后锚点区域变化比例不超过 2%；锚点内疑似暴露背景不超过基线占用像素的 0.1%。帧率要求有效帧率不低于 45 FPS，P95 帧间隔不高于 28 ms。穿帮、透明洞和锚点撕裂的自动判定只是信号，最终仍需人工查看状态联系表，特别关注肩、肘、腕、髋、膝、脚踝、领口和腰封。

## 验收解释边界

一个状态标记为 `unsupported`，含义是当前页面无法提供可重复证据，不等同于“代码里可能有，所以算实现”。衣摆或发梢移动后露出原位置的背景可能是正常运动，因此背景同化指标只在锚点区域自动设门禁，在运动区域只保留诊断数据。角色 95% 相似度是对齐栅格的可复核指标；如未来素材结构或坐标系改变，应由调试接口同时提供对齐渲染和准确 ROI，不能靠放宽门槛消除失败。

## 2026-08-25 基线

旧版 Viewer 的第一轮基线能够稳定抓取 `idle/wind/blink`，但没有 `arm/step`，因此两项必须动作被记为 `unsupported`。自动证据确认头发存在变化、页面维持约 60 FPS，同时也确认衣料独立运动不可见，左右眼闭合差分高宽比分别约为 0.79 和 0.91，符合“肤色椭圆遮盖过高”的失败特征。透明角色母版相对参考图的画布对齐整人相似度约 73.95%，画布对齐面部约 45.91%，而参考显示模式的 99.37% 仅代表原图被原样显示，不能作为模型达到 95% 的证据。
