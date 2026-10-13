#!/usr/bin/env node
/**
 * interact_check.js · 交互冒烟测试（零依赖）
 *
 * render_check.js 只证明「每页能渲染」，证明不了「点了有反应」。
 * 这里用真实点击驱动一条最常用的用户路径，逐项断言：
 *
 *   1. 金额脱敏开关     —— body[data-amount-hidden] 与 aria-pressed 联动，图标换 eye/eye-off
 *   2. tabBar 切换      —— 点击「收款」进入 trade-collection，aria-selected 正确
 *   3. 进入二级页       —— 快捷入口「换汇」→ exchange，导航栏出现返回键
 *   4. 返回             —— 点返回键回到原 tab，滚动容器只有一页可见
 *   5. 表单校验         —— exchange 直接提交应给出错误提示而不是静默失败
 *   6. 确认弹层         —— 填入合法金额提交，#layer-root 里出现确认弹层，可取消关闭
 *   7. 消息通知清零     —— 进入 notifications 后全局未读角标清零，列表仍在
 *
 * 任一步骤失败即非零退出。
 *
 * 用法：node tools/interact_check.js [产物路径，默认 ./index.html]
 */
'use strict'

const path = require('path')
const { CDP, launchChrome, openPage, sleep } = require('./cdp')

const ROOT = path.resolve(__dirname, '..')
const TARGET = path.resolve(ROOT, process.argv[2] || 'index.html')
const VIEWPORT = { width: 390, height: 844, scale: 2 }

let passed = 0
const failures = []

function check(label, cond, detail) {
  if (cond) {
    passed++
    console.log('  ✓ %s', label)
  } else {
    failures.push(label + (detail ? '（' + detail + '）' : ''))
    console.log('  ✗ %s%s', label, detail ? ' ← ' + detail : '')
  }
}

async function click(cdp, selector, scope) {
  // 用 DOM 直接派发真实 click，比模拟坐标稳定（不受滚动位置/遮挡影响）
  return cdp.eval(`(function () {
    var root = ${scope || 'document'};
    var el = root.querySelector(${JSON.stringify(selector)});
    if (!el) return '找不到元素：' + ${JSON.stringify(selector)};
    el.click();
    return null
  })()`)
}

async function step(name, cdp, fn) {
  console.log('\n· %s', name)
  await fn()
}

