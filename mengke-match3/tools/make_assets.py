#!/usr/bin/env python3
"""把生成的角色立绘（品红纯色背景）处理成游戏用的透明 PNG 精灵图。

用法:
    python3 tools/make_assets.py <原始图目录> [输出目录]

处理流程: 采样四角背景色 -> 从边缘泛洪出背景连通域 -> 羽化边缘 ->
按不透明像素裁切 -> 补成正方形 -> 缩放到 TILE_SIZE。

如果你有官方授权的角色素材, 不需要跑这个脚本, 直接把同名 PNG
(建议 256x256 透明背景) 放进 assets/characters/ 覆盖即可。
"""

import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

TILE_SIZE = 256          # 输出精灵边长
BG_TOLERANCE = 78        # 判定为背景色的 RGB 欧氏距离阈值
EDGE_TOLERANCE = 128     # 半透明羽化区间的外沿阈值
CONTENT_PADDING = 0.03   # 裁切后四周留白比例

# 原始文件名 -> 游戏内角色 id
NAME_MAP = {
    "moke_pink_rabbit.png": "rabbit.png",
    "moke_blue_cat.png": "cat.png",
    "moke_yellow_bear.png": "bear.png",
    "moke_green_dragon.png": "dragon.png",
    "moke_purple_unicorn.png": "unicorn.png",
    "moke_orange_fox.png": "fox.png",
}


def estimate_bg_color(rgb: np.ndarray) -> np.ndarray:
    """用四个角的小块中位数估计纯色背景。"""
    h, w = rgb.shape[:2]
    k = max(4, min(h, w) // 32)
    patches = [
        rgb[:k, :k], rgb[:k, w - k:],
        rgb[h - k:, :k], rgb[h - k:, w - k:],
    ]
    samples = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    return np.median(samples, axis=0)


def background_mask(rgb: np.ndarray, bg: np.ndarray, tol: float) -> np.ndarray:
    """只保留与图像边框连通的背景区域, 避免挖掉角色身上的同色部分。"""
    close = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2) < tol
    labels, count = ndimage.label(close)
    if count == 0:
        return np.zeros(close.shape, dtype=bool)

    border = np.concatenate([
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1],
    ])
    border_labels = np.unique(border[border > 0])
    return np.isin(labels, border_labels)


def cut_out(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB"))
    bg = estimate_bg_color(rgb)

    solid_bg = background_mask(rgb, bg, BG_TOLERANCE)
    # 稍宽的阈值抓住边缘上被背景色污染的过渡像素, 做成半透明
    fringe_bg = background_mask(rgb, bg, EDGE_TOLERANCE)

    alpha = np.full(solid_bg.shape, 255, dtype=np.uint8)
    alpha[fringe_bg] = 128
    alpha[solid_bg] = 0

    alpha_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
    out = img.convert("RGBA")
    out.putalpha(alpha_img)
    return out


def crop_to_square(img: Image.Image, size: int) -> Image.Image:
    bbox = img.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)

    side = int(max(img.size) * (1 + CONTENT_PADDING * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    src_dir = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "assets", "characters")
    os.makedirs(out_dir, exist_ok=True)

    for src_name, out_name in NAME_MAP.items():
        src_path = os.path.join(src_dir, src_name)
        if not os.path.exists(src_path):
            print("跳过 (缺少原图): " + src_name)
            continue

        with Image.open(src_path) as raw:
            sprite = crop_to_square(cut_out(raw), TILE_SIZE)

        out_path = os.path.join(out_dir, out_name)
        sprite.save(out_path, optimize=True)
        print("%-24s -> %s (%d KB)" % (
            src_name, out_name, os.path.getsize(out_path) // 1024))

    ui_dir = os.path.join(os.path.dirname(out_dir), "ui")
    os.makedirs(ui_dir, exist_ok=True)

    bg_src = os.path.join(src_dir, "moke_bg.png")
    if os.path.exists(bg_src):
        with Image.open(bg_src) as raw:
            bg = raw.convert("RGB").resize((720, 1280), Image.LANCZOS)
        bg_out = os.path.join(ui_dir, "background.jpg")
        bg.save(bg_out, quality=82, optimize=True, progressive=True)
        print("%-24s -> ui/background.jpg (%d KB)" % (
            "moke_bg.png", os.path.getsize(bg_out) // 1024))
        make_share_image(bg, out_dir, ui_dir)

    return 0


def make_share_image(background: Image.Image, sprite_dir: str, ui_dir: str) -> None:
    """用背景 + 三只萌宠拼一张分享/图标用的缩略图。"""
    w, h = 500, 400
    card = background.crop((0, 200, background.width, 200 + int(background.width * h / w)))
    card = card.resize((w, h), Image.LANCZOS).convert("RGBA")

    picks = ["rabbit.png", "cat.png", "unicorn.png"]
    sprite_size = 210
    for i, name in enumerate(picks):
        path = os.path.join(sprite_dir, name)
        if not os.path.exists(path):
            continue
        with Image.open(path) as sprite:
            s = sprite.convert("RGBA").resize((sprite_size, sprite_size), Image.LANCZOS)
        x = int(w / 2 - sprite_size / 2 + (i - 1) * sprite_size * 0.62)
        y = int(h / 2 - sprite_size / 2 + (0 if i == 1 else sprite_size * 0.1))
        card.alpha_composite(s, (x, y))

    out = os.path.join(ui_dir, "share.png")
    card.convert("RGB").save(out, optimize=True)
    print("%-24s -> ui/share.png (%d KB)" % ("(合成)", os.path.getsize(out) // 1024))


if __name__ == "__main__":
    raise SystemExit(main())
