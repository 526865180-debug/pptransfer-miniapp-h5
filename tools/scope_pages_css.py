#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""页面 CSS 作用域工具。

为什么需要
----------
13 个页面的样式表是按固定顺序全部加载的，若两页各自定义了同名类
（如 .ccy-flag / .rec-right / .swap-btn），后加载的会覆盖前一页。
给顶层选择器加上页面前缀后，选择器只在对应页面节点内命中。

弹层类例外
----------
PP.ui 的弹层挂在 #layer-root（不在 .page 内部），因此这些选择器
必须用 #layer-root 前缀，见 PLAN 的 layer_map。

实现要点（前两版踩过的坑）
------------------------
第二版把注释也当成了选择器的一部分：注释被替换成占位符后成为
「非空白字符」，于是 stripped.startswith('.page[') 判定失败，
前缀被插到了注释「之前」，产出

    .page[data-page='index'] /* 企业信息横幅 */
    .corp-banner{ ... }

正确位置是注释「之后」、真实选择器「之前」。因此本版先做
split_lead() 把「前导空白 + 注释」与核心选择器分开，前缀只加在
核心选择器上。

运行是幂等的：先剥离本工具插入过的前缀，再重新插入，
所以重复运行不会累积、嵌套，也可以用来修复历史产物。
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, 'src', 'styles', 'pages')

LAYER = '#layer-root '

PLAN = {
    'index.css': (".page[data-page='index'] ", {}),
    'exchange.css': (".page[data-page='exchange'] ", {
        'confirm-lock': LAYER,
        'countdown': LAYER,
        'pwd-field': LAYER,
        'done-icon': LAYER,
        'dialog-': LAYER,
    }),
    'international-remittance.css': (".page[data-page='international-remittance'] ", {}),
}

# 这些开头的选择器不需要（也不应该）再加页面前缀
SKIP_HEADS = (
    '.page[data-page=', LAYER, 'page[', ':root', 'html', 'body',
    '*', '@', '#app-', '#toast', '#layer-',
)


def split_lead(sel):
    """把块前的文本切成 (前导空白+注释, 核心选择器, 尾部空白)。"""
    i, n = 0, len(sel)
    while i < n:
        if sel[i].isspace():
            i += 1
            continue
        if sel.startswith('/*', i):
            j = sel.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        break
    core = sel[i:].rstrip()
    return sel[:i], core, sel[i + len(core):]


def strip_scope(css, prefixes):
    """移除本工具插入过的前缀。

    只在「前缀后面还有选择器内容」时移除 —— 若前缀后面（跳过空白）
    紧跟 `{`，说明它是页面根规则（.page[data-page='x']{...}），要保留。
    """
    for pfx in prefixes:
        css = re.sub(re.escape(pfx) + r'(?!\s*\{)', '', css)
    return css


def pick_prefix(part, default, layer_map):
    m = re.match(r'\.([A-Za-z][\w-]*)', part)
    if m:
        for head, pfx in layer_map.items():
            if m.group(1).startswith(head):
                return pfx
    return default


def add_scope(core, default, layer_map):
    parts = [p.strip() for p in core.split(',')]
    if all(any(p.startswith(h) for h in SKIP_HEADS) for p in parts):
        return core
    out = []
    for p in parts:
        if any(p.startswith(h) for h in SKIP_HEADS):
            out.append(p)
        else:
            out.append(pick_prefix(p, default, layer_map) + p)
    return ',\n'.join(out)


def walk(css, default, layer_map):
    """遍历顶层规则，逐个补前缀。花括号内容原样保留（不做嵌套缩进处理）。"""
    out = []
    i, n = 0, len(css)
    while i < n:
        brace = css.find('{', i)
        if brace < 0:
            out.append(css[i:])
            break
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        lead, core, trail = split_lead(css[i:brace])
        body = css[brace + 1:j - 1]

        if core.startswith('@'):
            # @media / @supports 递归；@keyframes / @font-face 原样
            if re.match(r'@(media|supports|layer|container)\b', core):
                body = walk(body, default, layer_map)
            elif re.match(r'@(font-face|page|counter-style|property)\b', core):
                pass
            out.append(lead + core + trail + '{' + body + '}')
        else:
            out.append(lead + add_scope(core, default, layer_map) + trail + '{' + body + '}')
        i = j
    return ''.join(out)


def main():
    changed = 0
    for name, (default, layer_map) in PLAN.items():
        path = os.path.join(PAGES, name)
        src = io.open(path, encoding='utf-8').read()
        css = strip_scope(src, (default, LAYER))
        dst = walk(css, default, layer_map)
        if dst != src:
            io.open(path, 'w', encoding='utf-8').write(dst)
            changed += 1
        print('%-30s %6d -> %6d bytes%s' % (name, len(src), len(dst),
                                            '' if dst == src else '  *'))
    print('done, %d file(s) rewritten' % changed)


if __name__ == '__main__':
    main()
