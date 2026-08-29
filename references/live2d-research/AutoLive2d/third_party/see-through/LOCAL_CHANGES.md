# Local Changes to see-through

This directory vendors [`shitagaki-lab/see-through`](https://github.com/shitagaki-lab/see-through) under Apache License 2.0. The source was compared against upstream commit `58a1cb11d13f85acec9bbddb8cd4b6487843d4cf` dated 2026-07-20.

AutoLive2d maintains the following additions and modifications:

- Windows virtual-environment installer: `setup_windows.ps1`.
- Windows launch wrappers: `launch_webui.bat` and `run_psd_quantized.bat`.
- A local browser UI under `webui/` for upload, progress, history, layer preview, and PSD download.
- Model preparation helper at `tools/prepare_models.py`.
- NF4 and block-swap low-VRAM inference paths.
- Safer Hugging Face/Accelerate execution-device detection for offloaded text encoders, UNet, VAE, and Marigold components.
- Optional connected-component and depth-based PSD layer post-splitting.
- Windows subprocess-output decoding fixes.
- Chinese deployment and usage documentation.

Generated model weights, virtual environments, user inputs, outputs, and web job histories are intentionally excluded from Git. The first setup/inference run downloads the required model files under `workspace/models`.

When rebasing this fork onto a newer upstream revision:

1. Compare all files listed above and all files currently different from upstream.
2. Preserve upstream copyright and `LICENSE`.
3. Update the upstream commit recorded here and in the root `THIRD_PARTY_NOTICES.md`.
4. Run Python syntax checks and a real PSD inference smoke test on the target GPU.
