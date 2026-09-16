#!/usr/bin/env python3
# coding: utf-8
"""
把整个游戏打包成一个自包含的 HTML 文件。

因为美术全是 Canvas 当场画出来的、音效全是 WebAudio 合成的, 这个游戏
一张图一段音频都没有, 所以打包就是把 CSS 和 JS 塞进去 —— 产物只有几十 KB,
双击就能玩, 发给别人也不会缺东西。

用法: python3 tools/build_single.py [输出路径]
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'dist', 'moto-brawl.html')


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    html = read('index.html')

    # 1. <link rel=stylesheet> -> <style>
    css = read('css', 'style.css')
    html, n = re.subn(r'\n?[ \t]*<link rel="stylesheet" href="css/style\.css">',
                      '\n<style>\n' + css + '\n</style>', html, count=1)
    if n != 1:
        raise SystemExit('没能替换掉 style.css 的 link 标签, index.html 结构变了?')

    # 2. 脚本内联前先扫一遍, 确认页面上没有别的外部引用。
    #    单文件版是拿来单独发的, 发出去就没有同级目录兜底了。
    leftover = sorted(set(re.findall(
        r'(?:src|href)="(?!data:|https?:|#|js/)([^"]+)"', html)))
    if leftover:
        raise SystemExit('产物还引用了外部文件, 发出去就会 404: ' + ', '.join(leftover))

    # 3. <script src> 按原顺序内联
    scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
    if not scripts:
        raise SystemExit('没找到 js 的 script 标签, index.html 结构变了?')

    parts = []
    for rel in scripts:
        parts.append('<script>\n' + read(*rel.split('/')) + '\n</script>')
    bundle = '\n'.join(parts)

    html = html.replace('<script src="%s"></script>' % scripts[0], bundle, 1)
    for rel in scripts[1:]:
        html = html.replace('\n<script src="%s"></script>' % rel, '')

    if 'src="js/' in html:
        raise SystemExit('还有没内联干净的脚本标签')

    # 4. 标一下, 免得和在线版混淆
    html = html.replace('<title>铁骑狂飙</title>',
                        '<title>铁骑狂飙(单文件版)</title>')

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size = os.path.getsize(out_path)
    print('输出: %s' % out_path)
    print('内联脚本 %d 个, 整个文件 %dKB' % (len(scripts), size // 1024))
    print('(没有任何图片和音频 —— 美术是 Canvas 画的, 声音是 WebAudio 合成的)')


if __name__ == '__main__':
    main()
