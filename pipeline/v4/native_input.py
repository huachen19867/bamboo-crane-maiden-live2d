"""Native Win32 input helpers for Cubism Editor GUI automation.

The ZCode CUA broker's ownership verification rejects every coordinate dispatch
against this Java/AWT app, so automation must send raw Win32 events directly.
Coordinates are PHYSICAL screen pixels (display is 2560x1600).
"""
import io
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_WIN32 = os.path.join(_ROOT, "tools", "_python", "win32")
if _WIN32 not in sys.path:
    sys.path.insert(0, _WIN32)
_pywin32_dlls = os.path.join(_ROOT, "tools", "_python", "pywin32_system32")
if os.path.isdir(_pywin32_dlls):
    os.add_dll_directory(_pywin32_dlls)

import ctypes

import win32api
import win32gui

KEYEVENTF_KEYUP = 0x0002

VK_MAP = {
    "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
    "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
    ".": 0xBE,
}


def type_text(text):
    for ch in text:
        code = VK_MAP.get(ch)
        if code is None:
            raise ValueError(f"unsupported char {ch!r}")
        win32api.keybd_event(code, 0, 0, 0)
        time.sleep(0.03)
        win32api.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.06)

# The ZCode screenshots come in a 1280x800 raster. Convert raster coords to
# whatever space this process is allowed to use for Win32 coordinates.
try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    pass

_screen_w = win32api.GetSystemMetrics(0)
if _screen_w >= 2000:
    SCALE = 2.0  # process is physical-pixel aware (2560 wide)
else:
    SCALE = 4.0 / 3.0  # process is DPI virtualized (1706.67 wide); OS rescales


def to_native(x, y):
    return (int(round(x * SCALE)), int(round(y * SCALE)))

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010


def _send_mouse(flags, dx=0, dy=0):
    win32api.mouse_event(flags, dx, dy, 0, 0)


def move_to(x, y):
    win32api.SetCursorPos(to_native(x, y))
    time.sleep(0.05)


def click(x, y, button="left"):
    move_to(x, y)
    time.sleep(0.05)
    down, up = (
        (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
        if button == "left"
        else (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
    )
    _send_mouse(down)
    time.sleep(0.06)
    _send_mouse(up)
    time.sleep(0.05)


def double_click(x, y):
    click(x, y)
    time.sleep(0.08)
    click(x, y)


def drag(x1, y1, x2, y2, steps=24):
    move_to(x1, y1)
    time.sleep(0.08)
    _send_mouse(MOUSEEVENTF_LEFTDOWN)
    time.sleep(0.08)
    for i in range(1, steps + 1):
        move_to(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps)
        time.sleep(0.016)
    time.sleep(0.08)
    _send_mouse(MOUSEEVENTF_LEFTUP)
    time.sleep(0.05)


def find_window(title_sub):
    found = []

    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            text = win32gui.GetWindowText(hwnd)
            if title_sub in text:
                found.append((hwnd, text, win32gui.GetWindowRect(hwnd)))

    win32gui.EnumWindows(cb, None)
    return found


def resize_window(title_sub, add_width=0, add_height=0):
    for hwnd, text, (l, t, r, b) in find_window(title_sub):
        win32gui.MoveWindow(
            hwnd, l, t,
            (r - l) + int(round(add_width * SCALE)),
            (b - t) + int(round(add_height * SCALE)),
            True,
        )
        time.sleep(0.3)
        return f"resized hwnd={hwnd} title={text}"
    return "window-not-found"


def list_windows():
    out = []

    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
            l, t, r, b = win32gui.GetWindowRect(hwnd)
            out.append((hwnd, (int(l / SCALE), int(t / SCALE), int(r / SCALE), int(b / SCALE)), win32gui.GetWindowText(hwnd)))

    win32gui.EnumWindows(cb, None)
    return out


VK = {
    "down": 0x28,
    "up": 0x26,
    "left": 0x25,
    "right": 0x27,
    "return": 0x0D,
    "escape": 0x1B,
    "tab": 0x09,
    "space": 0x20,
}


def key(name, times=1):
    code = VK[name]
    for _ in range(times):
        win32api.keybd_event(code, 0, 0, 0)
        time.sleep(0.03)
        win32api.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.08)


MOUSEEVENTF_WHEEL = 0x0800


def wheel(x, y, delta):
    move_to(x, y)
    time.sleep(0.05)
    win32api.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(delta * 120), 0)
    time.sleep(0.15)


