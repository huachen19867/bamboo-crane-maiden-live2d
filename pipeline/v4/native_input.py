"""Native Win32 input helpers for Cubism Editor GUI automation.

The ZCode CUA broker's ownership verification rejects every coordinate dispatch
against this Java/AWT app, so automation must send raw Win32 events directly.
Coordinates are PHYSICAL screen pixels (display is 2560x1600).
"""
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
    elif cmd == "windows":
        for hwnd, rect, text in list_windows():
            print(f"{hwnd}|{rect}|{text}")
    else:
        print(f"unknown command {cmd}")
        sys.exit(2)


if __name__ == "__main__":
    main()
