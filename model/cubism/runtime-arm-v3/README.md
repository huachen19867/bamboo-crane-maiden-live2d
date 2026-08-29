# bamboo-crane-maiden-arm-v3

这是从官方 Live2D Cubism Editor 5.3.03 导出的右臂 V3 局部运行时包。它包含右肩父链下的右肘、前臂、右腕和手部，参数 `ParamElbowR`、`ParamWristR` 已在 Editor 中按五档实机复核；`ARM_idle.motion3.json` 只在已验证的小幅范围内循环驱动这两个参数。

## 打开

运行 `tools/CUBISM/CubismViewer5.exe`，选择“文件 → 打开”，打开本目录的 `bamboo-crane-maiden-arm-v3.model3.json`。也可以把这个 `.model3.json` 拖入 Viewer。动作列表中的 `ArmIdle` 可用于检查右肘/右腕的局部连续性。

## 当前边界

这个包不是全身交付物：没有 `physics3.json`，衣发物理、左臂、腿脚、动捕和完整操演仍未完成。肘部袖口的遮挡底绘仍有透明断口风险，所以动作范围刻意保持在小幅安全值；不要把 `ARM_idle` 的局部循环解读为全身自然待机。

纹理为官方 Editor 生成的 2048×2048 atlas，`model3.json`、`.moc3`、`.cdi3.json` 与 `texture_00.png` 均在本目录内，路径按相对引用组织。