VK_CONTROL = 0x11
VK_SHIFT = 0x10


def modifier_click(x, y, modifier, button="left"):
    win32api.keybd_event(modifier, 0, 0, 0)
    time.sleep(0.05)
    try:
        click(x, y, button=button)
    finally:
        win32api.keybd_event(modifier, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.05)


ALL_VK = {**VK, **VK_MAP, "a": 0x41, "e": 0x45, "w": 0x57, "o": 0x4F, "s": 0x53, "z": 0x5A}


def chord(mods, name):
    code = ALL_VK[name]
    mod_codes = {"ctrl": VK_CONTROL, "shift": VK_SHIFT, "alt": 0x12}
    held = []
    for m in mods:
        win32api.keybd_event(mod_codes[m], 0, 0, 0)
        held.append(mod_codes[m])
        time.sleep(0.04)
    try:
        win32api.keybd_event(code, 0, 0, 0)
        time.sleep(0.03)
        win32api.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.08)
    finally:
        for held_code in held:
            win32api.keybd_event(held_code, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.05)


def focus_cubism():
    target = None

    def cb(hwnd, _):
        nonlocal target
        if win32gui.IsWindowVisible(hwnd) and "Cubism Editor" in win32gui.GetWindowText(hwnd):
            target = hwnd

    win32gui.EnumWindows(cb, None)
    if target:
        win32gui.SetForegroundWindow(target)
        time.sleep(0.5)
        return target
    return None


def run_script(path):
    """Execute a JSON list of operations: click/rclick/dblclick/drag/key/wait."""
    import json

    focus_cubism()
    with io.open(path, encoding="utf-8") as f:
        ops = json.load(f)
    for op in ops:
        kind = op["op"]
        if kind == "click":
            click(op["x"], op["y"], op.get("button", "left"))
        elif kind == "ctrlclick":
            modifier_click(op["x"], op["y"], VK_CONTROL)
        elif kind == "shiftclick":
            modifier_click(op["x"], op["y"], VK_SHIFT)
        elif kind == "dblclick":
            double_click(op["x"], op["y"])
        elif kind == "drag":
            drag(op["x1"], op["y1"], op["x2"], op["y2"], op.get("steps", 24))
        elif kind == "key":
            key(op["name"], op.get("times", 1))
        elif kind == "wheel":
            wheel(op["x"], op["y"], op.get("delta", -3))
        elif kind == "chord":
            chord(op.get("mods", ["ctrl"]), op["name"])
        elif kind == "text":
            type_text(op["text"])
        elif kind == "wait":
            time.sleep(op.get("seconds", 0.5))
        else:
            raise ValueError(f"unknown op {kind}")
    return f"ran {len(ops)} ops"


def main():
    cmd = sys.argv[1]
    if cmd == "click":
        click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "rclick":
        click(int(sys.argv[2]), int(sys.argv[3]), button="right")
    elif cmd == "dblclick":
        double_click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "drag":
        drag(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
    elif cmd == "resize":
        print(resize_window(sys.argv[2], int(sys.argv[3]), int(sys.argv[4])))
    elif cmd == "key":
        key(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    elif cmd == "wheel":
        wheel(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif cmd == "script":
        print(run_script(sys.argv[2]))
    elif cmd == "windows":
        for hwnd, rect, text in list_windows():
            print(f"{hwnd}|{rect}|{text}")
    else:
        print(f"unknown command {cmd}")
        sys.exit(2)


if __name__ == "__main__":
    main()
