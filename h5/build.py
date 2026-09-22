#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PPTransfer 小程序 -> H5 单文件 构建脚本

把 miniapp 的 WXML / WXSS / JS 转换成一份自带运行时、可直接双击打开的
单文件 H5 应用。转换规则：

  WXML  view->div  text->span  image->img  scroll-view->div  block->h5-block
        wx:if/elif/else/for/key/for-item/for-index -> data-wx-*
        bindX -> data-on-X       catchX -> data-on-X-catch
        hover-class -> data-hover-class
        picker -> 视觉层 + 原生 input[type=date]/select 透明覆盖

  WXSS  Nrpx -> (N*0.1)rem（1rem === 10rpx，运行时按视口宽度设定 root 字号）
        image -> img 等标签选择器同步改名
        页面样式统一加 #pg-<name> 作用域前缀，避免各页 .page 互相覆盖
        100vh -> 100%（页面高度由外壳的滚动容器决定）

  JS    原样保留，包进 __H5_REGISTER__ 注入 require / getApp / Page / wx
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(ROOT)

# 默认按本地目录约定：h5/ 与 pptransfer-miniapp/ 同级，产物落在其父目录。
# 可用 --miniapp / --out 覆盖，便于在只含本仓库（无小程序源码）的环境里构建。
MINIAPP = os.path.join(WORKSPACE, 'pptransfer-miniapp')
OUT_HTML = os.path.join(WORKSPACE, 'pptransfer-h5.html')

# ---------------------------------------------------------------- 基础工具


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def rem_num(v):
    s = ('%.4f' % v).rstrip('0').rstrip('.')
    return (s if s else '0') + 'rem'


def convert_rpx(css):
    return re.sub(r'(-?\d+(?:\.\d+)?)rpx', lambda m: rem_num(float(m.group(1)) * 0.1), css)


TAG_SELECTOR_MAP = {
    'view': 'div',
    'text': 'span',
    'image': 'img',
    'scroll-view': 'div',
    'block': 'h5-block',
}


def convert_css_tags(css):
    """同步标签选择器改名（不碰类名 / 属性值）"""
    for old, new in TAG_SELECTOR_MAP.items():
        # 前面是行首、空白、逗号、>、+、~ 等组合符，后面是空白或 { , : . [ 之一
        css = re.sub(r'(?<![\w.#\-%])' + re.escape(old) + r'(?![\w\-])', new, css)
    # ec-canvas 转为带类的占位容器（WXML 侧同步注入 class）
    css = re.sub(r'(?<![\w.#\-%])ec-canvas(?![\w\-])', '.h5-chart-host', css)
    return css


def add_scope(css, scope):
    """给每个规则的选择器加作用域前缀，注释保持原位"""
    comments = []

    def stash(m):
        comments.append(m.group(0))
        return '\x00%d\x00' % (len(comments) - 1)

    css = re.sub(r'/\*[\s\S]*?\*/', stash, css)

    def repl(m):
        head, body = m.group(1), m.group(2)
        sels = []
        for raw in head.split(','):
            s = raw.strip()
            if not s:
                continue
            lead = ''
            lm = re.match(r'^(\x00\d+\x00\s*)+', s)
            if lm:
                lead, s = lm.group(0), s[lm.end():]
            if not s:
                continue
            if s == 'page' or s.startswith('page ') or s.startswith('page:'):
                s = 'body' + s[4:]
            sels.append(lead + scope + ' ' + s)
        if not sels:
            return m.group(0)
        return ','.join(sels) + '{' + body + '}'

    css = re.sub(r'([^{}]+)\{([^{}]*)\}', repl, css)
    css = re.sub(r'\x00(\d+)\x00', lambda m: comments[int(m.group(1))], css)
    return css


def strip_css_comments(css):
    return re.sub(r'/\*[\s\S]*?\*/', '', css)


# ---------------------------------------------------------------- WXML 转换

RE_HTML_COMMENT = re.compile(r'<!--[\s\S]*?-->')
# 属性值里可能出现 "{{a > 0}}" 这类含 '>' 的表达式，故一律做引号感知匹配
_ATTRS = r'((?:"[^"]*"|\'[^\']*\'|[^>"\'])*)'
RE_PICKER = re.compile(r'<picker\b' + _ATTRS + r'>([\s\S]*?)</picker>')
RE_SCROLLVIEW_OPEN = re.compile(r'<scroll-view\b' + _ATTRS + r'>')
RE_SELFCLOSE_BLOCK = re.compile(r'<(div|span|h5-block)' + _ATTRS + r'/>')


