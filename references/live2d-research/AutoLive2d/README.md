# AutoLive2d

AutoLive2d 是一个面向二次元分层 PSD 的开源 Live2D 风格编辑器与运行时。它不依赖 Cubism/Inochi2D 格式，而是把规范化 PSD 自动转换为可编辑、可面捕、可替换材质、可导出成品包的 2D 虚拟角色。

项目采用 React + TypeScript + WebGL/Canvas，并提供 Electron 桌面壳。仓库同时内置经过低显存与 Windows 适配的 [see-through](https://github.com/shitagaki-lab/see-through) 源码，可从单张角色图完成 PSD 拆分，再进入本项目自动绑定。

> 当前实现是自研 Live2D-style 网格运行时，不是 Cubism/Inochi2D 模型导出器。

## Agent 快速入口

第一次接手本项目的 Agent，按下面顺序阅读：

1. [部署指南](docs/deployment-guide.md)：克隆、安装、Web/桌面端启动、see-through 部署和常见问题。
2. [PSD 适配指南](docs/psd-adaptation-guide.md)：图层规范、父子层级、伪 Z、骨骼、动态和新预设接入。
3. [单截图到可面捕成品全流程](docs/screenshot-to-live2d-workflow.md)：image2 生图、see-through 拆 PSD、差分素材、绑定与验收。
4. [算法与工作流](docs/project-algorithms-and-workflow.md)：网格、逐顶点伪 Z、椭圆头模投影、物理、追踪和导出算法。
5. [项目结构](docs/project-structure.md)：源码目录与模块职责。
6. [固定验收清单](docs/rig-validation-checklist.md)：修改算法或适配 PSD 后必须执行的回归流程。
7. [AGENTS.md](AGENTS.md)：给代码 Agent 的仓库级约束与常用命令。

## 核心设计

核心思路是“可模板化的分层网格投影”：

- PSD 图层保留为透明二维材质，并被赋予脸、眼珠、嘴、前发、后发、身体、手臂或 `obj` 等语义。
- 每个部件生成三角网格，可编辑顶点、关键形态、局部坐标、支点和父级。
- 视觉覆盖顺序由 draw `z` 决定；伪 Z 只参与几何投影，不能让后层越过前层。
- 手动模式支持逐顶点伪 Z 和深度图；头模代理模式把顶点投影到以双眼中点为中心的前后椭圆壳层。
- 头部 X/Y 通过伪三维旋转与透视投影产生近侧放大、远侧收缩；头部 Z 围绕可调颈部支点做平面歪头。
- 身体带动脖子和整个头部，避免面捕时头身分离。
- 头发、衣服与附件采用根部固定、末端加权的惯性和飘动模型。
- 已适配模型可导出成品 ZIP，在另一份部署中导入即用；同结构角色可复用模板并替换材质。

## 主要功能

- 导入 see-through 或同类工具生成的分层 PSD。
- 自动识别常见部位，并尽可能拆分合并的双眼、眼珠、眉毛和双臂。
- 编辑部件 X/Y、draw Z、伪 Z、局部缩放、局部旋转、网格、父级和旋转支点。
- 手动伪 Z、深度图、模拟头模三种变形路径。
- 头部 9 轴、身体 4 轴、眨眼、眼球、嘴型、双臂、呼吸、头发和附件动态。
- MediaPipe 摄像头面捕，支持平滑、防抖、补帧、初始零位校准、姿态/手臂追踪和性能档位。
- 小窗预览与 OBS 捕捉，支持透明、绿幕、白幕、黑幕、拖动和缩放。
- 表情差分、普通 `obj` 附件、部件替换、模板/工程/运行时/成品包导入导出。
- Electron 桌面端禁用后台节流，适合编辑器退到后台后继续驱动预览小窗。

## 快速部署

```powershell
git clone https://github.com/Fenglin-Maple/AutoLive2d.git
cd AutoLive2d
npm install
```

浏览器编辑器：

```powershell
npm run dev
```

Windows 桌面端（面捕与 OBS 推荐）：

```powershell
npm run desktop
```

也可以双击：

```text
start-dev-server.bat
start-desktop.bat
```

生产构建：

```powershell
npm run build
```

## 内置 see-through

PSD 拆分器位于 [`third_party/see-through`](third_party/see-through)。源码已随仓库提供，但模型权重、Python 虚拟环境和推理结果不会进入 Git。

Windows 首次安装：

```powershell
cd third_party\see-through
powershell -ExecutionPolicy Bypass -File .\setup_windows.ps1
.\launch_webui.bat
```

然后访问 `http://127.0.0.1:7861`。第一次运行需要从 Hugging Face 下载较大的模型权重。更完整的显存档位和命令行参数见 [see-through 中文说明](third_party/see-through/使用说明-中文.md)。

## 内置预设

仓库当前携带四个可直接加载的适配预设：

- `u3`：默认启动和主要回归模型。
- `u4`：带深度图的另一种 PSD 结构。
- `u5`：单张游戏截图经 image2 + see-through 生成的流程样例。
- `u6`：带帽子、眼镜、头发克隆层和表情差分附件的完整样例。

文件位于：

```text
public/samples/<id>/input.psd
public/samples/<id>/input_depth.psd
public/samples/<id>/attachments.json
public/samples/<id>/attachments/*.png
```

样例 PSD/图片用于功能展示与回归测试，不自动适用项目代码的 Apache-2.0 授权，详见 [第三方与素材声明](THIRD_PARTY_NOTICES.md)。

## 仓库结构

```text
src/                         编辑器、运行时与追踪源码
desktop/                     Electron 桌面壳
scripts/                     检查、验证与 Cubism 实验工具
public/samples/              已适配 PSD 预设
docs/                        算法、适配、部署与验收文档
third_party/see-through/     内置图片转 PSD 工具源码
```

## 开发命令

```powershell
npm run dev
npm run desktop
npm run build
npm run inspect:sample
npm run validate:ui -- --preset u3
```

## 许可证

AutoLive2d 源码采用 [Apache License 2.0](LICENSE)。内置 see-through 也采用 Apache-2.0，并保留其上游许可证、作者归属和本地改动记录。依赖、第三方代码及样例素材的具体边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
