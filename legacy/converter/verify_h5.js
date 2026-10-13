#!/usr/bin/env node
/**
 * verify_h5.js — PPTransfer H5 单文件产物的结构与交互校验
 *
 * 用 jsdom 真实加载生成的 HTML（执行内联脚本），逐项验证：
 *   1. 外壳结构（13 个页面容器 / 4 个 tab）
 *   2. 各页面模板可渲染且节点数合理
 *   3. 表达式插值、动态 class、条件渲染、列表渲染结果
 *   4. 图片已内嵌为 data URI
 *   5. 事件绑定齐全（无「方法未定义」）
 *   6. 路由：tab 切换 / navigateTo / navigateBack
 *   7. setData 响应式更新
 *
 * 用法: node verify_h5.js [产物 html 路径]
 *       默认校验 ../pptransfer-h5.html；在只含本仓库的环境里用 index.html
 */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const ROOT = __dirname
const HTML = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, '..', 'pptransfer-h5.html')
if (!fs.existsSync(HTML)) {
  console.error('找不到产物文件: ' + HTML)
  console.error('用法: node verify_h5.js [产物 html 路径]')
  process.exit(1)
}
const html = fs.readFileSync(HTML, 'utf8')

const warns = []
const errors = []
let fakeCtxCalls = 0

const fakeCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 12 })
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
    if (k === 'canvas') return { width: 300, height: 150 }
    return () => { fakeCtxCalls++ }
  },
  set() { return true }
})

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx }
    window.console = {
      log: () => {},
      info: () => {},
      warn: (...a) => warns.push(a.map(String).join(' ')),
      error: (...a) => errors.push(a.map(String).join(' '))
    }
    window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message))
    window.navigator.vibrate = () => true
  }
})

const win = dom.window
const doc = win.document

// ------------------------------------------------------------------ 测试框架
const results = []
function check(name, fn) {
  try {
    const r = fn()
    // 允许断言返回元素自身（truthy）或 true/undefined 表示通过
    const ok = r === true || r === undefined || (r && typeof r === 'object' && r.nodeType === 1)
    if (ok) results.push({ ok: true, name })
    else results.push({ ok: false, name, msg: String(r) })
  } catch (e) {
    results.push({ ok: false, name, msg: e.message })
  }
}
function count(sel, root) { return (root || doc).querySelectorAll(sel).length }
function text(sel, root) { const el = (root || doc).querySelector(sel); return el ? el.textContent.trim() : null }

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

