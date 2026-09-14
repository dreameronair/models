#!/usr/bin/env python3
# coding: utf-8
"""
把整个游戏打包成一个自包含的 HTML 文件。

CSS、JS 全部内联, 图片压缩后转成 dataURL 塞进 window.MK_INLINE
(js/core.js 里的 assetUrl 会读它)。产物双击就能玩, 也能直接发给别人,
不需要起服务器 —— 图片是 dataURL, 不会触发 file:// 的画布跨域限制。

奇妙萌可官方形象仍然是在线加载的, 没有打进文件里(那属于把有版权的美术
资源再分发)。没网时会自动回退到内联的原创形象, 照样能玩。

用法: python3 tools/build_single.py [输出路径]
"""

import base64
import io
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'dist', 'mengke-match3.html')

# 棋盘格子在 2 倍屏下也就 90px 左右, 精灵图 192 足够清晰, 比 256 省三成体积
SPRITE_SIZE = 192
SPRITE_COLORS = 128
BG_WIDTH = 828
BG_QUALITY = 72
ICON_SIZE = 180


def data_url(raw, mime):
    return 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode('ascii'))


def pack_sprite(path):
    """角色图: 缩到 SPRITE_SIZE 并量化成调色板 PNG, 保留透明通道。"""
    with Image.open(path) as im:
        im = im.convert('RGBA')
        if im.width != SPRITE_SIZE:
            im = im.resize((SPRITE_SIZE, SPRITE_SIZE), Image.LANCZOS)
        # 先把接近全透明的像素压平, 量化时才不会在边缘留下脏点
        alpha = im.getchannel('A').point(lambda a: 0 if a < 8 else a)
        im.putalpha(alpha)
        packed = im.quantize(colors=SPRITE_COLORS, method=Image.FASTOCTREE)
    buf = io.BytesIO()
    packed.save(buf, format='PNG', optimize=True)
    return buf.getvalue(), 'image/png'


def pack_background(path):
    with Image.open(path) as im:
        im = im.convert('RGB')
        if im.width > BG_WIDTH:
            im = im.resize((BG_WIDTH, round(im.height * BG_WIDTH / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=BG_QUALITY, optimize=True, progressive=True)
    return buf.getvalue(), 'image/jpeg'


def pack_icon(path):
    with Image.open(path) as im:
        im = im.convert('RGB').resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=78, optimize=True)
    return buf.getvalue(), 'image/jpeg'


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    html = read('index.html')

    # 1. 收集要内联的图片
    inline = {}
    total_raw = 0
    print('内联图片:')
    for name in sorted(os.listdir(os.path.join(ROOT, 'assets', 'characters'))):
        if not name.endswith('.png'):
            continue
        rel = 'assets/characters/' + name
        src = os.path.join(ROOT, rel)
        raw, mime = pack_sprite(src)
        inline[rel] = data_url(raw, mime)
        total_raw += len(raw)
        print('  %-34s %5dKB -> %4dKB' % (rel, os.path.getsize(src) // 1024, len(raw) // 1024))

    bg_rel = 'assets/ui/background.jpg'
    raw, mime = pack_background(os.path.join(ROOT, bg_rel))
    inline[bg_rel] = data_url(raw, mime)
    total_raw += len(raw)
    print('  %-34s %5dKB -> %4dKB' % (bg_rel,
                                      os.path.getsize(os.path.join(ROOT, bg_rel)) // 1024,
                                      len(raw) // 1024))

    icon_raw, icon_mime = pack_icon(os.path.join(ROOT, 'assets', 'ui', 'share.png'))
    icon_url = data_url(icon_raw, icon_mime)
    total_raw += len(icon_raw)

    # 2. <link rel=stylesheet> -> <style>
    css = read('css', 'style.css')
    html = re.sub(r'\n?[ \t]*<link rel="stylesheet" href="css/style\.css">',
                  '\n<style>\n' + css + '\n</style>', html, count=1)
    if '<style>' not in html:
        raise SystemExit('没能替换掉 style.css 的 link 标签, index.html 结构变了?')

    # 3. 图标与分享图指向内联数据; 单文件版没有可被抓取的图片地址, og:image 留着也没用
    html = html.replace('<meta property="og:image" content="assets/ui/share.png">\n', '')
    html = html.replace('href="assets/ui/share.png"', 'href="' + icon_url + '"')

    # 4. <script src> 按原顺序 -> 内联, 并在最前面插入图片映射表
    scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
    if not scripts:
        raise SystemExit('没找到 js 的 script 标签, index.html 结构变了?')

    parts = ['<script>window.MK_INLINE = {']
    parts.append(',\n'.join('"%s":"%s"' % (k, v) for k, v in sorted(inline.items())))
    parts.append('};</script>')
    for rel in scripts:
        parts.append('<script>\n' + read(*rel.split('/')) + '\n</script>')
    bundle = '\n'.join(parts)

    first = '<script src="%s"></script>' % scripts[0]
    html = html.replace(first, bundle, 1)
    for rel in scripts[1:]:
        html = html.replace('\n<script src="%s"></script>' % rel, '')

    if 'src="js/' in html:
        raise SystemExit('还有没内联干净的脚本标签')

    # 5. 单文件是拿来本地打开的, 标题上标一下, 免得和在线版混淆
    html = html.replace('<title>奇妙萌可消消乐</title>',
                        '<title>奇妙萌可消消乐(单文件版)</title>')

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size = os.path.getsize(out_path)
    print('\n输出: %s' % out_path)
    print('图片压缩后共 %dKB, 转 base64 后整个文件 %dKB' % (total_raw // 1024, size // 1024))
    print('内联脚本 %d 个, 图片 %d 张' % (len(scripts), len(inline) + 1))


if __name__ == '__main__':
    main()