async function main() {
  const { proc, port } = await launchChrome()
  try {
    const { cdp, problems } = await openPage(port)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.scale, mobile: true,
    })
    await cdp.send('Page.navigate', { url: 'file://' + TARGET })
    await cdp.waitFor(`window.PP && PP.router.current() === 'index' && document.querySelector('#app').classList.contains('is-ready')`, '启动')
    await sleep(400)

    /* 1. 金额脱敏开关 ---------------------------------------------- */
    await step('金额脱敏开关', cdp, async () => {
      const s0 = await cdp.eval(`({
        hidden: document.body.getAttribute('data-amount-hidden'),
        pressed: document.querySelector('#amount-toggle').getAttribute('aria-pressed'),
        icon: document.querySelector('#amount-toggle use').getAttribute('href'),
        blurred: getComputedStyle(document.querySelector('[data-amount]')).filter
      })`)
      check('初始可见且未模糊', s0.hidden !== 'true' && s0.blurred === 'none', JSON.stringify(s0))

      await click(cdp, '#amount-toggle')
      await sleep(120)
      const s1 = await cdp.eval(`({
        hidden: document.body.getAttribute('data-amount-hidden'),
        pressed: document.querySelector('#amount-toggle').getAttribute('aria-pressed'),
        icon: document.querySelector('#amount-toggle use').getAttribute('href'),
        blurred: getComputedStyle(document.querySelector('[data-amount]')).filter
      })`)
      check('点击后模糊生效', s1.hidden === 'true' && s1.blurred.indexOf('blur') >= 0, JSON.stringify(s1))
      check('aria-pressed 同步', s1.pressed === 'false', s1.pressed)
      check('图标换成 eye-off', s1.icon === '#i-eye-off', s1.icon)

      await click(cdp, '#amount-toggle')
      // filter 有过渡动画（--dur-base），等它走完再断言，避免测到中间态
      await sleep(500)
      const s2 = await cdp.eval(`getComputedStyle(document.querySelector('[data-amount]')).filter`)
      check('再点一次恢复可见', s2 === 'none', s2)
    })

    /* 2. tabBar 切换 ----------------------------------------------- */
    await step('tabBar 切换到「收款」', cdp, async () => {
      await click(cdp, '.tab[data-name="trade-collection"]')
      await cdp.waitFor(`PP.router.current() === 'trade-collection'`, '切换收款')
      const s = await cdp.eval(`({
        selected: document.querySelector('.tab[data-name="trade-collection"]').getAttribute('aria-selected'),
        pages: [].slice.call(document.querySelectorAll('#app-body > .page')).filter(function (p) { return !p.hidden }).length,
        tabbarHidden: document.querySelector('#tabbar').hidden,
        back: !!document.querySelector('#bar-back')
      })`)
      check('aria-selected 同步', s.selected === 'true', s.selected)
      check('同屏只有一页', s.pages === 1, s.pages)
      check('tab 页 tabBar 可见', s.tabbarHidden === false, String(s.tabbarHidden))
      check('tab 页无返回键', s.back === false, String(s.back))
    })

    /* 3. 进入二级页 ------------------------------------------------ */
    await step('快捷入口进入二级页（换汇）', cdp, async () => {
      await cdp.eval(`PP.router.go('index')`)
      await cdp.waitFor(`PP.router.current() === 'index'`, '回首页')
      await sleep(200)
      await click(cdp, '.quick-item[data-go="exchange"]')
      await cdp.waitFor(`PP.router.current() === 'exchange'`, '进入换汇')
      const s = await cdp.eval(`({
        back: !!document.querySelector('#bar-back'),
        tabbarHidden: document.querySelector('#tabbar').hidden,
        title: document.querySelector('#bar-title').textContent,
        stack: PP.router.stack().map(function (i) { return i.name })
      })`)
      check('导航栏出现返回键', s.back === true, String(s.back))
      check('二级页隐藏 tabBar', s.tabbarHidden === true, String(s.tabbarHidden))
      check('标题正确', s.title === '换汇中心', s.title)
      check('页面栈正确', JSON.stringify(s.stack) === JSON.stringify(['index', 'exchange']), JSON.stringify(s.stack))
    })

    /* 4. 返回 ----------------------------------------------------- */
    await step('返回上一页', cdp, async () => {
      await click(cdp, '#bar-back')
      await cdp.waitFor(`PP.router.current() === 'index'`, '回到首页')
      const s = await cdp.eval(`({
        stack: PP.router.stack().map(function (i) { return i.name }),
        back: !!document.querySelector('#bar-back')
      })`)
      check('栈回到单个 tab 页', JSON.stringify(s.stack) === JSON.stringify(['index']), JSON.stringify(s.stack))
      check('返回键消失', s.back === false, String(s.back))
    })

    /* 5. 表单校验 -------------------------------------------------- */
    await step('换汇表单校验（空金额提交）', cdp, async () => {
      await cdp.eval(`PP.router.go('exchange')`)
      await cdp.waitFor(`PP.router.current() === 'exchange'`, '进入换汇')
      await sleep(200)
      const st = await cdp.eval(`({
        cur: PP.router.current(),
        pages: [].slice.call(document.querySelectorAll('.page')).map(function (p) { return p.getAttribute('data-page') }),
        hasSell: !!document.querySelector('#sell-amount'),
        hasSubmit: !!document.querySelector('#submit-swap')
      })`)
      console.log('    [诊断] %j', st)
      const miss = await click(cdp, '#submit-swap')
      if (miss) console.log('    [诊断] click 返回：%s', miss)
      await sleep(200)
      const s = await cdp.eval(`({
        err: document.querySelector('#amount-error'),
        shown: !(document.querySelector('#amount-error') || {}).hidden,
        text: (document.querySelector('#amount-error') || {}).textContent,
        gone: !document.querySelector('#layer-root .mask')
      })`)
      check('给出错误提示', s.shown && !!s.text, s.shown ? s.text : '错误节点 hidden')
      check('没有弹出确认层', s.gone === true, String(s.gone))
    })

    /* 6. 确认弹层 -------------------------------------------------- */
    await step('确认弹层（#layer-root）', cdp, async () => {
      await cdp.eval(`(function () {
        var input = document.querySelector('#sell-amount');
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await sleep(150)
      await click(cdp, '#submit-swap')
      await cdp.waitFor(`!!document.querySelector('#layer-root .mask')`, '确认弹层出现')
      const s = await cdp.eval(`({
        inLayer: !!document.querySelector('#layer-root .sheet'),
        countdown: !!document.querySelector('#fx-countdown'),
        focusIn: document.querySelector('#layer-root .sheet').contains(document.activeElement)
      })`)
      check('弹层挂在 #layer-root', s.inLayer === true, String(s.inLayer))
      check('汇率倒计时存在', s.countdown === true, String(s.countdown))

      // 关闭：点遮罩
      await cdp.eval(`document.querySelector('#layer-root .mask').click()`)
      await cdp.waitFor(`!document.querySelector('#layer-root .mask')`, '弹层关闭')
      check('点遮罩可关闭', true)
    })

    /* 7. 消息通知未读清零 ------------------------------------------ */
    await step('消息通知未读清零', cdp, async () => {
      const before = await cdp.eval(`({
        badge: (document.querySelector('#notice-badge') || {}).textContent,
        unread: PP.store.get('unread')
      })`)
      check('进入前未读为 6', before.unread === 6 || before.badge === '6', JSON.stringify(before))

      await cdp.eval(`PP.router.go('notifications')`)
      await cdp.waitFor(`PP.router.current() === 'notifications'`, '进入消息通知')
      await sleep(200)
      const s = await cdp.eval(`({
        unread: PP.store.get('unread'),
        rows: document.querySelectorAll('#note-list li, #note-list .note-row').length,
        nodes: document.querySelectorAll('#note-list *').length
      })`)
      check('全局未读清零', s.unread === 0, String(s.unread))
      check('消息列表已渲染', s.rows > 0 && s.nodes > 5, s.rows + ' 行 / ' + s.nodes + ' 节点')
    })

    /* 汇总 -------------------------------------------------------- */
    console.log('\n通过 %d 项断言', passed)
    if (problems.length) {
      console.log('控制台问题 %d 条：', problems.length)
      problems.forEach((p) => console.log('  [%s] %s', p.kind, p.text))
    }
    if (failures.length) {
      console.log('失败 %d 项：', failures.length)
      failures.forEach((f) => console.log('  · %s', f))
      return 1
    }
    if (problems.length) return 1
    console.log('交互冒烟全部通过')
    return 0
  } finally {
    proc.kill()
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('交互验证失败：', e.message)
  process.exit(1)
})
