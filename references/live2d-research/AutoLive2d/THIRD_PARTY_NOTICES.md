# Third-Party and Sample Asset Notices

## AutoLive2d source

Original AutoLive2d source code is licensed under the Apache License 2.0. See `LICENSE`.

## Bundled see-through source

`third_party/see-through` is based on [`shitagaki-lab/see-through`](https://github.com/shitagaki-lab/see-through), "Single-image Layer Decomposition for Anime Characters". The bundled baseline was compared against upstream commit `58a1cb11d13f85acec9bbddb8cd4b6487843d4cf` (2026-07-20).

The upstream project is licensed under Apache License 2.0. Its license remains at `third_party/see-through/LICENSE`. Local Windows, WebUI, low-VRAM, device-placement, and PSD post-processing changes are described in `third_party/see-through/LOCAL_CHANGES.md`.

The model weights downloaded by see-through are not stored in this repository. Their own model cards and licenses apply.

## npm and Python dependencies

Dependencies installed through `package.json`, `package-lock.json`, and `third_party/see-through/requirements*.txt` retain their respective licenses. They are not relicensed by this repository.

## Built-in PSD and image samples

Files under `public/samples` and reference images under `docs/assets` are bundled for demonstration, compatibility testing, and reproducible rig validation. They are not automatically licensed under Apache-2.0. Character, game, generated-image, and source-art rights remain with their respective owners or creators.

Before redistributing a sample model or using it commercially, replace it with artwork for which you have the necessary rights or verify the applicable source-asset terms.
