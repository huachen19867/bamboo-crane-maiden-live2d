# V4 Cubism 工作线

权威入口是 `bamboo-crane-maiden-v4-head-production-v2.psd`（`pipeline/v4/build_head_production_psd.py` 构建，SHA-256 见 `exports/v4-head-production-report-v2.json`）。它把 `bamboo-crane-maiden-v4-source.psd` 的粗分区头部替换为 22 个头部生产层（脸底、双眼白/虹膜/瞳孔/高光/上下眼睑、双眉、鼻、闭口、双耳饰、前发、后发、头饰），身体/衣裙 10 层保持不变。

最新检查点是 `bamboo-crane-maiden-v4-head-production-v2-import.cmo3`：V2 PSD 在 Live2D Cubism Editor 5.4.00 alpha1 的正式导入副本，已对全部 ArtMesh 执行建模模式「自动生成网格」（Cubism 标准变形预设参数），32 个生产层均为轮廓网格（6–84 顶点，合计 776），隐藏指南层保留 4 点角网格。结构验收与逐层顶点数见 `exports/v4-head-production-import-acceptance-report.json` 与两个 `v4-head-production-import-probe-*.json`。

该检查点仍不是可绑定成品：ArtMesh 是自动轮廓网格，还没有人工网格修正、没有眼口开闭差分、没有变形器/参数关键形、没有任何 Physics。下一门是在 5.4 alpha1 中人工修正眼、口、前后发网格并做双眼 `0/0.5/1` 差分与头部局部 Warp；右臂肩肘腕底绘未完成前不得建立全身 Rotation。禁止直接给该 PSD 加肩肘腕 Rotation 并宣称完成。
