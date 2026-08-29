# V4 Cubism 工作线

权威入口是 `bamboo-crane-maiden-v4-source.psd`。该 PSD 由 `pipeline/v4/build_source_psd.py` 从新的正面人物母版确定性构建，不依赖已删除的旧 PNG 拼片和错误 underpaint。

当前文件是中性几何脚手架，不是可绑定成品。它包含：

- 隐藏的 `00_GUIDE_DO_NOT_RIG/ReferenceMasterFront`；
- `10_HEAD/ArtHeadCombined`；
- `20_BODY` 中的手袖口、双脚、躯干腰封；
- `30_DYNAMIC_GARMENT` 中的左右袖和左中右裙片；
- 隐藏且为空的 `90_UNDERPAINT_TODO`，用于明确阻止在没有底绘时直接做大动作。

中性分区覆盖 640,029 个可见/抗锯齿像素，11 个层的自定义重建与清理母版逐像素一致；PSD 合成器在 633,430 个实心角色像素上的 RGB 差异为 0。精确 bbox 和哈希见 `exports/v4-source-psd-report.json`。

禁止直接给该 PSD 加肩肘腕 Rotation 并宣称完成。下一门是重绘/生成脸底、眼白、虹膜、瞳孔、高光、上下眼睑、睫毛、眉和开闭口差分；随后补肩肘腕、腰髋膝踝隐藏底绘，再进入 Editor 建 ArtMesh 和 Warp 关键形。
