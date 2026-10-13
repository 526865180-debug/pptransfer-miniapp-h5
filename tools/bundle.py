#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包器：把 src/ 的多文件工程内联成根目录的单文件 index.html。

为什么要打包
------------
src/ 是正常的网页工程（13 个页面 × 3 个文件 + 设计系统），适合开发和 review。
但对外分享/部署时，单文件更省事：一个 index.html 丢进任何静态服务器都能跑，
没有相对路径问题，微信里打开也不会因为并发请求慢而白屏。

做什么
------
1. <link rel="stylesheet">  → <style>
2. <script src>             → <script>
3. src/assets/icons.svg     → 内联 <div id="pp-sprite">（app.js 见到它就直接用）
4. src/pages/<name>.html    → <template id="frag-<name>">
5. 在 router.js 之后插一行，把 PP.fragBase 置为 null（产物态禁止 fetch）
6. 报告体积

不做什么
--------
· 不做压缩/混淆。产物要能被直接阅读、断点调试，压缩收益交给服务器 gzip。
· 不处理 src/ 之外的任何文件 —— 与 legacy/converter 的旧方案本质区别就在这里：
  旧方案是「把小程序模板翻译成 H5」，本工具是「把一个原生 H5 工程合并成单文件」。

用法
----
    python3 tools/bundle.py                # 输出到 ./index.html
    python3 tools/bundle.py -o dist/a.html # 指定输出
