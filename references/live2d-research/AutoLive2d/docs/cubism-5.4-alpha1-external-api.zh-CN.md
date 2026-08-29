# Live2D Cubism Editor 5.4 alpha1 外部集成 API 中文速查

> 整理日期：2026-07-15  
> 适用版本：Cubism Editor 5.4 alpha1；编辑 API 版本 `1.1.0`  
> 记号：`?` 表示可选字段；本文将官方长类型压缩为便于开发时检索的形式。

官方来源：

- [Live2D Cubism Editor 外部集成 API](https://docs.live2d.com/zh-CHS/cubism-editor-manual/external-application-integration-api/)
- [基础外部集成 API 列表](https://docs.live2d.com/zh-CHS/cubism-editor-manual/external-application-integration-api-list/)
- [5.4 alpha1 外部应用程序集成编辑 API](https://cubism.live2d.com/editor-alpha/doc/manual/alpha1/zh/external-api-intergration/index.html)
- [Live2D 官方 5.4 alpha 示例](https://github.com/Live2D-Garage/CubismExternalAppPluginSamples/tree/54alpha/04_EditSample/)

## 1. 协议与连接

| 项目 | 值 |
|---|---|
| 传输 | WebSocket |
| 数据 | JSON，UTF-8 文本 |
| 默认端口 | `22033`，官方说明允许在 Editor 中修改 |
| 本机默认地址 | `ws://127.0.0.1:22033` |
| 普通权限 | 注册应用后，由用户在 Editor 中授权 |
| 编辑权限 | 5.4 alpha1 新增；必须另外启用，只在建模模式有效 |

通用消息格式：

```json
{
  "Version": "1.1.0",
  "Timestamp": 1696233943287,
  "RequestId": "13",
  "Type": "Request",
  "Method": "GetCurrentModelUID",
  "Data": {}
}
```

| 公共字段 | 类型 | 必需 | 说明 |
|---|---:|:---:|---|
| `Version` | String | 否 | API 版本；编辑 API 使用 `1.1.0` |
| `Timestamp` | Number | 否 | Epoch 毫秒 |
| `RequestId` | String | 否 | 响应关联 ID |
| `Type` | String | 是 | `Request`、`Response`、`Event` 或 `Error` |
| `Method` | String | 是 | 方法名 |
| `Data` | Any | 是 | 方法参数或返回数据 |

推荐调用流程：

```text
连接 WebSocket
  -> RegisterPlugin
  -> GetIsApproval
  -> GetIsEditApproval
  -> GetCurrentEditMode == "Modeling"
  -> GetCurrentModelUID
  -> EditBegin
  -> 一组编辑 API
  -> EditEnd(Cancel=false)
```

- 所有建模修改必须放在 `EditBegin` / `EditEnd` 之间。
- `EditEnd(Cancel=true)` 会利用 Editor 历史记录回滚整次编辑，不写入撤销历史。
- 编辑期间 Editor 会锁定用户操作；用户可从对话框取消，外部程序可订阅 `NotifyUndoCancel`。
- `Silent=true` 可短暂隐藏编辑对话框，但操作过久时 Editor 会为安全起见强制显示。

## 2. 基础命令

这些命令来自既有外部集成 API，主要用于认证、读取文档/模型、读取和临时驱动参数。

| 方法 | 最早版本 | 请求 Data | 响应 Data | 用途 |
|---|---:|---|---|---|
| `RegisterPlugin` | 初始注册流程 | `Name, Token?, Icon?, Path?` | `Token` | 注册外部应用并取得/复用令牌 |
| `GetIsApproval` | 0.9.0 | — | `Result:Boolean` | 查询普通通信权限是否已授权 |
| `GetParameterValues` | 0.9.0 | `ModelUID, Ids?` | `Parameters[{Id,Value}]` | 读取当前参数值 |
| `SetParameterValues` | 0.9.0 | `ModelUID, Parameters[{Id,Value}]` | — | 临时驱动参数；不是制作关键形 |
| `GetParameters` | 0.9.0；1.0.1 增加关键点 | `ModelUID? / DocumentUID?` | 参数元数据列表 | 读取 ID、名称、范围、类型、关键点值 |
| `GetParameterGroups` | 0.9.0 | `ModelUID? / DocumentUID?` | `Groups[{GroupUID,GroupName}]` | 读取参数组 |
| `GetDocuments` | 0.9.0 | — | 文档数组 | 枚举物理、建模、动画文档与视图 |
| `GetDocument` | 0.9.3 | `DocumentUID` | 指定文档信息 | 读取一个文档 |
| `GetCurrentDocumentUID` | 0.9.3 | — | `DocumentUID` | 获取当前文档 UID |
| `GetCurrentModelUID` | 0.9.0 | — | `ModelUID` | 获取当前模型 UID |
| `GetCurrentEditMode` | 0.9.0 | — | `EditMode` | 查询当前模式，如 `Modeling`、`Physics`、`Animation` |
| `SetGlobalVersion` | 0.9.1 | `Version?` | — | 固定外部应用使用的 API 版本 |
| `ClearParameterValues` | 0.9.1 | `ModelUID` | — | 清除 `SetParameterValues` 的临时参数缓冲 |
| `GetPhysicsInfo` | 0.9.2 | `ModelUID, Fps?` | — | 获取/设置物理计算 FPS（按官方签名） |
| `SendCubismLog` | 0.9.3 | `Type?, Message, Display?` | — | 向 Editor 日志面板写消息 |

### 2.1 基础事件

| 方法 | 请求 Data | Event Data | 用途 |
|---|---|---|---|
| `NotifyPhysicsFileExported` | `Enabled` | `Path, ModelFilePath` | 监听 physics3 输出 |
| `NotifyMocFileExported` | `Enabled` | `Path, ModelFilePath, Files?` | 监听 MOC3 及关联文件输出 |
| `NotifyMotionFileExported` | `Enabled` | `Path, ModelFilePath` | 监听 motion3 输出 |
| `NotifyMotionSyncFileExported` | `Enabled` | `Path, ModelFilePath` | 监听 Motion Sync 设置输出 |
| `NotifyChangeEditMode` | `Enabled` | `EditMode` | 监听 Editor 模式切换 |

## 3. 5.4 alpha1 编辑会话与反馈

以下接口版本均为 `1.1.0`。

| 方法 | 请求 Data | 响应/Event | 用途 |
|---|---|---|---|
| `GetIsEditApproval` | — | `Result:Boolean` | 查询编辑权限 |
| `EditBegin` | `Silent?` | `Result:Boolean` | 开始一次原子编辑并锁定 Editor |
| `EditEnd` | `Cancel?` | `Result:Boolean` | 提交或回滚整次编辑 |
| `EditSendLog` | `Message` | — | 在编辑进度对话框中写日志 |
| `EditSendProgress` | `Value` | — | 设置进度，范围 `0.0`～`1.0` |
| `NotifyUndoCancel` | `Enabled` | Event `Result:Boolean` | 监听用户取消/撤销本次 API 编辑 |

## 4. 参数关键形 API

| 方法 | 请求 Data | 响应 | 用途 |
|---|---|---|---|
| `AddParameterKey` | `ModelUID, ObjectId, ParameterId, KeyValue` | `Result` | 给一个物体增加参数键 |
| `DeleteParameterKey` | `ModelUID, ObjectId?, ParameterId?, Strict, KeyValue?` | `Result` | 按条件删除物体上的参数键 |
| `MoveParameterKey` | `ModelUID, ObjectId?, ParameterId?, FromValue, ToValue, Strict, ForceOverwrite` | `Result` | 移动参数键值，可选择覆盖 |
| `GetParameterKeys` | `ModelUID, ObjectId` | `Parameters[{Id,KeyValues[]}]` | 读取某物体绑定了哪些参数键 |
| `GetObjectsByParameterKeys` | `ModelUID, ParameterId, KeyValue` | `Ids[]` | 反查指定关键点关联的物体 |

重要：`AddParameterKey` 只创建关键形槽位，不会自动生成有视觉差异的形状。

## 5. 参数与参数组 API

| 方法 | 请求 Data | 响应 | 用途 |
|---|---|---|---|
| `GetParameterStructure` | `ModelUID` | 参数/组树 | 读取完整参数层级、范围和关键点 |
| `AddParameter` | `ModelUID, Name?, Id?, GroupId?, Default?, Min?, Max?, IsBlendShape?` | `Result` | 创建普通或融合变形参数 |
| `AddParameterGroup` | `ModelUID, Name?, Id?` | `Result` | 创建参数组 |
| `EditParameter` | `ModelUID, Id, NewId?, Name?, Min?, Default?, Max?, IsRepeat?` | `Result` | 修改参数元数据 |
| `EditParameterGroup` | `ModelUID, Id, NewId?, Name?, LabelColorType?, LabelCustomColor?` | `Result` | 修改参数组 |
| `DeleteParameter` | `ModelUID, Id` | `Result` | 删除参数 |
| `DeleteParameterGroup` | `ModelUID, Id` | `Result` | 删除参数组 |
| `MoveParameter` | `ModelUID, Id, GroupId, InsertIndex` | `Result` | 在参数面板中移动参数 |
| `MoveParameterGroup` | `ModelUID, Id, InsertIndex` | `Result` | 在参数面板中移动参数组 |

## 6. 选择、部件与物体 API

### 6.1 选择

| 方法 | 请求 Data | 响应 | 用途 |
|---|---|---|---|
| `GetSelectedObjects` | `ModelUID` | `Ids[]` | 读取当前选择；官方 alpha1 标题误写为 `GetSelectedObjecs`，实际接口为 `GetSelectedObjects` |
| `AddSelectedObjects` | `ModelUID, Ids?` | `Result` | 把物体追加到选择 |
| `ClearSelectedObjects` | `ModelUID` | `Result` | 清空选择 |

### 6.2 结构和通用物体

| 方法 | 请求 Data | 响应 | 用途 |
|---|---|---|---|
| `GetPartStructure` | `ModelUID` | 部件/对象树 | 读取部件面板层级 |
| `GetObject` | `ModelUID, Id, Parameters?` | `Type, Data` | 读取默认或指定参数组合下的物体属性 |
| `DeleteObject` | `ModelUID, Id` | `Result` | 删除物体 |
| `MoveObjectOnPartsPalette` | `ModelUID, Id, ParentId?, InsertId?, InsertIndex?` | `Result` | 改变部件面板中的父级和顺序 |

### 6.3 Part、ArtMesh、Glue

| 方法 | 请求 Data（摘要） | 能编辑的内容 |
|---|---|---|
| `AddPart` | `ModelUID, Name?, Id?, DrawOrder?, Ids?, IsNested?` | 创建 Part，可将现有对象放入其中 |
| `EditPart` | `ModelUID, Id, Parameters?, IsExactMatch?, ...` | 名称/ID、父级、分组、引导图、离屏、剪贴、反转蒙版、绘制顺序、透明度、颜色与混合模式 |
| `EditArtMesh` | `ModelUID, Id, Parameters?, IsExactMatch?, ...` | 名称/ID、父级/父变形器、剪贴、反转蒙版、绘制顺序、透明度、颜色、混合、剔除、标签色 |
| `EditGlue` | `ModelUID, Id, Parameters?, IsExactMatch?, ...` | 名称/ID、父级、强度、标签色 |

`Parameters` + `IsExactMatch` 可让属性只作用于指定参数组合。例如可以让嘴部 ArtMesh 在 `ParamMouthOpenY=1` 时颜色变暗；但不能通过它改 ArtMesh 顶点。

## 7. 变形器 API

| 方法 | 请求 Data（摘要） | 用途 |
|---|---|---|
| `GetDeformerStructure` | `ModelUID` | 读取旋转/弯曲变形器树 |
| `AddRotationDeformer` | `ModelUID, Name?, Id?, ParentId?, TargetObjectIds?, Mode?` | 创建旋转变形器并包住/绑定现有对象 |
| `AddWarpDeformer` | `ModelUID, Name, Id?, ParentId?, TargetObjectIds?, Mode?, WarpDivH?, WarpDivV?, BezierDivH?, BezierDivV?, ConsiderChildKeyforms?, SnapCenter?` | 创建弯曲变形器，设置网格分割并包住对象 |
| `EditRotationDeformer` | `ModelUID, Id, Parameters?, IsExactMatch?, NewId?, Name?, ParentId?, ParentDeformerId?, Angle?, BaseAngle?, Scale?, Opacity?, MultiplyColor?, ScreenColor?, LabelColorType?, LabelCustomColor?` | 在指定关键形修改旋转角度、缩放和显示属性 |
| `EditWarpDeformer` | `ModelUID, Id, Parameters?, IsExactMatch?, NewId?, Name?, ParentId?, ParentDeformerId?, Opacity?, MultiplyColor?, ScreenColor?, WarpDivH?, WarpDivV?, BezierDivH?, BezierDivV?, LabelColorType?, LabelCustomColor?` | 修改弯曲变形器层级、显示属性和分割数 |

## 8. API 能做什么

- 注册并鉴权外部 Agent/插件。
- 枚举打开的文档、当前模型、编辑模式、参数和参数组。
- 实时读取/驱动参数值。
- 创建、删除、移动参数以及参数组。
- 创建、删除、移动参数关键形槽位。
- 枚举部件、对象和变形器结构。
- 创建 Part、旋转变形器、弯曲变形器，并重组父子层级。
- 编辑 Part / ArtMesh / Glue 的显示、颜色、遮罩、顺序等属性。
- 在旋转变形器关键形上设置 `Angle` 和 `Scale`。
- 用事务提交或回滚一整批操作，并报告日志/进度。
- 监听模型、物理、动作等文件的导出事件。

## 9. 5.4 alpha1 API 暂时不能做什么

官方 `1.1.0` 接口中没有以下写入能力：

- 没有创建 ArtMesh 的接口。
- 没有修改 ArtMesh 顶点、三角形索引、UV 或纹理坐标的接口。
- 没有修改 Warp Deformer 控制点坐标/贝塞尔控制网格形状的接口。
- 没有给变形器写入任意位置或四角坐标的正式字段；`GetObject` 能返回 `Rectangle`，但 `EditWarpDeformer` 不接受 `Rectangle`。
- 没有绘制侧脸缺失素材、生成耳朵/鼻侧面/口腔内部或修改 PSD 像素的能力。
- 没有创建/编辑物理设置内容的 5.4 alpha 建模接口；基础 API 主要提供物理信息和导出事件。

因此，API 可以自动搭好“参数—关键形—变形器”的结构，但不能仅靠 API 把正脸弯成可信的 45°/90°侧脸，也不能完成抬头时露下巴、低头时改变头顶与发际线的几何重塑。真正的关键形仍需在 Editor 中用网格编辑/控制点拖动完成，或者等待后续 API 开放顶点与控制点写入。

## 10. 常见错误

| ErrorType | 说明 |
|---|---|
| `InvalidJson` | JSON 结构错误 |
| `UnsupportedVersion` | API 版本不支持 |
| `MethodNotFound` | 方法不存在 |
| `InvalidType` | `Type` 字段不合法 |
| `InvalidData` | 缺字段、字段类型或取值错误 |
| `PluginNotRegistered` | 尚未注册或用户未授权 |
| `InvalidParameter` | 参数不存在 |
| `InvalidModel` | 模型不存在 |
| `InvalidDocument` | 文档不存在 |
| `InvalidView` | 视图不存在 |
| `InvalidEditOperation` | 未进入有效编辑事务、编辑被取消或当前操作不允许 |