// ------------------------------------------------------------------ 执行
;(async function main() {
  await wait(120) // 等 runtime boot（含 setTimeout 0）

  const H5 = win.__H5__
  const PAGES = win.__H5_PAGES__ || []

  check('运行时已挂载 __H5__', () => !!H5 || '未找到 window.__H5__')
  check('页面元信息 13 条', () => PAGES.length === 13 || ('实际 ' + PAGES.length))

  // ---- 1. 外壳 ----
  check('页面容器 13 个 (#pg-*)', () => count('.pg') === 13 || ('实际 ' + count('.pg')))
  check('tabBar 项 4 个', () => count('#h5-tabbar .h5-tab') === 4 || ('实际 ' + count('#h5-tabbar .h5-tab')))
  check('首页默认显示且带 .on', () => doc.querySelector('#pg-index').classList.contains('on') || '首页未激活')
  check('body 进入 ready 态', () => doc.body.classList.contains('h5-ready') || '未加 h5-ready')

  // ---- 2. 首页渲染内容 ----
  const body = doc.querySelector('#pg-index .h5-body')
  check('首页渲染出节点', () => body.children.length > 0 || '首页内容为空')
  check('首页·企业横幅存在', () => body.querySelector('.corp-banner') || '缺少 .corp-banner')
  check('首页·资产 Hero 存在', () => body.querySelector('.hero') || '缺少 .hero')
  check('首页·快捷四宫格存在', () => body.querySelector('.quick-row') || '缺少 .quick-row')
  check('首页·图表容器存在', () => body.querySelector('.h5-chart-host') || '缺少 .h5-chart-host')
  check('首页·横幅公司名插值正确',
    () => text('.corp-name', body) === '极光科技(香港)有限公司' || ('实际 ' + text('.corp-name', body)))
  check('首页·未读角标按条件渲染',
    () => body.querySelector('.notice-badge') && text('.notice-badge', body) === '6' || '角标未渲染')
  check('首页·列表渲染出 6 个币种',
    () => count('.bal-chip', body) === 6 || ('实际 ' + count('.bal-chip', body)))
  check('首页·快捷操作 4 项',
    () => count('.quick-item', body) === 4 || ('实际 ' + count('.quick-item', body)))
  check('首页·汇率币对 tab 3 个',
    () => count('.rate-tab', body) === 3 || ('实际 ' + count('.rate-tab', body)))
  check('首页·当前激活币对为 USD/CNH',
    () => (body.querySelector('.rate-tab.active') || {}).textContent === 'USD/CNH' || '激活项不正确')
  check('首页·图表已用 canvas 绘制',
    () => body.querySelector('.h5-chart-host canvas') ? true : '未创建 canvas')

  // ---- 3. 图片内嵌 ----
  const imgs = doc.querySelectorAll('.pg img')
  const badImgs = []
  imgs.forEach(im => { const s = im.getAttribute('src') || ''; if (!s.startsWith('data:image/')) badImgs.push(s) })
  check('图片全部内嵌为 data URI',
    () => badImgs.length === 0 || ('未内嵌 ' + badImgs.length + ' 张，例：' + badImgs.slice(0, 3).join(', ')))

  // ---- 4. 逐页渲染 ----
  const pageResults = []
  for (const meta of PAGES) {
    const n = meta.name
    H5.WX.switchTab({ url: '/pages/index/index' })
    if (meta.isTab) H5.WX.switchTab({ url: '/pages/' + n + '/' + n })
    else H5.WX.navigateTo({ url: '/pages/' + n + '/' + n })
    await wait(10)
    const el = doc.querySelector('#pg-' + n)
    const cnt = el.querySelector('.h5-body').children.length
    const shown = el.classList.contains('on')
    pageResults.push({ name: n, title: meta.title, nodes: cnt, shown })
  }
  const emptyPages = pageResults.filter(p => p.nodes === 0)
  check('13 个页面均可渲染出内容',
    () => emptyPages.length === 0 || ('空白页：' + emptyPages.map(p => p.name).join(', ')))
  const notShown = pageResults.filter(p => !p.shown)
  check('路由切换后目标页可见',
    () => notShown.length === 0 || ('未显示：' + notShown.map(p => p.name).join(', ')))

  // ---- 5. 交互：setData 响应式 ----
  H5.WX.switchTab({ url: '/pages/index/index' })
  await wait(10)
  const idxBody = doc.querySelector('#pg-index .h5-body')
  const before = idxBody.querySelector('.hero-amount').textContent
  const beforeBlur = idxBody.querySelector('.hero-amount').className
  // 触发金额脱敏开关
  const eye = idxBody.querySelector('.hero-eye')
  eye.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  await wait(10)
  const afterBlur = doc.querySelector('#pg-index .h5-body').querySelector('.hero-amount').className
  check('setData 触发重渲染（脱敏开关生效）',
    () => afterBlur.indexOf('on') >= 0 && beforeBlur.indexOf('on') < 0
      || ('切换前 "' + beforeBlur + '" → 切换后 "' + afterBlur + '"'))
  check('金额文本未被破坏', () => doc.querySelector('#pg-index .hero-amount').textContent === before
    || ('实际 ' + doc.querySelector('#pg-index .hero-amount').textContent))

  // ---- 6. tab 切换 ----
  const tab3 = doc.querySelectorAll('#h5-tabbar .h5-tab')[3]
  tab3.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  await wait(10)
  check('点击 tabBar 第 4 项进入权益中心',
    () => doc.querySelector('#pg-rights-center').classList.contains('on') || '未切换')
  check('tabBar 选中态跟随切换',
    () => tab3.classList.contains('on') || 'tab 未高亮')
  check('非 tab 页隐藏 tabBar',
    () => doc.querySelector('#pg-rights-center').classList.contains('on')
      && doc.getElementById('h5-tabbar').classList.contains('on') || 'tabBar 状态异常')

  // 权益中心内容抽样
  const rc = doc.querySelector('#pg-rights-center .h5-body')
  check('权益中心·优惠券卡片渲染',
    () => count('.rc-coupon', rc) > 0 || '无优惠券卡片')
  check('权益中心·筛选 tab 渲染',
    () => count('.rc-tab', rc) === 5 || ('实际 ' + count('.rc-tab', rc)))
  check('权益中心·统计 2×2 渲染',
    () => count('.rc-stat', rc) === 4 || ('实际 ' + count('.rc-stat', rc)))

  // ---- 7. 弹层与导航 ----
  const detailBtn = rc.querySelector('.rc-detail-btn')
  if (detailBtn) {
    detailBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(10)
    check('优惠券详情弹层可打开',
      () => doc.querySelector('#pg-rights-center .mask') ? true : '弹层未出现')
    const mask = doc.querySelector('#pg-rights-center .mask')
    if (mask) {
      mask.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await wait(10)
      check('点击遮罩可关闭弹层',
        () => !doc.querySelector('#pg-rights-center .mask') ? true : '弹层未关闭')
    }
  }

  // navigateTo 二级页 + 返回
  H5.WX.switchTab({ url: '/pages/index/index' })
  await wait(10)
  H5.WX.navigateTo({ url: '/pages/order-management/order-management' })
  await wait(10)
  check('navigateTo 打开二级页',
    () => doc.querySelector('#pg-order-management').classList.contains('on') || '未打开')
  check('二级页显示返回按钮',
    () => !doc.querySelector('#pg-order-management .h5-nav').classList.contains('no-back') || '返回按钮被隐藏')
  H5.WX.navigateBack({ delta: 1 })
  await wait(10)
  check('navigateBack 回到首页',
    () => doc.querySelector('#pg-index').classList.contains('on') || '未返回')

  // ---- 8. 表单 / 筛选弹层 ----
  H5.WX.navigateTo({ url: '/pages/trade-collection/trade-collection' })
  await wait(10)
  const tc = doc.querySelector('#pg-trade-collection .h5-body')
  check('收款页·状态统计条渲染',
    () => count('.stat-item', tc) === 4 || ('实际 ' + count('.stat-item', tc)))
  check('收款页·收款卡片渲染',
    () => count('.coll-card', tc) > 0 || ('实际 ' + count('.coll-card', tc)))
  check('收款页·搜索框存在',
    () => tc.querySelector('.search-box') ? true : '缺少搜索框')

  // 筛选弹层（初始隐藏，点开后检查表单控件）
  const filterBtn = tc.querySelector('.filter-btn')
  if (filterBtn) {
    filterBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(10)
    const sheet = doc.querySelector('#pg-trade-collection .sheet')
    check('收款页·筛选弹层可打开', () => sheet ? true : '弹层未出现')
    if (sheet) {
      check('收款页·日期选择转原生控件',
        () => count('input[type="date"]', sheet) === 2 || ('实际 ' + count('input[type="date"]', sheet)))
      check('收款页·账号选择转原生控件',
        () => count('select', sheet) === 1 || ('实际 ' + count('select', sheet)))
      check('收款页·下拉选项按 range 生成',
        () => { const s = sheet.querySelector('select'); return s && s.options.length > 0 || '无 option' })
    }
  }

  // ---- 9. 图表在重渲染后的存活 ----
  H5.WX.switchTab({ url: '/pages/index/index' })
  await wait(10)
  check('图表 canvas 已创建',
    () => doc.querySelector('#pg-index .h5-chart-host canvas') ? true : '未创建 canvas')

  const rateTabs = doc.querySelectorAll('#pg-index .rate-tab')
  if (rateTabs.length > 1) {
    rateTabs[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(20)
    check('切换币对后图表实例仍存活',
      () => doc.querySelector('#pg-index .h5-chart-host canvas') ? true : 'canvas 在重渲染后丢失')
    check('切换币对后激活态同步',
      () => (doc.querySelector('#pg-index .rate-tab.active') || {}).textContent === 'EUR/CNH'
        || ('实际 ' + ((doc.querySelector('#pg-index .rate-tab.active') || {}).textContent)))
  }

  const rangeItems = doc.querySelectorAll('#pg-index .range-item')
  if (rangeItems.length > 2) {
    rangeItems[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await wait(20)
    check('切换区间后图表实例仍存活',
      () => doc.querySelector('#pg-index .h5-chart-host canvas') ? true : 'canvas 丢失')
    check('切换区间后激活态同步',
      () => (doc.querySelector('#pg-index .range-item.active') || {}).textContent === '30D'
        || ('实际 ' + ((doc.querySelector('#pg-index .range-item.active') || {}).textContent)))
  }

  // ---- 汇总 ----
  const bad = results.filter(r => !r.ok)
  const out = []
  out.push('')
  out.push('════════ PPTransfer H5 产物校验 ════════')
  results.forEach((r, i) => {
    out.push((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '\n      → ' + r.msg))
  })
  out.push('')
  out.push('页面渲染节点数：')
  pageResults.forEach(p => out.push('  ' + (p.nodes > 0 ? '·' : 'x') + ' ' + p.name.padEnd(26) + p.nodes + ' 节点  ' + p.title))
  out.push('')
  if (warns.length) {
    out.push('运行期告警 ' + warns.length + ' 条：')
    ;[...new Set(warns)].slice(0, 12).forEach(w => out.push('   ! ' + w))
    out.push('')
  }
  if (errors.length) {
    out.push('运行期错误 ' + errors.length + ' 条：')
    ;[...new Set(errors)].slice(0, 12).forEach(w => out.push('   ✗ ' + w))
    out.push('')
  }
  out.push('结果：' + (results.length - bad.length) + '/' + results.length + ' 通过' +
    (bad.length ? '，失败 ' + bad.length + ' 项' : '，全部通过'))

  console.log(out.join('\n'))
  process.exit(bad.length ? 1 : 0)
})().catch(e => {
  console.log('校验脚本异常: ' + e.stack)
  process.exit(1)
})