def attr_of(attrs, name):
    m = re.search(r'\b' + name + r'="([^"]*)"', attrs)
    return m.group(1) if m else None


def expr_of(attrs, name):
    """取出 value="{{X}}" 里的表达式 X"""
    v = attr_of(attrs, name)
    if v is None:
        return None
    m = re.fullmatch(r'\s*\{\{([\s\S]*?)\}\}\s*', v)
    return m.group(1) if m else v


def convert_attrs(text):
    """wx: / bind / catch / hover-class 属性改写"""

    def f_wx(m):
        name, val = m.group(1), m.group(2)
        if val is None:
            return 'data-wx-%s=""' % name
        vm = re.fullmatch(r'\s*\{\{([\s\S]*?)\}\}\s*', val)
        if vm:
            val = vm.group(1)
        return 'data-wx-%s="%s"' % (name, val)

    text = re.sub(r'\bwx:([a-z-]+)(?:="([^"]*)")?', f_wx, text)

    def f_bind(m):
        kind, evt, fn = m.group(1), m.group(2), m.group(3)
        return 'data-on-%s%s="%s"' % (evt, '-catch' if kind == 'catch' else '', fn)

    text = re.sub(r'\b(bind|catch)([a-z]+)="([^"]*)"', f_bind, text)
    text = re.sub(r'\bhover-class="([^"]*)"', r'data-hover-class="\1"', text)
    text = text.replace('hover-start-time=', 'data-ignore-hst=').replace('hover-stay-time=', 'data-ignore-hst2=')
    return text


def convert_picker(m):
    attrs, inner = m.group(1), m.group(2)
    mode = attr_of(attrs, 'mode') or 'selector'
    cls = attr_of(attrs, 'class') or ''
    fn = attr_of(attrs, 'bindchange') or ''
    val = expr_of(attrs, 'value') or ''

    # 注意：这里用字符串拼接而非 % 格式化，避免 {{ }} 被转义吞掉
    if mode == 'date':
        return (
            '<div class="' + cls + ' h5-date-pick">' + inner +
            '<input type="date" class="h5-date-cover" value="{{' + val +
            '}}" data-on-change="' + fn + '" />'
            '</div>'
        )

    rng = expr_of(attrs, 'range') or '[]'
    return (
        '<div class="' + cls + ' h5-select-pick">' + inner +
        '<select class="h5-select-cover" value="{{' + val +
        '}}" data-h5-options="' + rng + '" data-on-change="' + fn + '"></select>'
        '</div>'
    )


def convert_scrollview_open(m):
    attrs = m.group(1)
    cls = attr_of(attrs, 'class')
    new_cls = (cls + ' h5-scroll-x') if cls else 'h5-scroll-x'
    # 其他属性（bindscroll 之类）一并保留转换
    rest = re.sub(r'\bclass="[^"]*"', '', attrs)
    rest = re.sub(r'\b(scroll-x|scroll-y|enhanced|show-scrollbar|enable-flex|bounces|fast-deceleration)="[^"]*"', '', rest)
    rest = re.sub(r'\b(scroll-x|scroll-y|enhanced|enable-flex|bounces)\b(?!\s*=)', '', rest)
    return '<div class="%s"%s>' % (new_cls, convert_attrs(rest))


def convert_wxml(wxml):
    wxml = RE_HTML_COMMENT.sub('', wxml)

    # picker 需在标签映射前处理（要读 mode / range / value）
    wxml = RE_PICKER.sub(convert_picker, wxml)
    wxml = RE_SCROLLVIEW_OPEN.sub(convert_scrollview_open, wxml)

    # 标签映射
    wxml = re.sub(r'<scroll-view\b', '<div', wxml)
    wxml = re.sub(r'</scroll-view>', '</div>', wxml)
    wxml = re.sub(r'<ec-canvas\b', '<div class="h5-chart-host"', wxml)
    wxml = re.sub(r'</ec-canvas>', '</div>', wxml)
    wxml = re.sub(r'<block\b', '<h5-block', wxml)
    wxml = re.sub(r'</block>', '</h5-block>', wxml)
    wxml = re.sub(r'<image\b', '<img', wxml)
    wxml = re.sub(r'</image>', '', wxml)
    wxml = re.sub(r'<view\b', '<div', wxml)
    wxml = re.sub(r'</view>', '</div>', wxml)
    wxml = re.sub(r'<text\b', '<span', wxml)
    wxml = re.sub(r'</text>', '</span>', wxml)

    # 属性改写
    wxml = convert_attrs(wxml)

    # 自闭合的非 void 标签展开（否则 HTML 解析器会吞掉后续内容）
    wxml = RE_SELFCLOSE_BLOCK.sub(r'<\1\2></\1>', wxml)

    # image 自闭合 -> img（void 元素，去掉斜杠）
    wxml = re.sub(r'<img((?:[^>"\']|"[^"]*")*?)\s*/>', r'<img\1>', wxml)

    return wxml.strip()


