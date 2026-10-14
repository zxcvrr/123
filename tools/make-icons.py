"""生成 PWA 图标（192 / 512 / maskable 512）与 favicon 的 SVG。

用法：
    python tools/make-icons.py

依赖：Pillow、numpy（DSH 自带运行时里都有）。
输出：icons/icon-192.png、icons/icon-512.png、icons/icon-maskable-512.png、icons/icon.svg
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)

C0 = (0x1B, 0x3F, 0xA0)   # 深蓝
C1 = (0x4D, 0x8D, 0xFF)   # 品牌蓝
C2 = (0x6A, 0xD3, 0xFF)   # 青
SS = 4                     # 超采样倍数


def gradient(size: int) -> Image.Image:
    """对角渐变背景，返回 RGBA。"""
    y, x = np.mgrid[0:size, 0:size]
    t = (x + y) / (2.0 * (size - 1))          # 0 → 1，左上到右下
    t = np.clip(t, 0, 1)[..., None]
    lo = np.array(C0, dtype=float)
    hi = np.array(C1, dtype=float)
    mid = np.array(C2, dtype=float)
    # 两段线性插值：C0 → C1（前 60%）→ C2（后 40%）
    first = lo + (hi - lo) * np.clip(t / 0.6, 0, 1)
    second = hi + (mid - hi) * np.clip((t - 0.6) / 0.4, 0, 1)
    rgb = np.where(t <= 0.6, first, second).astype(np.uint8)
    rgba = np.dstack([rgb, np.full((size, size, 1), 255, dtype=np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def draw_glyph(img: Image.Image, size: int, scale: float) -> None:
    """在图上画一个白色对话气泡 + 三个点的标记。scale 控制标记占画面比例。"""
    d = ImageDraw.Draw(img)
    w = size * scale
    h = w * 0.74
    x0 = (size - w) / 2
    y0 = (size - h) / 2 - size * 0.03
    x1, y1 = x0 + w, y0 + h

    d.rounded_rectangle([x0, y0, x1, y1], radius=h * 0.30, fill=(255, 255, 255, 255))

    # 气泡尾巴（左下，短而宽）
    tip = (x0 + w * 0.30, y1 + h * 0.26)
    d.polygon([
        (x0 + w * 0.26, y1 - h * 0.08),
        tip,
        (x0 + w * 0.54, y1 - h * 0.08),
    ], fill=(255, 255, 255, 255))
    r_tip = h * 0.055
    d.ellipse([tip[0] - r_tip, tip[1] - r_tip, tip[0] + r_tip, tip[1] + r_tip],
              fill=(255, 255, 255, 255))

    # 三个点
    r = h * 0.105
    cy = (y0 + y1) / 2
    for i, fx in enumerate((0.32, 0.50, 0.68)):
        cx = x0 + w * fx
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(0x1B, 0x3F, 0xA0, 255) if i == 0 else (0x2E, 0x66, 0xD8, 255))


def build(size: int, scale: float, name: str, out_dir: Path = OUT, opaque: bool = True) -> None:
    big = size * SS
    if opaque:
        canvas = gradient(big)
    else:
        canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_glyph(canvas, big, scale)
    out_dir.mkdir(parents=True, exist_ok=True)
    canvas.resize((size, size), Image.LANCZOS).save(out_dir / name, "PNG", optimize=True)
    print(f"wrote {out_dir / name} ({size}x{size})")


# Android 各密度的启动图标尺寸（dp → px）
ANDROID_DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def build_android() -> None:
    """生成 Android 启动图标：传统方形图标 + 自适应图标的前景层。"""
    res = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
    for density, factor in ANDROID_DENSITIES.items():
        out = res / f"mipmap-{density}"
        # 传统图标：48dp 满幅
        build(round(48 * factor), 0.62, "ic_launcher.png", out_dir=out, opaque=True)
        # 自适应图标前景：108dp 画布，标记缩小到安全区内
        build(round(108 * factor), 0.52, "ic_launcher_foreground.png", out_dir=out, opaque=False)



SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b3fa0"/>
      <stop offset="0.6" stop-color="#4d8dff"/>
      <stop offset="1" stop-color="#6ad3ff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="#ffffff">
    <rect x="110" y="150" width="292" height="192" rx="58"/>
    <path d="M186 330 L198 386 L268 330 Z"/>
  </g>
  <g fill="#2358c8">
    <circle cx="203" cy="244" r="21"/>
    <circle cx="256" cy="244" r="21"/>
    <circle cx="309" cy="244" r="21"/>
  </g>
</svg>
"""

if __name__ == "__main__":
    build(192, 0.56, "icon-192.png")
    build(512, 0.56, "icon-512.png")
    build(512, 0.40, "icon-maskable-512.png")   # 安全区内，可被裁成圆形
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    print(f"wrote {OUT / 'icon.svg'}")
    build_android()
