# 玩家操纵模拟 Agent

## 目的

本 Agent 从玩家视角自动操作预览器，验证角色是否真的支持混合驱动，而不是仅检查页面能否打开。测试覆盖鼠标视线、拖拽风场、WASD/QE、动作快捷键、表情、脚步与支撑脚锁定、手柄等效输入、动捕与操偶优先级、输入释放后的回弹，以及连续乱序输入稳定性。

运行入口：

```powershell
node tools/player_control_sim_agent.mjs
```

脚本会自行启动仅监听 `127.0.0.1` 的临时静态服务器与无头 Edge，不依赖 `Start-Preview.ps1`。若已有服务，可通过 `PLAYER_SIM_URL` 指定完整预览地址。输出固定写入 `exports/player-sim/`：

- `player-control-sim-report.json`：机器可读的逐项证据与总判定。
- `baseline.png`：加载后的初始 UI。
- `after-randomized-input.png`：180 次确定性乱序输入后的恢复状态。

任何必需功能缺失都会成为 `fail`，不会以 `skipped` 掩盖。脚本仍会尽量执行完其余场景并产出完整报告，退出码 `1` 表示功能验收失败，`2` 表示测试框架自身发生致命错误。

## 自动化控制 API 最小契约

浏览器全局必须提供 `window.live2dControl`。它是只服务于输入适配、自动验收与调试面板的稳定接口，不应让测试直接抓取渲染器内部私有变量。

```js
window.live2dControl = {
  version: '1.0.0',
  getSnapshot(),
  dispatchInput(event),
  reset(),
  tick(ms),          // 可选；用于确定性推进，正式渲染仍可走 RAF
  getBindings()
};
```

`getSnapshot()` 返回可结构化克隆、仅含普通对象/数组/布尔值/有限数值的数据。最低字段如下：

```js
{
  timeMs: 1234,
  mode: 'puppet',
  input: {
    keys: ['w'],
    pointer: { x: 0.2, y: -0.1, dragging: false },
    gamepad: { connected: false, axes: [0, 0, 0, 0], buttons: [] }
  },
  driver: {
    activeSources: ['idle', 'keyboard', 'physics'],
    // 必须能看出各通道最终由谁控制，用于验证“局部覆盖”而非整人抢占。
    channelOwners: {
      face: 'mocap', head: 'mocap', armR: 'action', armL: 'mocap',
      body: 'keyboard', legs: 'locomotion', cloth: 'physics', hair: 'physics'
    },
    priorities: { manual: 500, action: 400, mocap: 300, idle: 100, physics: 50 }
  },
  params: {
    bodyX: 0, bodyY: 0, bodyAngle: 0, weightShift: 0,
    headX: 0, headY: 0, headAngle: 0,
    shoulderL: 0, elbowL: 0, wristL: 0,
    shoulderR: 0, elbowR: 0, wristR: 0,
    hipL: 0, kneeL: 0, ankleL: 0,
    hipR: 0, kneeR: 0, ankleR: 0
  },
  feet: {
    left:  { contact: true, anchorX: 0, anchorY: 0, slidePx: 0 },
    right: { contact: true, anchorX: 0, anchorY: 0, slidePx: 0 }
  },
  physics: {
    wind: { x: 0, y: 0, speed: 1.2, turbulence: 0.06 },
    hair: [{ id: 'hair-left-tip', offset: 0, velocity: 0 }],
    cloth: [{ id: 'sleeve-right', offset: 0, velocity: 0 }]
  },
  action: { id: null, phase: 0, weight: 0 },
  expression: { id: 'calm', weight: 1 }
}
```

字段可扩展，但上述名称应稳定。`slidePx` 必须是当前接触阶段内脚底锚点与渲染落点的屏幕像素距离，而不是未经投影的模型参数；验收上限为 2 px。

`dispatchInput(event)` 接受与真实输入适配层相同的归一化消息，并立即更新输入设备状态：

```js
// 手柄等效输入
dispatchInput({
  type: 'gamepad', index: 0, connected: true,
  axes: [0.75, -0.55, 0.35, -0.2],
  buttons: [{ index: 0, pressed: true, value: 1 }]
});

// 动捕等效输入
dispatchInput({
  type: 'mocap', source: 'camera-or-osc', confidence: 1,
  face: { eyeLOpen: 0.8, eyeROpen: 0.7, mouthOpen: 0.2 },
  pose: { headX: 0.3, headY: -0.1, armR: 0.4, armL: -0.2 }
});

// 关闭某一动捕源
dispatchInput({ type: 'mocap', source: 'camera-or-osc', active: false });
```

`reset()` 必须释放所有按键/手柄/动捕状态、取消动作，把角色平滑或确定性恢复到默认待机。`getBindings()` 返回 UI 实际采用的键鼠与手柄映射，至少包括 `WASD`、`Q/E`、`Z/X/C/V`、数字表情键、指针视线和拖拽风场。测试不要求内部物理实现方式，但要求快照能观察到真实输入、融合结果和渲染参数。

## 判定设计

键盘测试在按下、保持、释放后 80 ms、释放后约 730 ms 分别采样。通过不仅要求输入状态变化，还要求身体、重心、手臂或腿脚参数变化，并在释放后继续发生衰减/回弹。这样可以识别“只记录按键但角色没动”和“松手瞬移归零”两类假实现。

脚步测试连续采样 12 帧。至少出现一次左右脚接触状态转换；任一处于接触态的支撑脚 `slidePx` 均不得超过 2 px。动作优先级测试先注入面部与上身动捕，再按下动作键，要求快照同时显示 mocap 和 action/keyboard 驱动，并体现手臂通道被动作接管、头脸通道仍由动捕保持。

稳定性场景使用固定种子 `0x2d5a2026` 生成 180 次乱序键盘、指针、手柄和滑杆输入。结束后释放全部设备并等待一秒，快照中所有数值必须有限，页面不得产生 console error/pageerror。

## 2026-08-25 基线结论

旧版预览器只提供透明/参考模式、风速与湍流滑杆、眨眼、高光和鼠标视线。它没有键盘、游戏手柄、动捕、脚底状态、完整身体参数、动作融合、拖拽风场，也没有稳定调试 API。因此当前基线预期只有加载、鼠标视线、模式按钮、风速滑杆和控制台清洁等基础项通过；其余失败是产品能力缺口，不是测试器误报。

这里最值得复用的判断是：视觉上的“裙摆在动”不能证明角色可操纵；必须从输入状态、通道所有权、身体参数、脚底接触和最终页面错误五个层面形成同一条证据链。没有调试快照时只能证明 DOM 收到了事件，不能证明动作融合正确。