# ---------------------------------------------------------------- 资源


def build_img_map():
    d = os.path.join(MINIAPP, 'images')
    out = {}
    for fn in sorted(os.listdir(d)):
        if not fn.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg')):
            continue
        ext = 'image/png'
        if fn.lower().endswith(('.jpg', '.jpeg')):
            ext = 'image/jpeg'
        elif fn.lower().endswith('.gif'):
            ext = 'image/gif'
        elif fn.lower().endswith('.svg'):
            ext = 'image/svg+xml'
        with open(os.path.join(d, fn), 'rb') as f:
            out[fn] = 'data:%s;base64,%s' % (ext, base64.b64encode(f.read()).decode())
    return out


# ---------------------------------------------------------------- 主流程


USAGE = """用法: python3 build.py [--miniapp <小程序目录>] [--out <输出 html>]

  --miniapp  小程序源码目录（含 app.json / pages / images），
             默认 ../pptransfer-miniapp
  --out      产出的单文件 HTML 路径，默认 ../pptransfer-h5.html
             在只含本仓库的环境里通常写成 --out index.html
"""


def parse_args(argv):
    """极简参数解析，避免引入对 py 版本敏感的 argparse 行为。"""
    global MINIAPP, OUT_HTML
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('-h', '--help'):
            print(USAGE)
            sys.exit(0)
        if a == '--miniapp' and i + 1 < len(argv):
            MINIAPP = os.path.abspath(argv[i + 1])
            i += 2
            continue
        if a == '--out' and i + 1 < len(argv):
            OUT_HTML = os.path.abspath(argv[i + 1])
            i += 2
            continue
        print('未知参数: %s\n%s' % (a, USAGE))
        return False
    if not os.path.isdir(MINIAPP):
        print('找不到小程序目录: %s\n%s' % (MINIAPP, USAGE))
        return False
    return True


