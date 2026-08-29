"""Capture evidence screenshots of the meshed import (raster-space coords)."""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
_WIN32 = os.path.join(_ROOT, "tools", "_python", "win32")
if _WIN32 not in sys.path:
    sys.path.insert(0, _WIN32)
_dlls = os.path.join(_ROOT, "tools", "_python", "pywin32_system32")
if os.path.isdir(_dlls):
    os.add_dll_directory(_dlls)

import ctypes

import win32gui

try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    pass

from PIL import ImageGrab

OUT = sys.argv[1] if len(sys.argv) > 1 else "exports/_evidence.png"
box = None
if len(sys.argv) > 5:
    SCALE = win32api_scale = 2.0
    x, y, x2, y2 = (int(v) for v in sys.argv[2:6])
    box = (x * 2, y * 2, x2 * 2, y2 * 2)
img = ImageGrab.grab(bbox=box, all_screens=True)
img.save(OUT)
print(f"saved {OUT} size={img.size}")