"""
import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')

# 这些脚本之后要插入 fragBase 覆写（router.js 里默认写的是 ''）
ROUTER_SCRIPT = 'js/router.js'

SPRITE_HOLDER_STYLE = ('position:absolute;width:0;height:0;overflow:hidden')


def read(rel):
    path = os.path.join(SRC, rel)
    if not os.path.isfile(path):
        raise SystemExit('缺少源文件：%s' % os.path.relpath(path, ROOT))
    return io.open(path, encoding='utf-8').read()


def indent(text, pad):
    """给内联内容统一缩进，产物源码保持可读。"""
    lines = text.rstrip('\n').split('\n')
    return '\n'.join((pad + ln if ln.strip() else '') for ln in lines)


def banner(title, rel):
    return '%s/* ===== %s · %s ===== */' % ('  ', title, rel)


# --------------------------------------------------------------- CSS

def inline_css(html):
    n = [0]

    def repl(m):
        rel = m.group(1)
        n[0] += 1
        body = indent(read(rel), '  ')
        return ('<style data-bundle-from="%s">\n%s\n%s\n  </style>'
                % (rel, banner('样式', rel), body))

    out = re.sub(r'[ \t]*<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>\s*\n?',
                 repl, html)
    return out, n[0]


# --------------------------------------------------------------- JS

def inline_js(html):
    n = [0]

    def repl(m):
        rel = m.group(1)
        n[0] += 1
        body = indent(read(rel), '  ')
        head = '<!-- %s -->' % rel
        tail = ''
        if rel == ROUTER_SCRIPT:
            # 产物里片段已内联，关掉 fetch 回退路径
            tail = ('\n  <script>PP.fragBase = null; /* 产物态：片段已内联，禁用 fetch */</script>')
        return ('%s\n  <script data-bundle-from="%s">\n%s\n%s\n  </script>%s'
                % (head, rel, banner('脚本', rel), body, tail))

    out = re.sub(r'[ \t]*<script[^>]*src="([^"]+)"[^>]*>\s*</script>\s*\n?',
                 repl, html)
    return out, n[0]


# --------------------------------------------------------------- sprite

def build_sprite():
    """图标 sprite 原样内联。

    关键点：必须保留 icons.svg 最外层的 <svg> 包裹。若剥掉外层只留
    <symbol>，它们会被放进一个 <div>，HTML 解析器会把 <symbol> 当成
    未知元素（HTMLUnknownElement）而不是 SVG 命名空间里的元素，
    <use href="#i-x"> 就解析不到 —— 产物里所有图标都会变成空白。
    开发态没这个问题，因为 app.js 注入的正是带外层 <svg> 的原文。
    """
    return ('<div id="pp-sprite" aria-hidden="true" style="%s">\n%s\n</div>'
            % (SPRITE_HOLDER_STYLE, indent(read('assets/icons.svg'), '  ')))


# --------------------------------------------------------------- 页面片段

def build_fragments():
    """把 src/pages/*.html 转成 <template id="frag-<name>">。

    name 取自文件名；router.loadFragment 先找 template，命中就不 fetch。

    片段内部允许再嵌 <template>（弹层正文的静态部分由外层片段持有，
    见 pages/collection.html），HTML 解析器会按深度正确配对。
    这里只拒绝「配对不平衡」的片段 —— 那才是会导致外层 template 被提前闭合的情况。
    """
    names = sorted(f[:-5] for f in os.listdir(os.path.join(SRC, 'pages'))
                   if f.endswith('.html'))
    blocks = []
    for name in names:
        markup = read('pages/%s.html' % name)
        # 注释里可能提到 <template>，先剥掉再配对，否则会误判
        code = re.sub(r'<!--.*?-->', '', markup, flags=re.S)
        opens = len(re.findall(r'<template[\s>]', code, re.I))
        closes = len(re.findall(r'</template\s*>', code, re.I))
        if opens != closes:
            raise SystemExit('片段里 <template> 配对不平衡（%d 开 / %d 闭），无法内联：pages/%s.html'
                             % (opens, closes, name))
        if not opens:
            markup = re.sub(r'\n+$', '', markup) + '\n'
        blocks.append(
            '  <!-- 页面片段：%s -->\n'
            '  <template id="frag-%s">\n%s\n  </template>' % (name, name, indent(markup, '    '))
        )
    return '\n\n'.join(blocks), names


# --------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(description='把 src/ 打包成单文件 H5')
    ap.add_argument('-o', '--output', default='index.html',
                    help='输出路径（相对仓库根目录），默认 index.html')
    args = ap.parse_args()

    html = read('index.html')
    html, n_css = inline_css(html)
    html, n_js = inline_js(html)

    # 只拦真正的外链资源；<link rel="icon" href="data:..."> 是自包含的，放行
    bad_link = [l for l in re.findall(r'<link\b[^>]*>', html)
                if re.search(r'rel=["\']?stylesheet', l)]
    if bad_link:
        raise SystemExit('仍有外链样式表：%s' % bad_link[0])
    if re.search(r'<script\b[^>]*\bsrc\s*=', html):
        raise SystemExit('仍有外链脚本 <script src>，请检查 src/index.html')

    sprite = build_sprite()
    frags, names = build_fragments()

    # 反馈层之后、运行时之前插入 sprite；页面片段统一放 </body> 前
    anchor = '<div id="layer-root"></div>'
    if anchor not in html:
        raise SystemExit('src/index.html 里找不到 %s' % anchor)
    html = html.replace(anchor, anchor + '\n\n<!-- 图标 sprite（由 tools/bundle.py 内联）-->\n' + sprite)

    html = html.replace('</body>', '<!-- ============ 页面片段 ============ -->\n'
                        + frags + '\n\n</body>')

    html = html.replace('<title>PPTransfer 商户端 · H5</title>',
                        '<title>PPTransfer 商户端 · H5</title>\n'
                        '<!-- 本文件由 tools/bundle.py 从 src/ 生成，请勿直接编辑；'
                        '改源码后重新运行打包。 -->')

    out_path = os.path.join(ROOT, args.output)
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    io.open(out_path, 'w', encoding='utf-8').write(html)

    size = os.path.getsize(out_path)
    print('内联样式 %d 个 / 脚本 %d 个 / 图标 sprite 1 个 / 页面片段 %d 个'
          % (n_css, n_js, len(names)))
    print('页面：%s' % '、'.join(names))
    print('产出 %s  %.1f KB' % (args.output, size / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
