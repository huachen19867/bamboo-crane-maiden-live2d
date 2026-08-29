# V4 清晰母版与首轮 PSD 规格（2026-08-29）

## 为什么这次可以重新开始

旧原图的问题不是文件尺寸小，而是人物在场景中占比有限、身体侧转、仙鹤遮手、袖裙披帛互相遮死。V4 母版改成正面全身、手脚可见、双臂离体、无场景遮挡；这让肩肘腕、髋膝踝、袖摆和裙片第一次有了可分离的中性几何前提。

V4 仍不把生成 PNG 当作成品原画。新 PSD 的第一道职责只是建立可审计的中性分区：每层必须用实际 alpha bbox，所有可见像素必须恰好归属一个层，中性复合必须与清理母版一致，缺少的关节底绘必须显式留在 `UNDERPAINT_TODO`，不能用重复袖片或整片 Rotation 掩盖。

## 当前权威文件

| 项目 | 路径 | 当前证据 |
|---|---|---|
| 原始身份/服装参考 | `assets/source/reference.png` | 只作身份、配色、纹样裁决 |
| V4 生成母版 | `assets/source/rebuild-v4/character-master-front.png` | 真 RGBA，外围有低 alpha 光晕 |
| V4 清理母版 | `assets/source/rebuild-v4/character-master-front-clean.png` | 1024×1536，alpha bbox `(118,12)–(893,1507)` |
| 头部细节指南 | `assets/source/rebuild-v4/head-detail-guide-v1.png` | 1254×1254，已缩小首稿过大的双眼，只作隐藏重绘参考 |
| V4 源 PSD | `model/cubism-v4/bamboo-crane-maiden-v4-source.psd` | 11 个实际裁层，中性实心 RGB 零差异 |
| V4 中性 CMO3 | `model/cubism-v4/bamboo-crane-maiden-v4-neutral-import.cmo3` | Cubism Editor 5.4 alpha1 实际导入并另存；尚无生产绑定 |
| 构建报告 | `exports/v4-source-psd-report.json` | 未分配像素 0，分区重建差异 0 |
| Cubism API 结构报告 | `exports/v4-cubism-api-model-report.json` | API 1.1.0 实读；12 个 ArtMesh 当前均仅 4 顶点 |
| 中性预览 | `exports/v4-source-neutral.png` | 权威清理母版，不是黑底图 |

## PSD 分层路线

第一阶段已经完成几何粗分区：头、双手袖口、双脚、躯干腰封、左右袖、左中右裙。它的目的只是避免再次从整幅场景图开始，不允许直接进入动作验收。

Cubism 5.4 alpha1 的外部编辑 API 已在该 PSD 的真实导入模型上通过连接、授权、结构读取和回滚事务测试。后续可以用 API 批量建立 Part、参数、关键形槽位、Rotation/Warp 和父子结构；但 API 不能写 ArtMesh 顶点或 Warp 控制点。当前自动导入 ArtMesh 只有 4 个顶点，必须先在 Editor 中生成并人工修正沿轮廓、眼睑、衣纹和关节布点的网格。禁止因为 API 能创建 Deformer，就跳过网格与底绘直接套整层 Rotation。

第二阶段必须把 `ArtHeadCombined` 重建为脸部生产层：后发、发髻、前发、左右侧发、脸底、左右眼白/虹膜/瞳孔/高光、上下眼睑、睫毛、眉、鼻影、嘴闭/开、口腔、牙齿/舌。闭眼与开口差分必须来自同一张脸，不允许用肤色椭圆盖眼或拉伸整张嘴。

头部细节指南不直接回灌像素，因为它和全身母版没有严格配准。正确用法是以全身母版的中性脸轮廓和五官中心为坐标，以指南提供的发丝、饰品、眼睑和虹膜细节为重绘参考；所有新层在中性复合时仍必须回到 V4 全身脸的比例，不能让指南把头或眼睛放大。

第三阶段拆关节：每侧至少肩固定端、上袖、肘重叠、前袖、腕重叠、手掌/手指；腿部至少髋固定端、大腿、膝重叠、小腿、踝重叠、脚。当前宽袖和长裙遮住的内部必须专门补绘。Rotation 只提供方向，Warp 恢复体积。

第四阶段拆二次物理：发根/发梢、左右袖自由端、左中右裙自由端、腰带飘带与独立装饰。固定端不得随风漂移，物理输出不得直接驱动整件衣服。

## 下一道质量门

在官方 Cubism Editor 之前，先完成头部生产层和一条右臂关节链的底绘；分别输出中性、正负极值和中间值接触表。只有脸部比例与右肩/肘/腕都没有贴片旋转、透明裂缝、重复衣纹，才扩展到左臂和腿脚。
