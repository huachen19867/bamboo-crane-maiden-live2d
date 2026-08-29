# 竹鹤少女 Live2D 研究工作区

当前状态（2026-08-29）：旧制作已紧急暂停并完成大清洗。原图输入风险已经通过新的正面全身人物母版处理，V4 工作线已开始：`model/cubism-v4/bamboo-crane-maiden-v4-source.psd` 包含 11 个实际裁层，中性分区零遗漏、实心角色 RGB 零差异。它仍是几何脚手架，脸部生产层、关节底绘和 Cubism 关键形尚未完成，不能称为 Live2D 成品。

继续工作前先读：

- `docs/HANDOFF_2026-08-29.md`：当前裁决、权威保留集和下一阶段起点。
- `docs/REFERENCE_PROJECTS_RESEARCH_2026-08-29.md`：六个参考项目的源码研究、许可证、验证结果与复用边界。
- `docs/USER_ACCEPTANCE_SPEC.md`：最终视觉、全身动作、物理、操演与动捕要求。
- `docs/TECH_LOG.md`：可复用的判断、踩坑和清洗记录。
- `docs/V4_SOURCE_MASTER_SPEC.md`：新母版、V4 PSD 结构和下一道质量门。

工作区现在只保留三类核心材料：`assets/source/` 中的原图与旧提取对照；`model/cubism/` 中两组 V3 PSD/CMO3 回退和一个旧导出格式参考；`references/live2d-research/` 中六份新研究源码。`exports/` 只留最新 seam-fix 证据与 Anime2.5DRig 样例实跑证据。

下一步不是继续打开旧 CMO3 调动作，而是沿 V4 PSD 拆分脸部生产层，并补一条右臂关节链的真实隐藏底绘；通过静态比例和局部极值门后，才进入官方 Cubism 建模。

旧路线的全部跟踪文件仍可从 Git 历史恢复；未跟踪的临时截图、下载 ZIP、依赖缓存和历史检查点已直接删除，不保证可恢复。
