# V4 Cubism 工作线

权威入口是 `bamboo-crane-maiden-v4-head-production-v3.psd`（`pipeline/v4/build_head_production_psd.py` 以 v3 构建的核心改动：脸底眼部背景板——虹膜/瞳仁/高光回填巩膜色、睫毛带回填皮肤，使眨眼绑定不再与烘焙眼打架；SHA-256 见 `exports/v4-head-production-report-v3.json`）。

最新检查点是 `bamboo-crane-maiden-v4-head-production-v3-import.cmo3`：V3 PSD 在 Live2D Cubism Editor 5.4.00 alpha1 的导入副本，轮廓网格齐全（778 顶点，仅隐藏指南层 4 点），并带第一版淡出眨眼绑定：双眼 8 个眼内层在 ParamEyeLOpen/ParamEyeROpen 上有 @0=透明度0、@0.5=100 的键形，参数 0 时该侧眼睛内容淡出呈闭眼。证据与键位终检见 `exports/v4-blink-state-*.png`、`exports/v4-final-state.json`。

该检查点的已知边界：眼睑平移（睫毛线下落）的网格键形未建（自动化记录失败，需 GUI 人工补）；参数 0.5 中间态偏冲淡；保存时参数面板停在 左眼=1.0/右眼=0.0，编辑器重开需把右眼拨回 1。下一门：人工补 4 个眼睑下移键形 → 核调 0.5 → 头部局部 Warp 与前后发 → 右臂底绘链。禁止在底绘缺失时建全身 Rotation。
