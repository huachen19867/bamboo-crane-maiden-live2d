"""Small, guarded UI automation helper for the installed Cubism Editor.

Cubism does not expose a supported command-line authoring API.  This helper is
intentionally narrow: it creates one named Warp Deformer around one top-level
PSD Part in the already-open official Editor document.  It validates the target
window before clicking and always saves after a successful creation.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "tools" / "_python"
sys.path[:0] = [str(VENDOR), str(VENDOR / "win32"), str(VENDOR / "win32" / "lib"), str(VENDOR / "pythonwin")]
os.environ["PATH"] = str(VENDOR / "pywin32_system32") + os.pathsep + os.environ.get("PATH", "")
if hasattr(os, "add_dll_directory"):
    os.add_dll_directory(str(VENDOR / "pywin32_system32"))

import win32clipboard  # noqa: E402
import win32con  # noqa: E402
import win32gui  # noqa: E402
from pywinauto import Desktop, keyboard, mouse  # noqa: E402


EXPECTED_TITLE = "bamboo-crane-maiden-editor.cmo3"


def frame_for(pid: int):
    frames = [
        window
        for window in Desktop(backend="win32").windows()
        if window.process_id() == pid and window.class_name() == "SunAwtFrame"
        and EXPECTED_TITLE in window.window_text()
    ]
    if len(frames) != 1:
        raise RuntimeError(f"expected one target Cubism frame for pid {pid}, found {len(frames)}")
    return frames[0]


def activate_frame(frame) -> None:
    """Put the guarded Cubism document in front before sending mouse input.

    Java/AWT's ``set_focus`` can silently leave a Chromium window in front on
    Windows.  In that state absolute coordinates would click the browser, not
    Cubism.  Only the covering Chromium window is minimized, and every authoring
    action is aborted unless the intended Cubism HWND becomes foreground.
    """

    target = frame.handle
    if frame.is_minimized():
        frame.restore()
        time.sleep(0.8)

    frame.set_focus()
    time.sleep(0.8)
    foreground = win32gui.GetForegroundWindow()
    if foreground != target:
        foreground_class = win32gui.GetClassName(foreground)
        if foreground_class.startswith("Chrome_WidgetWin"):
            win32gui.ShowWindow(foreground, win32con.SW_MINIMIZE)
            time.sleep(1.0)

        # Sending a harmless Alt keystroke lets the current foreground process
        # hand focus to the requested application under Windows focus rules.
        keyboard.send_keys("%")
        try:
            win32gui.ShowWindow(target, win32con.SW_RESTORE)
            win32gui.BringWindowToTop(target)
            win32gui.SetForegroundWindow(target)
        except Exception:
            frame.set_focus()
        time.sleep(1.0)

    foreground = win32gui.GetForegroundWindow()
    if foreground != target:
        title = win32gui.GetWindowText(foreground)
        raise RuntimeError(
            "refusing coordinate input because Cubism is not foreground; "
            f"foreground={foreground} title={title!r}"
        )


def set_clipboard(text: str) -> None:
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text)
    finally:
        win32clipboard.CloseClipboard()


def close_non_authoring_dialogs(pid: int) -> None:
    # The release-notice home panel is a dialog. Escape closes it without
    # accepting, purchasing, or changing any license state.
    dialogs = [
        window for window in Desktop(backend="win32").windows()
        if window.process_id() == pid and window.class_name() == "SunAwtDialog"
    ]
    for dialog in dialogs:
        dialog.set_focus()
        keyboard.send_keys("{ESC}")
        time.sleep(0.5)


def create_warp(
    pid: int,
    name: str,
    *,
    part_index: int | None = None,
    row_offset_y: int | None = None,
) -> None:
    if not name.startswith("Warp") or not name.isascii() or not name.replace("_", "").isalnum():
        raise ValueError(f"unsafe Warp Deformer name: {name!r}")
    if (part_index is None) == (row_offset_y is None):
        raise ValueError("select exactly one target: part_index or row_offset_y")
    if part_index is not None and not 0 <= part_index <= 7:
        raise ValueError(f"unexpected top-level part index: {part_index}")
    if row_offset_y is not None and not 240 <= row_offset_y <= 607:
        raise ValueError(f"unsafe visible row offset: {row_offset_y}")

    close_non_authoring_dialogs(pid)
    frame = frame_for(pid)
    activate_frame(frame)
    rect = frame.rectangle()

    # Imported PSD top-level Parts are 33 logical pixels apart.  Index zero is
    # Guide; authoring proceeds bottom-up so inserted children do not shift the
    # remaining rows above the current target.
    part_x = rect.left + 150
    part_y = (
        rect.top + row_offset_y
        if row_offset_y is not None
        else rect.top + 280 + 33 * part_index
    )
    mouse.click(coords=(part_x, part_y))
    time.sleep(0.5)

    # Model > Deformer > Create Warp Deformer.
    mouse.click(coords=(rect.left + 215, rect.top + 62))
    time.sleep(0.5)
    keyboard.send_keys("{DOWN}{RIGHT}{ENTER}")
    time.sleep(1.5)

    dialogs = [
        window for window in Desktop(backend="win32").windows()
        if window.process_id() == pid and window.class_name() == "SunAwtDialog"
    ]
    if len(dialogs) != 1:
        raise RuntimeError(f"expected one Create Warp dialog, found {len(dialogs)}")
    dialog = dialogs[0]
    dialog.set_focus()
    drect = dialog.rectangle()
    if drect.width() < 500 or drect.height() < 550:
        raise RuntimeError(f"unexpected Create Warp dialog geometry: {drect}")

    set_clipboard(name)
    mouse.click(coords=(drect.left + 270, drect.top + 152))
    keyboard.send_keys("^a^v")
    # Fit the deformer to child keypoints to avoid a full-canvas lattice.
    mouse.click(coords=(drect.left + 185, drect.top + 492))
    mouse.click(coords=(drect.left + 250, drect.top + 600))
    time.sleep(2.0)

    # Cubism keeps the authoring dialog alive after Create. Use its explicit
    # Close button; Alt+F4 can close the whole Editor process on this build.
    dialogs = [
        window for window in Desktop(backend="win32").windows()
        if window.process_id() == pid and window.class_name() == "SunAwtDialog"
    ]
    if dialogs:
        current = dialogs[0]
        current_rect = current.rectangle()
        mouse.click(coords=(current_rect.left + 430, current_rect.top + 600))
        time.sleep(1.5)

    frame = frame_for(pid)
    activate_frame(frame)
    keyboard.send_keys("^s")
    time.sleep(6.0)
    target = (
        f"visible tree row y={row_offset_y}"
        if row_offset_y is not None
        else f"top-level Part index {part_index}"
    )
    print(f"created and saved {name} on {target}")


def assign_parent(pid: int, row_offset_y: int, parent_menu_index: int) -> None:
    """Assign a visible Warp row to a verified parent in the details combo.

    ``parent_menu_index`` is zero-based in Cubism's deformer combo (Root is
    zero).  The caller must obtain the index from a current screenshot because
    newly inserted deformers can change later rows.  This helper intentionally
    handles one row per invocation so every hierarchy change can be audited.
    """

    if not 240 <= row_offset_y <= 607:
        raise ValueError(f"unsafe visible row offset: {row_offset_y}")
    if not 0 <= parent_menu_index <= 30:
        raise ValueError(f"unsafe parent menu index: {parent_menu_index}")

    close_non_authoring_dialogs(pid)
    frame = frame_for(pid)
    activate_frame(frame)
    rect = frame.rectangle()

    mouse.click(coords=(rect.left + 180, rect.top + row_offset_y))
    time.sleep(0.8)
    # Tool Details > Deformer.  Menu row zero is Root and rows are 32 px.
    mouse.click(coords=(rect.left + 835, rect.top + 662))
    time.sleep(0.8)
    if parent_menu_index == 0:
        # Root is always the first visible row in Cubism's combo.
        mouse.click(coords=(rect.left + 650, rect.top + 695))
    else:
        # Kept for explicitly audited menus only.  Long deformer lists extend
        # below the monitor, while Home/Down remains inside the combo.
        keyboard.send_keys("{HOME}")
        keyboard.send_keys(f"{{DOWN {parent_menu_index}}}")
        keyboard.send_keys("{ENTER}")
    time.sleep(1.5)

    frame = frame_for(pid)
    activate_frame(frame)
    keyboard.send_keys("^s")
    time.sleep(6.0)
    print(
        "assigned visible Warp row "
        f"y={row_offset_y} to parent combo index {parent_menu_index} and saved"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--part-index", type=int)
    target.add_argument("--row-offset-y", type=int)
    parser.add_argument("--name")
    parser.add_argument("--assign-parent-index", type=int)
    args = parser.parse_args()
    if args.assign_parent_index is not None:
        if args.row_offset_y is None or args.part_index is not None or args.name is not None:
            parser.error("parent assignment requires only --row-offset-y and --assign-parent-index")
        assign_parent(args.pid, args.row_offset_y, args.assign_parent_index)
    else:
        if args.name is None:
            parser.error("Warp creation requires --name")
        create_warp(
            args.pid,
            args.name,
            part_index=args.part_index,
            row_offset_y=args.row_offset_y,
        )


if __name__ == "__main__":
    main()
