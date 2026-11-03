# -*- coding: utf-8 -*-
"""由 IMG_20260130_191935.jpg 生成 PWA 图标。

用法（在项目根目录）：
    python tools/make_icons.py

产物（icons/）：
    icon-192.png / icon-512.png        普通图标（全出血方形，purpose: any）
    icon-maskable-192.png / -512.png   maskable：裁到中心 80% 再放大填满，
                                       关键内容必落在安全区内，且不出现补边色块
    apple-touch-icon.png              180x180，iOS 主屏
    favicon-32.png                    浏览器标签页

依赖：Pillow（仅此脚本需要，网站本身零依赖）。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "IMG_20260130_191935.jpg"
OUT = ROOT / "icons"

SAFE = 0.8  # maskable 保留的中心比例，对应 80% 安全区


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"缺少源图：{SRC}")
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    if w != h:  # 居中裁成正方形，避免拉伸
        side = min(w, h)
        im = im.crop(((w - side) // 2, (h - side) // 2,
                      (w + side) // 2, (h + side) // 2))
    side = im.size[0]
    OUT.mkdir(exist_ok=True)

    for size in (192, 512):
        im.resize((size, size), Image.Resampling.LANCZOS).save(
            OUT / f"icon-{size}.png", optimize=True)

    inset = int(round(side * (1 - SAFE) / 2))
    core = im.crop((inset, inset, side - inset, side - inset))
    for size in (192, 512):
        core.resize((size, size), Image.Resampling.LANCZOS).save(
            OUT / f"icon-maskable-{size}.png", optimize=True)

    im.resize((180, 180), Image.Resampling.LANCZOS).save(
        OUT / "apple-touch-icon.png", optimize=True)
    im.resize((32, 32), Image.Resampling.LANCZOS).save(
        OUT / "favicon-32.png", optimize=True)

    for p in sorted(OUT.iterdir()):
        print(f"  {p.name}  {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
