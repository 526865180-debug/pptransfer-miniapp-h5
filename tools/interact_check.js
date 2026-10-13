#!/usr/bin/env node
/**
 * interact_check.js · 交互冒烟测试（零依赖）
 *
 * render_check.js 只证明「每页能渲染」，证明不了「点了有反应」。
 * 这里用真实点击驱动一条最常用的用户路径，逐项断言：
 *
 *   1. 金额脱敏开关     —— body[data-amount-hidden] 与 aria-pressed 联动，图标换 eye/eye-off
 *   2. tabBar 切换      —— 三栏 tabBar，点击「收款」进入 trade-collection，aria-selected 正确
 *   2.5 收款页双视图    —— 页内分段切换「收款记录 / 在途资金」，在途筛选与详情弹层，
 *                          首页「详情 ›」带 data-view 直达在途视图
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

    /* 2.5 收款页双视图：在途资金已并入本页 ------------------------- */
    await step('收款页内切换「在途资金」视图', cdp, async () => {
      // tabBar 收敛为三栏（在途资金不再是独立一级页）
      const tabs = await cdp.eval(
        `[].slice.call(document.querySelectorAll('#tabbar .tab')).map(function (t) { return t.getAttribute('data-name') })`)
      check('tabBar 收敛为三栏',
        tabs.length === 3 && tabs.join(',') === 'index,trade-collection,rights-center', JSON.stringify(tabs))

      // 分段切换到在途视图
      await click(cdp, '#tc-viewseg [data-view="fund"]')
      await sleep(200)
      let s = await cdp.eval(`({
        fundVisible: !document.querySelector('#tc-pane-fund').hidden,
        collHidden: document.querySelector('#tc-pane-collection').hidden,
        total: document.querySelector('#fund-total').textContent,
        all: document.querySelector('#fund-all-count').textContent,
        transit: document.querySelector('#fund-transit-count').textContent,
        rows: document.querySelectorAll('#fund-list .fund').length
      })`)
      check('切到在途视图且收款视图隐藏', s.fundVisible && s.collHidden, JSON.stringify(s))
      check('在途合计与笔数按全量统计',
        /23,128\.37/.test(s.total) && s.all === '6 笔' && s.transit === '2 笔', JSON.stringify(s))
      check('在途列表渲染 6 条', s.rows === 6, String(s.rows))

      // 状态页签筛选：只影响列表，不影响 Hero 汇总
      await click(cdp, '#fund-status [data-fstatus="transit"]')
      await sleep(150)
      s = await cdp.eval(`({
        rows: document.querySelectorAll('#fund-list .fund').length,
        count: document.querySelector('#fund-count').textContent,
        hero: document.querySelector('#fund-all-count').textContent
      })`)
      check('在途筛选「在途中」→ 2 条且 Hero 不变',
        s.rows === 2 && /2 条/.test(s.count) && s.hero === '6 笔', JSON.stringify(s))

      // 条目详情弹层
      await click(cdp, '#fund-list .fund')
      await sleep(250)
      s = await cdp.eval(`({
        title: (document.querySelector('#layer-root .sheet-title') || {}).textContent || '',
        body: (document.querySelector('#layer-root .sheet') || {}).textContent || ''
      })`)
      check('在途详情弹层打开',
        s.title === '在途资金详情' && /TRADE CORP LTD200AC/.test(s.body), JSON.stringify(s))

      await click(cdp, '#layer-root .sheet-close')
      await sleep(200)

      // 切回收款视图
      await click(cdp, '#tc-viewseg [data-view="collection"]')
      await sleep(150)
      s = await cdp.eval(`({
        collVisible: !document.querySelector('#tc-pane-collection').hidden,
        fundHidden: document.querySelector('#tc-pane-fund').hidden,
        cards: document.querySelectorAll('#tc-list .coll-card').length
      })`)
      check('切回收款视图', s.collVisible && s.fundHidden && s.cards === 10, JSON.stringify(s))

      // 首页在途资金「详情 ›」带 data-view 直达在途视图
      await cdp.eval(`PP.router.go('index')`)
      await cdp.waitFor(`PP.router.current() === 'index'`, '回首页')
      await sleep(200)
      await click(cdp, '.intransit-tag')
      await cdp.waitFor(
        `PP.router.current() === 'trade-collection' && !document.querySelector('#tc-pane-fund').hidden`,
        '详情直达在途视图')
      check('首页「详情 ›」直达收款页在途视图', true)
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

    /* 8. 结汇提现表单 ---------------------------------------------- */
    await step('结汇提现表单（双向计算与账户搜索）', cdp, async () => {
      await cdp.eval(`PP.router.go('rmb-exchange-withdraw')`)
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-withdraw'`, '进入结汇提现')
      await sleep(200)

      const setVal = async (sel, v) => {
        await cdp.eval(`(function () {
          var el = document.querySelector(${JSON.stringify(sel)});
          el.value = ${JSON.stringify(v)};
          el.dispatchEvent(new Event('input', { bubbles: true }))
        })()`)
      }

      await setVal('#amount-input', '100')
      await sleep(120)
      let s = await cdp.eval(`({
        arrival: document.querySelector('#arrival-input').value,
        fee: document.querySelector('#fee-value').textContent
      })`)
      check('提现 100 → 到账 99.9、手续费 0.10 CNH',
        parseFloat(s.arrival) === 99.9 && s.fee === '0.10 CNH', JSON.stringify(s))

      await setVal('#arrival-input', '500')
      await sleep(120)
      s = await cdp.eval(`document.querySelector('#amount-input').value`)
      check('到账 500 → 反算提现 500.5', parseFloat(s) === 500.5, s)

      await click(cdp, '#fill-all')
      await sleep(120)
      s = await cdp.eval(`({
        amount: document.querySelector('#amount-input').value,
        arrival: document.querySelector('#arrival-input').value
      })`)
      check('全部提现 → 997 / 996', parseFloat(s.amount) === 997 && parseFloat(s.arrival) === 996, JSON.stringify(s))

      // 未选账户时点下一步应给出原因而不是进确认页
      await click(cdp, '#next-btn')
      await sleep(150)
      s = await cdp.eval(`document.querySelector('#toast-layer').textContent`)
      check('未选账户 → toast 提示原因', /账户/.test(s), s)

      // 账户搜索弹层（PP.ui.searchPicker）
      await click(cdp, '#account-btn')
      await cdp.waitFor(`!!document.querySelector('#layer-root .picker-list')`, '账户弹层出现')
      s = await cdp.eval(`document.querySelectorAll('#layer-root .picker-item').length`)
      check('弹层列出全部账户', s === 6, s)
      await setVal('#picker-search', '工商')
      await sleep(120)
      s = await cdp.eval(`document.querySelectorAll('#layer-root .picker-item').length`)
      check('搜索「工商」过滤为 1 条', s === 1, s)
      await click(cdp, '.picker-item', 'document.querySelector("#layer-root .sheet")')
      await sleep(200)
      s = await cdp.eval(`({
        value: document.querySelector('#account-value').textContent,
        open: !!document.querySelector('#layer-root .mask')
      })`)
      check('选中后回填并关闭弹层', /工商银行/.test(s.value) && !s.open, JSON.stringify(s))

      await click(cdp, '#next-btn')
      await sleep(200)
      s = await cdp.eval(`({
        step: document.querySelector('.page[data-page="rmb-exchange-withdraw"] .wizard-step:not([hidden])').getAttribute('data-step'),
        amount: document.querySelector('#confirm-amount').textContent,
        account: document.querySelector('#confirm-account').textContent
      })`)
      check('进入确认步骤且金额/账户已同步',
        s.step === '1' && /997/.test(s.amount) && /工商/.test(s.account), JSON.stringify(s))
    })

    /* 9. 添加人民币结汇账户 ---------------------------------------- */
    await step('添加人民币结汇账户（三步向导）', cdp, async () => {
      // 从结汇提现页的「添加结汇提现账户」入口进入
      await cdp.eval(`PP.router.go('rmb-exchange-withdraw')`)
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-withdraw'`, '回到结汇提现')
      await sleep(200)
      await click(cdp, '.link-btn[data-go="add-rmb-exchange-account"]')
      await cdp.waitFor(`PP.router.current() === 'add-rmb-exchange-account'`, '进入添加账户页')
      const head = await cdp.eval(`document.querySelector('#bar-title').textContent`)
      check('入口跳转与标题正确', head === '添加人民币结汇账户', head)

      const setVal = async (sel, v) => {
        await cdp.eval(`(function () {
          var el = document.querySelector(${JSON.stringify(sel)});
          el.value = ${JSON.stringify(v)};
          el.dispatchEvent(new Event('input', { bubbles: true }))
        })()`)
      }
      /* 可见字段行：拿每个 .frow 的标签文本，用于断言条件显隐 */
      const visibleFields = () => cdp.eval(`[].slice.call(document.querySelectorAll('.page[data-page="add-rmb-exchange-account"] .frow'))
        .filter(function (f) { return !f.hidden })
        .map(function (f) { var l = f.querySelector('.frow-label'); return l ? l.textContent.replace(/[*\\s]|选填/g, '') : '' })`)
      const pickerItemClick = () => click(cdp, '.picker-item', 'document.querySelector("#layer-root .sheet")')

      // 本公司 + 企业（默认）：基础字段 + 开户行支行号
      let s = await visibleFields()
      check('本公司+企业 → 基础字段 + 开户行支行号（8 行）',
        s.length === 8 && s.indexOf('开户行支行号：') >= 0 && s.indexOf('公司名称') < 0 &&
        s.indexOf('收款人身份证号：') < 0, JSON.stringify(s))
      s = await cdp.eval(`(function () {
        var auto = document.querySelector('#add-bank-auto')
        var btn = document.querySelector('#add-bank-btn')
        return { autoHidden: auto.hidden, pickerShown: !btn.hidden }
      })()`)
      check('企业账户 → 银行名称走搜索选择器（自动返显框隐藏）',
        s.autoHidden && s.pickerShown, JSON.stringify(s))

      // 未选银行时点支行号 → toast 引导 + 银行行标红
      await click(cdp, '#add-branch-btn')
      await sleep(200)
      s = await cdp.eval(`({
        toast: document.querySelector('#toast-layer').textContent,
        errRow: !!document.querySelector('.page[data-page="add-rmb-exchange-account"] .frow.is-error #add-bank-btn')
      })`)
      check('未选银行点支行号 → toast 引导并标红银行行',
        /先选择银行/.test(s.toast) && s.errRow, JSON.stringify(s))

      // 本公司 + 个人：支行号与扩展字段全部隐藏
      await click(cdp, '.radio-pill[data-type="personal"]')
      await sleep(150)
      s = await visibleFields()
      check('本公司+个人 → 支行号与扩展字段全部隐藏（7 行）',
        s.length === 7 && ['公司名称', '统一信用代码', '开户行支行号：', '收款人身份证号：', '历史采购合同：']
          .every(function (x) { return s.indexOf(x) < 0 }), JSON.stringify(s))
      s = await cdp.eval(`document.querySelector('.page[data-page="add-rmb-exchange-account"] .hint-warn').hidden`)
      check('本公司+个人 → I 类卡提示仍显示', s === false, String(s))

      // 个人账户的银行名称：不是选择器，而是按银行账号自动返显的只读框
      s = await cdp.eval(`(function () {
        var auto = document.querySelector('#add-bank-auto')
        var btn = document.querySelector('#add-bank-btn')
        return { shown: !auto.hidden, readonly: auto.readOnly, value: auto.value, pickerHidden: btn.hidden }
      })()`)
      check('个人账户 → 银行名称为只读自动返显框',
        s.shown && s.readonly && s.value === '' && s.pickerHidden, JSON.stringify(s))

      // 输入银行账号 → 按卡 BIN 自动带出银行
      await setVal('#add-acct-no', '6225881234567890')
      await sleep(150)
      s = await cdp.eval(`document.querySelector('#add-bank-auto').value`)
      check('输入 6225 开头账号 → 自动返显招商银行', s === '招商银行', s)

      // 识别不出的账号 → 返显留空，校验按「无法识别开户银行」拦下
      await setVal('#add-acct-no', '1111111111111111')
      await setVal('#add-acct-name', '罗炬')
      await sleep(150)
      s = await cdp.eval(`document.querySelector('#add-bank-auto').value`)
      check('无法识别的账号 → 银行名称留空', s === '', JSON.stringify(s))
      await click(cdp, '#add-next-btn')
      await sleep(200)
      s = await cdp.eval(`({
        toast: document.querySelector('#toast-layer').textContent,
        step: document.querySelector('.page[data-page="add-rmb-exchange-account"] .wizard-step:not([hidden])').getAttribute('data-step')
      })`)
      check('无法识别开户银行 → 拦在步骤 1',
        /无法识别开户银行/.test(s.toast) && s.step === '0', JSON.stringify(s))
      await setVal('#add-acct-no', '')

      // 账号清空 → 校验提示
      await click(cdp, '#add-next-btn')
      await sleep(150)
      s = await cdp.eval(`document.querySelector('#toast-layer').textContent`)
      check('账号为空 → 提示填写银行账号', /请填写银行账号/.test(s), s)

      // 供应商 + 个人：供应商侧扩展材料显示，支行号随「个人账户」隐藏
      await click(cdp, '.radio-pill[data-owner="supplier"]')
      await sleep(150)
      s = await visibleFields()
      check('供应商+个人 → 4 项扩展材料显示、支行号隐藏（11 行）',
        s.length === 11 && ['公司名称', '统一信用代码', '收款人身份证号：', '历史采购合同：']
          .every(function (x) { return s.indexOf(x) >= 0 }) && s.indexOf('开户行支行号：') < 0,
        JSON.stringify(s))

      // 供应商 + 企业：支行号 + 法人信息出现（与所属无关），供应商侧个人材料收起
      await click(cdp, '.radio-pill[data-type="enterprise"]')
      await sleep(150)
      s = await visibleFields()
      check('供应商+企业 → 支行号 + 法人信息（10 行）',
        s.length === 10 && ['开户行支行号：', '法人名称', '法人身份证号'].every(function (x) { return s.indexOf(x) >= 0 }) &&
        s.indexOf('公司名称') < 0 && s.indexOf('历史采购合同：') < 0, JSON.stringify(s))

      // 法人名称 / 法人身份证号：初始都是选填
      const legalMarks = () => cdp.eval(`['#add-legal-name', '#add-legal-id'].map(function (sel) {
        var label = document.querySelector(sel).closest('.frow').querySelector('.frow-label')
        return {
          req: !label.querySelector('.frow-req').hidden,
          optional: !label.querySelector('.frow-optional').hidden
        }
      })`)
      s = await legalMarks()
      check('法人两字段初始均为选填',
        s.every(function (m) { return m.optional && !m.req }), JSON.stringify(s))

      // 填了法人名称 → 法人身份证号立刻变必填
      await setVal('#add-legal-name', '张伟')
      await sleep(150)
      s = await legalMarks()
      check('填了法人名称 → 法人身份证号变必填',
        s[0].optional && !s[0].req && s[1].req && !s[1].optional, JSON.stringify(s))

      // 开户地区：系统固定「中国内地」，只读不可修改
      s = await cdp.eval(`(function () {
        var el = document.querySelector('#add-region-value')
        return {
          text: el.textContent,
          tag: el.tagName,
          readonly: el.classList.contains('field-static'),
          picker: !!document.querySelector('#add-region-btn')
        }
      })()`)
      check('开户地区固定中国内地且无选择器',
        s.text === '中国内地' && s.tag === 'SPAN' && s.readonly && !s.picker, JSON.stringify(s))

      // 银行名称 searchPicker
      await click(cdp, '#add-bank-btn')
      await cdp.waitFor(`!!document.querySelector('#layer-root .picker-list')`, '银行弹层出现')
      await setVal('#picker-search', '招商')
      await sleep(120)
      s = await cdp.eval(`document.querySelectorAll('#layer-root .picker-item').length`)
      check('银行搜索「招商」→ 1 条', s === 1, s)
      await pickerItemClick()
      await sleep(200)
      s = await cdp.eval(`document.querySelector('#add-bank-value').textContent`)
      check('银行选中回填', s === '招商银行', s)

      // 支行号 searchPicker（依所选银行动态生成）
      await click(cdp, '#add-branch-btn')
      await cdp.waitFor(`!!document.querySelector('#layer-root .picker-list')`, '支行弹层出现')
      s = await cdp.eval(`document.querySelectorAll('#layer-root .picker-item').length`)
      check('招商银行支行列表 3 条', s === 3, s)
      s = await cdp.eval(`[].slice.call(document.querySelectorAll('#layer-root .picker-item .picker-title')).some(function (t) { return /前海/.test(t.textContent) })`)
      check('支行列表含「前海支行」', s === true, String(s))
      await pickerItemClick()
      await sleep(200)
      s = await cdp.eval(`document.querySelector('#add-branch-value').textContent`)
      check('支行选中回填', /前海/.test(s), s)

      // 基础项填齐：法人名称已填 → 法人身份证号变必填，被拦在步骤 1
      await setVal('#add-acct-name', '罗炬')
      await setVal('#add-acct-no', '6222020200123456789')
      await click(cdp, '#add-next-btn')
      await sleep(200)
      s = await cdp.eval(`({
        toast: document.querySelector('#toast-layer').textContent,
        step: document.querySelector('.page[data-page="add-rmb-exchange-account"] .wizard-step:not([hidden])').getAttribute('data-step')
      })`)
      check('填了法人名称 → 缺法人身份证号被拦在步骤 1',
        /法人身份证号/.test(s.toast) && s.step === '0', JSON.stringify(s))

      // 清空法人名称 → 两字段都空即都选填，放行进授权步骤
      await setVal('#add-legal-name', '')
      await sleep(150)
      s = await legalMarks()
      check('清空法人名称 → 两字段回到选填',
        s.every(function (m) { return m.optional && !m.req }), JSON.stringify(s))
      await click(cdp, '#add-next-btn')
      await sleep(200)
      s = await cdp.eval(`document.querySelector('.page[data-page="add-rmb-exchange-account"] .wizard-step:not([hidden])').getAttribute('data-step')`)
      check('法人信息全空 → 放行进授权步骤', s === '1', s)
      await click(cdp, '#add-prev-btn')
      await sleep(200)

      // 切回供应商 + 个人：支行号收起；企业手选的银行换成按账号返显
      await click(cdp, '.radio-pill[data-type="personal"]')
      await sleep(150)
      s = await visibleFields()
      check('切回个人账户 → 支行号收起', s.indexOf('开户行支行号：') < 0, JSON.stringify(s))
      s = await cdp.eval(`({
        auto: document.querySelector('#add-bank-auto').value,
        pickerHidden: document.querySelector('#add-bank-btn').hidden
      })`)
      check('切类型后银行改按账号返显（不沿用企业手选的招商银行）',
        s.auto === '工商银行' && s.pickerHidden, JSON.stringify(s))

      // 个人账户：公司名称/信用代码是选填，剩下收款人身份证号把关
      await click(cdp, '#add-next-btn')
      await sleep(200)
      s = await cdp.eval(`({
        toast: document.querySelector('#toast-layer').textContent,
        optional: ['#add-company-name', '#add-credit-code'].map(function (sel) {
          var row = document.querySelector(sel).closest('.frow')
          return !!row.querySelector('.frow-optional')
        })
      })`)
      check('公司名称/信用代码选填 → 拦在收款人身份证号',
        /身份证号/.test(s.toast) && s.optional.every(Boolean), JSON.stringify(s))

      // 只补必填的身份证号：选填项留空也应能进入授权步骤（银行账号失焦后按 4 位分组展示）
      await setVal('#add-id-card', '440301199001011234')
      await click(cdp, '#add-next-btn')
      await sleep(200)
      s = await cdp.eval(`({
        step: document.querySelector('.page[data-page="add-rmb-exchange-account"] .wizard-step:not([hidden])').getAttribute('data-step'),
        bank: document.querySelector('#add-auth-bank').textContent,
        name: document.querySelector('#add-auth-name').textContent,
        no: document.querySelector('#add-auth-no').textContent,
        confirmDisabled: document.querySelector('#add-confirm-btn').getAttribute('aria-disabled')
      })`)
      check('进入授权步骤且账户信息回填',
        s.step === '1' && s.bank === '工商银行' && s.name === '罗炬' && s.no === '6222 0202 0012 3456 789',
        JSON.stringify(s))
      check('未填密码/未勾选时提交置灰', s.confirmDisabled === 'true', s.confirmDisabled)

      // 交易密码 + 同意授权 → 提交成功
      await setVal('#add-trade-pwd', '123456')
      await cdp.eval(`(function () {
        var cb = document.querySelector('#add-agree');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await sleep(120)
      await click(cdp, '#add-confirm-btn')
      await sleep(200)
      s = await cdp.eval(`({
        step: document.querySelector('.page[data-page="add-rmb-exchange-account"] .wizard-step:not([hidden])').getAttribute('data-step'),
        no: document.querySelector('#add-result-no').textContent,
        region: document.querySelector('#add-result-region').textContent
      })`)
      check('提交进入成功页且账号脱敏展示',
        s.step === '2' && s.no.indexOf('****') >= 0 && s.region === '中国内地', JSON.stringify(s))

      // 返回结汇提现
      await click(cdp, '.page[data-page="add-rmb-exchange-account"] [data-back]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-withdraw'`, '返回结汇提现')
      check('返回结汇提现', true)
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
