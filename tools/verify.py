#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""产物校验：确认 index.html 真的能独立跑，而不是「看起来像」。

一次跑完这些断言，任一失败即非零退出，可直接挂到 CI：
  1. 无外链资源       —— 不能有 <link rel=stylesheet> / <script src>
  2. 片段齐全         —— src/js/routes.js 里的每个路由都要有对应 frag 模板
  3. 图标齐全         —— sprite 里的 symbol 覆盖代码中所有 <use href="#i-*">
  4. 无小程序痕迹     —— rpx / {{ }} / wx.* / bindtap / hover-class / base64 PNG
  5. 标签配对         —— 剥掉 script/style/注释后做栈式配对
  6. 括号配对         —— 各 style 块与 JS 块内部平衡

用法：python3 tools/verify.py [产物路径]
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}

# 引号感知地匹配一个完整的开标签：属性值里可能出现 '>'（例如 favicon 的
# data:image/svg+xml URI 内嵌 <svg>），朴素的 [^>]* 会在那里被截断，
# 留下半个标签让配对检查误报
TAG_RE = re.compile(r'<(/?)([a-zA-Z][\w:-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)(/?)>')

# 顺带用于「图标齐全」检查：这些位置之外的 #i- 引用不算数
errors = []
warns = []


def fail(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def strip_comments(s):
    return re.sub(r'<!--.*?-->', '', s, flags=re.S)


def strip_code_comments(html):
    """剥掉 HTML / CSS / JS 三类注释。

    注释是用来讲「为什么」的，里面常出现反例说明（router.js 的注释里就有
    `<template id="frag-xxx">`，index.css 的注释里提到原设计稿的 750rpx）。
    这些不是运行时痕迹，做痕迹扫描前必须剥掉，否则全是误报。
    """
    s = strip_comments(html)
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'(?m)^\s*//.*$', '', s)
    return s


def strip_blocks(s, tag):
    """剥掉 <tag ...>...</tag> 整块（script/style），返回 (剩余文本, 各块内容)。"""
    blocks = []

    def take(m):
        blocks.append(m.group(1))
        return '\n'

    pat = re.compile(r'<%s\b[^>]*>(.*?)</%s\s*>' % (tag, tag), re.S | re.I)
    return pat.sub(take, s), blocks


def check_no_external(html):
    if re.search(r'<link\b[^>]*rel=["\']?stylesheet', html, re.I):
        fail('仍有外链样式表 <link rel="stylesheet">，产物未自包含')
    if re.search(r'<script\b[^>]*\bsrc\s*=', html, re.I):
        fail('仍有外链脚本 <script src>，产物未自包含')
    if not re.search(r'PP\.fragBase\s*=\s*null', html):
        fail('缺少 PP.fragBase = null 覆写，产物态仍会尝试 fetch 页面片段')
    if 'id="pp-sprite"' not in html:
        fail('缺少内联图标 sprite（#pp-sprite）')


def check_fragments(html):
    routes_src = io.open(os.path.join(SRC, 'js', 'routes.js'), encoding='utf-8').read()
    names = re.findall(r"\{\s*name:\s*'([a-z0-9-]+)'", routes_src)
    if not names:
        fail('未能从 src/js/routes.js 解析出路由表')
        return []
    have = set(re.findall(r'<template[^>]*id="frag-([a-z0-9-]+)"', strip_code_comments(html)))
    for n in names:
        if n not in have:
            fail('路由 %s 没有对应的 <template id="frag-%s">' % (n, n))
    for n in sorted(have - set(names)):
        warn('存在没有路由指向的片段模板：frag-%s' % n)
    return names


def check_icons(html):
    # sprite 必须保留外层 <svg>：剥掉外层后 <symbol> 会落进 HTML 命名空间，
    # <use href="#i-x"> 引用不到 —— 这是个「静态检查看着没问题、
    # 实际图标全空白」的坑，所以要单独拦
    m = re.search(r'<div id="pp-sprite".*?</div>', html, re.S)
    if not m:
        fail('找不到内联 sprite 容器 #pp-sprite')
    else:
        block = m.group(0)
        first_sym = block.find('<symbol')
        first_svg = block.find('<svg')
        if first_sym >= 0 and (first_svg < 0 or first_svg > first_sym):
            fail('sprite 缺少外层 <svg> 包裹：<symbol> 落在 HTML 命名空间，'
                 '<use> 无法引用，图标会全部空白')
    code = strip_code_comments(html)
    sprite_ids = set(re.findall(r'<symbol[^>]*id="(i-[a-z0-9-]+)"', code))
    if not sprite_ids:
        fail('sprite 里没有解析到任何 <symbol>')
        return
    # 图标有两种引用方式：标记/字符串里的 <use href="#i-x">，
    # 以及路由表里的 icon: 'i-x'（tabBar 由 app.js 动态生成）。
    # 图标有三种引用方式：标记里的 <use href="#i-x">、路由表里的 icon: 'i-x'
    # （tabBar 由 app.js 动态生成）、以及 JS 里 setAttribute('href', '#i-x') 换图。
    used = set(re.findall(r'<use[^>]*href="#(i-[a-z0-9-]+)"', code))
    used |= set(re.findall(r"icon:\s*'(i-[a-z0-9-]+)'", code))
    used |= set(re.findall(r"""['"]#(i-[a-z0-9-]+)['"]""", code))
    missing = sorted(used - sprite_ids)
    if missing:
        fail('以下图标被引用但 sprite 中不存在：%s' % '、'.join(missing))
    unused = sorted(sprite_ids - used)
    if unused:
        warn('sprite 中有 %d 个图标备而未用：%s' % (len(unused), '、'.join(unused)))