def main():
    app_json = json.loads(read(os.path.join(MINIAPP, 'app.json')))
    page_paths = app_json['pages']
    tab_list = app_json.get('tabBar', {}).get('list', [])
    tab_by_path = {t['pagePath']: t for t in tab_list}

    metas = []
    for p in page_paths:
        name = p.split('/')[1]
        cfg_path = os.path.join(MINIAPP, 'pages', name, name + '.json')
        title = name
        if os.path.exists(cfg_path):
            title = json.loads(read(cfg_path)).get('navigationBarTitleText', name)
        tab = tab_by_path.get(p)
        metas.append({
            'name': name,
            'title': title,
            'isTab': bool(tab),
            'tabText': tab.get('text') if tab else None,
            'tabIcon': os.path.basename(tab['selectedIconPath']) if tab else None,
        })

    # ---- CSS ----
    shell_css = read(os.path.join(ROOT, 'shell.css'))

    app_css = read(os.path.join(MINIAPP, 'app.wxss'))
    # page 选择器 -> body（CSS 变量与全局字体随 body 继承到全部内容）
    app_css = re.sub(r'(?m)^(\s*)page\s*\{', r'\1body {', app_css)
    app_css = convert_rpx(convert_css_tags(app_css))
    app_css = app_css.replace('100vh', '100%')

    page_css_list = []
    for m in metas:
        name = m['name']
        p = os.path.join(MINIAPP, 'pages', name, name + '.wxss')
        if not os.path.exists(p):
            continue
        css = read(p)
        css = convert_rpx(convert_css_tags(css))
        css = css.replace('100vh', '100%')
        css = add_scope(css, '#pg-' + name)
        page_css_list.append('/* ===== pages/%s ===== */\n%s' % (name, strip_css_comments(css).strip()))

    # ---- 模板 ----
    templates = []
    for m in metas:
        name = m['name']
        p = os.path.join(MINIAPP, 'pages', name, name + '.wxml')
        html = convert_wxml(read(p))
        templates.append('<template id="tpl-%s">\n%s\n</template>' % (name, html))

    # ---- JS ----
    def wrap(name, js):
        return "window.__H5_REGISTER__('%s', function (require, module, exports, getApp, Page, wx) {\n%s\n});" % (name, js)

    app_js = read(os.path.join(MINIAPP, 'app.js'))
    mod_js = []
    for rel in ('utils/chart.js', 'utils/format.js'):
        p = os.path.join(MINIAPP, rel)
        if os.path.exists(p):
            mod_js.append("window.__H5_MODULES__['%s'] = function (require, module, exports, getApp, Page, wx) {\n%s\n};"
                          % (os.path.basename(rel), read(p)))

    page_js = []
    for m in metas:
        name = m['name']
        p = os.path.join(MINIAPP, 'pages', name, name + '.js')
        if os.path.exists(p):
            page_js.append(wrap(name, read(p)))

    runtime_js = read(os.path.join(ROOT, 'runtime.js'))

    # ---- 图片 ----
    img_map = build_img_map()

    # ---- 组装 ----
    html = []
    html.append('<!DOCTYPE html>')
    html.append('<html lang="zh-CN">')
    html.append('<head>')
    html.append('<meta charset="utf-8">')
    html.append('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, '
                'user-scalable=no, viewport-fit=cover">')
    html.append('<meta name="theme-color" content="#ffffff">')
    html.append('<meta name="apple-mobile-web-app-capable" content="yes">')
    html.append('<title>PPTransfer 商户端 · H5</title>')
    html.append('<!-- 由 build.py 从小程序源码自动生成，请勿直接编辑 -->')
    html.append('<style>')
    html.append(shell_css)
    html.append('</style>')
    html.append('<style>')
    html.append('/* ===== app.wxss（全局设计系统） ===== */')
    html.append(app_css)
    html.append('</style>')
    html.append('<style>')
    html.append('\n'.join(page_css_list))
    html.append('</style>')
    html.append('</head>')
    html.append('<body>')
    html.append('<div id="h5-app">')
    html.append('  <div id="h5-pages"></div>')
    html.append('  <nav id="h5-tabbar"></nav>')
    html.append('</div>')
    html.append('')
    html.append('<!-- ===== 页面模板 ===== -->')
    html.extend(templates)
    html.append('')
    html.append('<script>window.__H5_IMG__ = ' + json.dumps(img_map, ensure_ascii=False) + ';</script>')
    html.append('<script>window.__H5_MODULES__ = {};</script>')
    html.append('<script>window.__H5_PAGES__ = ' + json.dumps(metas, ensure_ascii=False) + ';</script>')
    html.append('<script>')
    html.extend(mod_js)
    html.append('</script>')
    html.append('<script>')
    html.append(runtime_js)
    html.append('</script>')
    html.append('<script>')
    html.append('(function () {')
    html.append('  var B = window.__H5_BOOTSTRAP__;')
    html.append('  (function (App, getApp, wx) {')
    html.append(app_js)
    html.append('  })(B.App, B.getApp, B.WX);')
    html.append('})();')
    html.append('</script>')
    html.append('<script>')
    html.extend(page_js)
    html.append('</script>')
    html.append('</body>')
    html.append('</html>')

    out = '\n'.join(html)
    out_dir = os.path.dirname(OUT_HTML)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(out)

    size = os.path.getsize(OUT_HTML)
    print('输出: %s' % OUT_HTML)
    print('大小: %.1f KB' % (size / 1024.0))
    print('页面: %d 个（tab %d 个）' % (len(metas), sum(1 for m in metas if m['isTab'])))
    print('图片: %d 张内嵌' % len(img_map))
    print('CSS : shell %.1f KB + 全局 %.1f KB + 页面 %.1f KB'
          % (len(shell_css) / 1024.0, len(app_css) / 1024.0, sum(len(c) for c in page_css_list) / 1024.0))
    print('JS  : runtime %.1f KB + 模块 %.1f KB + 页面 %.1f KB'
          % (len(runtime_js) / 1024.0, sum(len(m) for m in mod_js) / 1024.0, sum(len(m) for m in page_js) / 1024.0))
    return 0


if __name__ == '__main__':
    if not parse_args(sys.argv[1:]):
        sys.exit(1)
    sys.exit(main())
