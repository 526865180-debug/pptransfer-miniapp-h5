#!/usr/bin/env node
/**
 * render_check.js · 产物首屏渲染验证（零依赖）
 *
 * 逐个路由打开产物，等页面就绪后断言：
 *   · 目标页可见、且同屏只有一页
 *   · 导航栏标题正确；tab 页显示 tabBar、二级页有返回键
 *   · 图标 <use> 都能解析到 SVG 命名空间的 symbol（否则图标是空白的）
 *   · canvas 图表真的画了东西（读像素，不是只看元素存在）
 *   · 控制台无报错
 * 每个路由存一张截图到 tools/.render-out/，肉眼复核用。
 *
 * 用法：node tools/render_check.js [产物路径，默认 ./index.html]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { CDP, launchChrome, openPage } = require('./cdp')

const ROOT = path.resolve(__dirname, '..')
// 参数可以是本地产物路径，也可以是 http(s) 地址（用来验证开发态 src/index.html）
const TARGET = process.argv[2]
  ? (/^https?:\/\//.test(process.argv[2]) ? process.argv[2] : path.resolve(ROOT, process.argv[2]))
  : path.resolve(ROOT, 'index.html')
const OUT_DIR = path.join(__dirname, '.render-out')
const VIEWPORT = { width: 390, height: 844, scale: 2 }

function readRoutes() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'routes.js'), 'utf8')
  const out = []
  const re = /\{\s*name:\s*'([^']+)',\s*title:\s*'([^']+)'(,\s*tab:)?/g
  let m
  while ((m = re.exec(src))) out.push({ name: m[1], title: m[2], tab: !!m[3] })
  return out
}

/* 页内探测：一次 eval 拿齐所有断言需要的数据 */
const PROBE = `(function () {
  var pages = [].slice.call(document.querySelectorAll('#app-body > .page'));
  var visible = pages.filter(function (p) { return !p.hidden });
  var el = visible[0];
  var canvas = el && el.querySelector('canvas');
  var charted = false;
  if (canvas) {
    var d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (var k = 3; k < d.length; k += 4) { if (d[k] !== 0) { charted = true; break } }
  }
  return {
    route: PP.router.current(),
    visibleCount: visible.length,
    dataPage: el ? el.getAttribute('data-page') : null,
    nodes: el ? el.querySelectorAll('*').length : 0,
    textLen: el ? (el.textContent || '').replace(/\\s+/g, '').length : 0,
    title: document.querySelector('#bar-title').textContent,
    tabbarHidden: document.querySelector('#tabbar').hidden,
    backBtn: !!document.querySelector('#bar-back'),
    brokenIcons: [].slice.call(document.querySelectorAll('use')).filter(function (u) {
      var id = (u.getAttribute('href') || '').slice(1);
      var sym = id && document.getElementById(id);
      // getElementById 找得到不代表能用：<symbol> 若落在 HTML 命名空间
      // （例如被剥掉外层 <svg> 放进 div），<use> 解析不到，图标就是空白的
      return !sym || !(sym instanceof SVGElement);
    }).length,
    canvas: canvas ? { w: canvas.width, h: canvas.height, charted: charted } : null
  }
})()`

async function main() {
  const isUrl = /^https?:\/\//.test(TARGET)
  if (!isUrl && !fs.existsSync(TARGET)) {
    console.error('找不到产物：' + TARGET + '，请先运行 tools/bundle.py')
    return 1
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const routes = readRoutes()
  const { proc, port } = await launchChrome()
  const shots = []

  try {
    const { cdp, problems } = await openPage(port)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.scale, mobile: true,
    })

    const fileUrl = isUrl ? TARGET : 'file://' + TARGET
    const bad = []

    for (let i = 0; i < routes.length; i++) {
      const r = routes[i]
      const mark = problems.length
      // 带 query 强制整页重载，避免只变 hash 时浏览器不重新解析
      await cdp.send('Page.navigate', { url: fileUrl + '?r=' + i + '#/' + r.name })
      await cdp.waitFor(
        `window.PP && PP.router.current() === ${JSON.stringify(r.name)} && ` +
        `document.querySelector('#app').classList.contains('is-ready')`,
        '页面 ' + r.name
      )
      await cdp.eval('new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 400) }) })')

      const p = await cdp.eval(PROBE)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(OUT_DIR, String(i).padStart(2, '0') + '-' + r.name + '.png')
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
      shots.push(file)

      const flags = []
      if (p.visibleCount !== 1) flags.push('可见页数=' + p.visibleCount)
      if (p.dataPage !== r.name) flags.push('data-page=' + p.dataPage)
      if (p.nodes < 10) flags.push('节点数过少')
      if (p.brokenIcons) flags.push('空白图标=' + p.brokenIcons)
      if (p.title !== r.title) flags.push('标题不符(' + p.title + ')')
      if (r.tab && p.tabbarHidden) flags.push('tab 页却隐藏了 tabBar')
      if (!r.tab && !p.backBtn) flags.push('二级页却没有返回键')
      if (problems.length > mark) flags.push('控制台报错 ' + (problems.length - mark) + ' 条')
      if (flags.length) bad.push(r.name)

      console.log('%s %s  节点 %s ｜ 标题 %s%s',
        flags.length ? 'x' : '✓', r.name.padEnd(24),
        String(p.nodes).padStart(4), p.title + (r.tab ? ' [tab]' : ''),
        flags.length ? '   ← ' + flags.join('；') : '')
      if (p.canvas) {
        console.log('    canvas %dx%d 绘制%s', p.canvas.w, p.canvas.h,
          p.canvas.charted ? '有内容' : '为空 ←')
      }
    }

    console.log('\n截图 %d 张 → %s', shots.length, path.relative(ROOT, OUT_DIR))
    if (bad.length) {
      console.log('异常页面：%s', bad.join('、'))
      return 1
    }
    console.log('%d 页渲染正常', routes.length)
    return 0
  } finally {
    proc.kill()
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('渲染验证失败：', e.message)
  process.exit(1)
})