def check_miniapp_traces(html):
    code = strip_code_comments(html)
    probes = [
        (r'\brpx\b', 'rpx 单位'),
        (r'\{\{', '模板插值 {{ }}'),
        (r'\bwx\.[a-zA-Z]', '小程序 API wx.*'),
        (r'\bbindtap\b', 'bindtap 事件属性'),
        (r'\bcatchtap\b', 'catchtap 事件属性'),
        (r'\bhover-class\b', 'hover-class 属性'),
        (r'data:image/png;base64', '内联 base64 PNG'),
        # 只匹配真正的资源引用；<input accept=".png"> 是合法用法，不算痕迹
        (r'(?:src|href)\s*=\s*["\'][^"\']*\.png|url\(\s*["\']?[^)\'"]*\.png', 'PNG 资源引用'),
        (r'\bdata-wx-', 'data-wx-* 属性'),
    ]
    for pat, label in probes:
        hits = re.findall(pat, code)
        if hits:
            fail('发现小程序痕迹 —— %s（%d 处）' % (label, len(hits)))


def check_tag_balance(html):
    code, _ = strip_blocks(html, 'script')
    code, _ = strip_blocks(code, 'style')
    code = strip_comments(code)
    code = re.sub(r'<!DOCTYPE[^>]*>', '', code, flags=re.I)

    stack = []
    for m in TAG_RE.finditer(code):
        closing, tag, attrs = m.group(1), m.group(2).lower(), m.group(3)
        # 自闭合的「/」可能已被属性组吃掉（正则里属性段是贪婪的），
        # 所以除了看 group(4)，还要看属性串结尾
        self_close = bool(m.group(4)) or attrs.rstrip().endswith('/')
        if tag in VOID or self_close:
            continue
        if closing:
            if not stack:
                fail('标签配对：多出一个 </%s>' % tag)
                return
            if stack[-1] != tag:
                fail('标签配对：期望 </%s>，实际 </%s>' % (stack[-1], tag))
                return
            stack.pop()
        else:
            stack.append(tag)
    if stack:
        fail('标签配对：以下标签未闭合 %s' % '、'.join(reversed(stack[:8])))


def check_brace_balance(html):
    _, styles = strip_blocks(html, 'style')
    for i, css in enumerate(styles):
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
        if css.count('{') != css.count('}'):
            fail('第 %d 个 <style> 花括号不平衡（%d 开 / %d 闭）'
                 % (i + 1, css.count('{'), css.count('}')))
    if not styles:
        fail('产物里没有内联样式块')

    _, scripts = strip_blocks(html, 'script')
    for i, js in enumerate(scripts):
        js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
        js = re.sub(r'(?m)^\s*//.*$', '', js)
        if js.count('{') != js.count('}'):
            fail('第 %d 个 <script> 花括号不平衡（%d 开 / %d 闭）'
                 % (i + 1, js.count('{'), js.count('}')))
    if not scripts:
        fail('产物里没有内联脚本块')


def report_size(html, path):
    def kb(n):
        return '%.1f KB' % (n / 1024.0)

    _, styles = strip_blocks(html, 'style')
    _, scripts = strip_blocks(html, 'script')
    m = re.search(r'<div id="pp-sprite".*?</div>', html, re.S)
    fragments = re.findall(r'<template[^>]*id="frag-[a-z0-9-]+"', strip_code_comments(html))
    print('  样式块 %d 个 %s ｜ 脚本块 %d 个 %s ｜ sprite %s ｜ 片段 %d 个'
          % (len(styles), kb(sum(len(s) for s in styles)),
             len(scripts), kb(sum(len(s) for s in scripts)),
             kb(len(m.group(0))) if m else '—',
             len(fragments)))
    print('  产物总大小 %s（%s）' % (kb(os.path.getsize(path)), path))


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'index.html')
    if not os.path.isfile(target):
        print('找不到产物：%s，请先运行 tools/bundle.py' % target)
        return 1

    html = io.open(target, encoding='utf-8').read()
    print('校验 %s' % target)

    checks = [
        ('产物自包含（无外链 CSS/JS）', check_no_external),
        ('页面片段齐全', check_fragments),
        ('图标引用全部命中 sprite', check_icons),
        ('无小程序痕迹', check_miniapp_traces),
        ('HTML 标签配对', check_tag_balance),
        ('CSS / JS 花括号配对', check_brace_balance),
    ]
    passed = 0
    for label, fn in checks:
        before = len(errors)
        fn(html)
        if len(errors) == before:
            passed += 1
            print('  ✓ %s' % label)
        else:
            print('  ✗ %s' % label)

    report_size(html, target)

    for w in warns:
        print('  ⚠ %s' % w)
    if errors:
        print('\n未通过 %d 项：' % len(errors))
        for e in errors:
            print('  · %s' % e)
        return 1
    print('\n全部 %d 项检查通过' % passed)
    return 0


if __name__ == '__main__':
    sys.exit(main())
