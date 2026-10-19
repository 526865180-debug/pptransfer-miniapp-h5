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
 *   2.6 列表分页        —— 两个列表各每页 5 条：翻页换数据、首末页禁用、
 *                          筛选与切页签回第 1 页、只剩一页时分页收起
 *   3. 进入二级页       —— 快捷入口「换汇」→ exchange，导航栏出现返回键
 *   4. 返回             —— 点返回键回到原 tab，滚动容器只有一页可见
 *   5. 表单校验         —— exchange 直接提交应给出错误提示而不是静默失败
 *   5.5 换汇记录页      —— 换汇中心「查看全部」进入换汇记录：KPI 全量统计、
 *                          每页 5 条分页、状态筛选、详情弹层、筛选弹层（币种 picker）、导出
 *   6. 确认弹层         —— 填入合法金额提交，#layer-root 里出现确认弹层，可取消关闭
 *   7. 消息通知清零     —— 进入 notifications 后全局未读角标清零，列表仍在
 *   8. 结汇提现 / 添加结汇账户 —— 双向金额计算、账户搜索弹层、三步向导、
 *                          条件字段矩阵（所属 × 类型）
 *   9. 结汇模块顶部 tab —— 首页 / 结汇提现 / 结汇账户 共用一条 tab：
 *                          进子页是入栈（返回有落点）、平级互跳是替换（不堆栈）、
 *                          点当前页自己的 tab 无副作用、返回落回结汇首页
 *  10. 结汇账户列表     —— 状态统计、搜索、筛选弹层、分页、
 *                          修改别名 / 修改资料 / 删除、添加账户入口
 *  11. 系统管理页       —— tabBar 第 4 栏：三组设置卡、开关翻转、
 *                          修改手机号 / 登录密码弹层的校验与成功回写、
 *                          状态在切走再切回后保持
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
      // tabBar 四栏：首页 / 收款 / 权益中心 / 系统管理（在途资金并入收款页）
      const tabs = await cdp.eval(
        `[].slice.call(document.querySelectorAll('#tabbar .tab')).map(function (t) { return t.getAttribute('data-name') })`)
      check('tabBar 四栏',
        tabs.length === 4 && tabs.join(',') === 'index,trade-collection,rights-center,system-settings',
        JSON.stringify(tabs))

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
      check('在途列表第 1 页 5 条（共 6 条）', s.rows === 5, String(s.rows))

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
      check('切回收款视图且第 1 页 5 条', s.collVisible && s.fundHidden && s.cards === 5, JSON.stringify(s))

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

    /* 2.6 两个列表的分页 ------------------------------------------- */
    await step('收款记录与在途资金分页', cdp, async () => {
      // 上一段停在在途视图且状态是「在途中」，先回「全部」（6 条 / 每页 5 条 = 2 页）
      await click(cdp, '#fund-status [data-fstatus="all"]')
      await sleep(200)
      let s = await cdp.eval(`({
        rows: document.querySelectorAll('#fund-list .fund').length,
        current: (document.querySelector('#fund-pager [aria-current="page"]') || {}).textContent || '',
        btns: document.querySelectorAll('#fund-pager .pager-btn').length,
        prevDisabled: document.querySelector('#fund-pager [data-pg="prev"]').disabled,
        info: (document.querySelector('#fund-pager .pager-info') || {}).textContent || ''
      })`)
      check('在途第 1 页 5 条、页码 2 个、上一页禁用',
        s.rows === 5 && s.current === '1' && s.btns === 4 && s.prevDisabled === true &&
        /第 1–5 条 \/ 共 6 条/.test(s.info), JSON.stringify(s))

      // 翻到第 2 页：只剩 1 条，下一页禁用
      const firstFundPayer = await cdp.eval(
        `(document.querySelector('#fund-list .fund-payer') || {}).textContent || ''`)
      await click(cdp, '#fund-pager [data-pg="next"]')
      await sleep(200)
      s = await cdp.eval(`({
        rows: document.querySelectorAll('#fund-list .fund').length,
        payer: (document.querySelector('#fund-list .fund-payer') || {}).textContent || '',
        current: (document.querySelector('#fund-pager [aria-current="page"]') || {}).textContent || '',
        nextDisabled: document.querySelector('#fund-pager [data-pg="next"]').disabled,
        info: (document.querySelector('#fund-pager .pager-info') || {}).textContent || ''
      })`)
      check('在途翻到第 2 页只剩 1 条、下一页禁用',
        s.rows === 1 && s.current === '2' && s.nextDisabled === true && /第 6–6 条/.test(s.info),
        JSON.stringify(s))
      check('在途第 2 页换了一批数据', s.payer !== firstFundPayer, s.payer)

      // 换状态页签 → 页码回到第 1 页；结果只剩一页时分页收起
      await click(cdp, '#fund-status [data-fstatus="arrived"]')
      await sleep(200)
      s = await cdp.eval(`({
        rows: document.querySelectorAll('#fund-list .fund').length,
        hidden: document.querySelector('#fund-pager').hidden
      })`)
      check('在途换页签回到第 1 页、单页时分页隐藏',
        s.rows === 3 && s.hidden === true, JSON.stringify(s))

      // 收款侧：切回视图，10 条 / 每页 5 条 = 2 页
      await click(cdp, '#tc-viewseg [data-view="collection"]')
      await sleep(200)
      const firstNo = await cdp.eval(
        `(document.querySelector('#tc-list .cc-no') || {}).textContent || ''`)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#tc-list .coll-card').length,
        count: document.querySelector('#tc-count').textContent,
        current: (document.querySelector('#tc-pager [aria-current="page"]') || {}).textContent || '',
        prevDisabled: document.querySelector('#tc-pager [data-pg="prev"]').disabled,
        info: (document.querySelector('#tc-pager .pager-info') || {}).textContent || ''
      })`)
      check('收款第 1 页 5 条、计数仍是总数 10',
        s.cards === 5 && /共 10 条收款记录/.test(s.count) && s.current === '1' &&
        s.prevDisabled === true && /第 1–5 条 \/ 共 10 条/.test(s.info), JSON.stringify(s))

      await click(cdp, '#tc-pager [data-pg="2"]')
      await sleep(200)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#tc-list .coll-card').length,
        no: (document.querySelector('#tc-list .cc-no') || {}).textContent || '',
        current: (document.querySelector('#tc-pager [aria-current="page"]') || {}).textContent || '',
        nextDisabled: document.querySelector('#tc-pager [data-pg="next"]').disabled,
        info: (document.querySelector('#tc-pager .pager-info') || {}).textContent || ''
      })`)
      check('收款翻到第 2 页 5 条、下一页禁用',
        s.cards === 5 && s.current === '2' && s.nextDisabled === true &&
        /第 6–10 条/.test(s.info), JSON.stringify(s))
      check('收款第 2 页换了一批数据', s.no !== firstNo, s.no)

      // 状态筛选 → 页码回第 1 页；「已驳回」3 条只剩一页，分页收起
      await click(cdp, '#tc-pane-collection [data-status="已驳回"]')
      await sleep(200)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#tc-list .coll-card').length,
        hidden: document.querySelector('#tc-pager').hidden
      })`)
      check('收款筛选后回到第 1 页、单页时分页隐藏',
        s.cards === 3 && s.hidden === true, JSON.stringify(s))

      // 复原筛选，避免影响后续步骤
      await click(cdp, '#tc-pane-collection [data-status=""]')
      await sleep(150)
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

      // 换汇历史「查看全部」→ 换汇记录页（对齐 desktop 版 pages/exchange_records.html）
      await click(cdp, '.page[data-page="exchange"] [data-go="exchange-records"]')
      await cdp.waitFor(`PP.router.current() === 'exchange-records'`, '进入换汇记录')
      const s2 = await cdp.eval(`({
        title: document.querySelector('#bar-title').textContent,
        stack: PP.router.stack().map(function (i) { return i.name })
      })`)
      check('「查看全部」进入换汇记录页',
        s2.title === '换汇记录' &&
        JSON.stringify(s2.stack) === JSON.stringify(['index', 'exchange', 'exchange-records']),
        JSON.stringify(s2))

      // 回到换汇中心，保持「返回上一页」步骤的页面栈不变
      await click(cdp, '#bar-back')
      await cdp.waitFor(`PP.router.current() === 'exchange'`, '返回换汇中心')
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
        gone: !document.querySelector('#layer-root .mask'),
        swapDisabled: document.querySelector('#submit-swap').getAttribute('aria-disabled'),
        swapBg: getComputedStyle(document.querySelector('#submit-swap')).backgroundColor
      })`)
      check('给出错误提示', s.shown && !!s.text, s.shown ? s.text : '错误节点 hidden')
      check('没有弹出确认层', s.gone === true, String(s.gone))
      // 未填金额时按钮仍是品牌蓝 rgb(10, 108, 255)，而不是全局禁用态的中性灰
      check('未填金额时按钮保持品牌蓝',
        s.swapDisabled === 'true' && s.swapBg === 'rgb(10, 108, 255)', s.swapBg)
    })

    /* 5.5 换汇记录页 ------------------------------------------------ */
    await step('换汇记录页（KPI / 分页 / 状态筛选 / 详情 / 筛选 / 导出）', cdp, async () => {
      await cdp.eval(`PP.router.go('exchange-records')`)
      await cdp.waitFor(`PP.router.current() === 'exchange-records'`, '进入换汇记录')
      await sleep(200)

      // KPI 按全量统计，与桌面版硬编码值一致（7 笔 / 3 笔 / 46,197.88 / 2,519.96）
      let s = await cdp.eval(`({
        done: document.querySelector('#exr-kpi-done').textContent,
        pending: document.querySelector('#exr-kpi-pending').textContent,
        inAmt: document.querySelector('#exr-kpi-in').textContent,
        inSub: document.querySelector('#exr-kpi-in-sub').textContent
      })`)
      check('KPI 换汇成功 7 笔', s.done === '7', JSON.stringify(s))
      check('KPI 申请中 3 笔', s.pending === '3', JSON.stringify(s))
      check('成功换入金额 46,197.88', s.inAmt.indexOf('46,197.88') >= 0, JSON.stringify(s))
      check('KPI 副标题笔数一致', /7 笔/.test(s.inSub), JSON.stringify(s))

      // 第 1 页渲染 5 条，分页可见
      s = await cdp.eval(`({
        all: document.querySelector('[data-count="all"]').textContent,
        items: document.querySelectorAll('#exr-list .exr-item').length,
        count: document.querySelector('#exr-count').textContent,
        pagerHidden: document.querySelector('#exr-pager').hidden,
        first: (document.querySelector('#exr-list .exr-no') || {}).textContent
      })`)
      check('状态统计全部 10 条', s.all === '10', JSON.stringify(s))
      check('第 1 页渲染 5 条、原始序号 #01',
        s.items === 5 && s.first === '#01', JSON.stringify(s))
      check('计数共 10 条', s.count === '共 10 条换汇记录', JSON.stringify(s))
      check('分页控件可见', s.pagerHidden === false, JSON.stringify(s))

      // 翻到第 2 页
      await click(cdp, '#exr-pager [data-pg="2"]')
      await sleep(200)
      s = await cdp.eval(`({
        items: document.querySelectorAll('#exr-list .exr-item').length,
        first: (document.querySelector('#exr-list .exr-no') || {}).textContent,
        info: (document.querySelector('#exr-pager .pager-info') || {}).textContent
      })`)
      check('第 2 页渲染 5 条（#06 起）', s.items === 5 && s.first === '#06', JSON.stringify(s))
      check('分页范围文案', /第 6–10 条 \/ 共 10 条/.test(s.info), JSON.stringify(s))

      // 状态筛选「换汇成功」→ 7 条，页码回第 1 页
      await click(cdp, '.page[data-page="exchange-records"] [data-status="success"]')
      await sleep(200)
      s = await cdp.eval(`({
        count: document.querySelector('#exr-count').textContent,
        first: (document.querySelector('#exr-list .exr-no') || {}).textContent
      })`)
      check('筛选换汇成功 → 共 7 条、页码回第 1 页',
        s.count === '共 7 条换汇记录' && s.first === '#01', JSON.stringify(s))

      // 详情弹层
      await click(cdp, '#exr-list .exr-main')
      await cdp.waitFor(`!!document.querySelector('#layer-root .sheet')`, '详情弹层出现')
      s = await cdp.eval(`({
        title: (document.querySelector('#layer-root .sheet-title') || {}).textContent,
        rows: document.querySelectorAll('#layer-root .detail-row').length,
        sn: (document.querySelector('#layer-root .detail-value') || {}).textContent
      })`)
      check('详情弹层 9 行字段', /换汇记录详情/.test(s.title) && s.rows === 9, JSON.stringify(s))
      check('详情展示交易流水号', s.sn === '1524048125382234112', JSON.stringify(s))
      await cdp.eval(`document.querySelector('#layer-root .mask').click()`)
      await cdp.waitFor(`!document.querySelector('#layer-root .mask')`, '详情弹层关闭')

      // 筛选弹层：卖出币种 GBP → 共 1 条
      await click(cdp, '#exr-filter')
      await cdp.waitFor(`!!document.querySelector('#layer-root .sheet')`, '筛选弹层出现')
      s = await cdp.eval(`({
        fields: document.querySelectorAll('#layer-root .sheet .field').length,
        dates: document.querySelectorAll('#layer-root .date-box[type="date"]').length
      })`)
      check('筛选弹层 4 个字段（含日期区间）', s.fields === 4 && s.dates === 2, JSON.stringify(s))

      await click(cdp, '#exr-f-sell')
      await cdp.waitFor(`!!document.querySelector('#layer-root .option-row')`, '币种选择弹层出现')
      s = await cdp.eval(`document.querySelectorAll('#layer-root .option-row').length`)
      check('卖出币种选项 = 全部 + 数据内币种', s === 3, s)
      await click(cdp, '.option-row[data-value="GBP"]')
      await sleep(200)
      s = await cdp.eval(`document.querySelector('#exr-f-sell-v').textContent`)
      check('卖出币种回填 GBP', s === 'GBP', s)

      await click(cdp, '[data-apply]')
      await sleep(250)
      s = await cdp.eval(`document.querySelector('#exr-count').textContent`)
      check('卖出 GBP → 共 1 条', s === '共 1 条换汇记录', s)

      // 重置只清筛选弹层字段，状态标签（换汇成功）仍生效 → 共 7 条；筛选角标隐藏
      await click(cdp, '#exr-filter')
      await cdp.waitFor(`!!document.querySelector('#layer-root [data-reset]')`, '筛选弹层再次出现')
      await click(cdp, '[data-reset]')
      await click(cdp, '[data-apply]')
      await sleep(250)
      s = await cdp.eval(`({
        count: document.querySelector('#exr-count').textContent,
        badgeHidden: document.querySelector('#exr-filter-badge').hidden
      })`)
      check('重置筛选后回到状态标签口径（7 条）、角标隐藏',
        s.count === '共 7 条换汇记录' && s.badgeHidden === true, JSON.stringify(s))

      // 导出列表（headless 下剪贴板可能被拒，成功/失败 toast 都算反馈到达）
      await click(cdp, '#exr-export')
      await sleep(200)
      s = await cdp.eval(`document.querySelector('#toast-layer').textContent`)
      check('导出列表 → 出现提示 toast', /已复制 \d+ 条明细|复制失败/.test(s), s)

      // 状态标签回到「全部」，避免影响后续步骤
      await click(cdp, '.page[data-page="exchange-records"] [data-status=""]')
      await sleep(150)
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

    /* 10. 结汇模块顶部 tab ------------------------------------------ */
    await step('结汇模块顶部 tab（跳转 + 平级替换）', cdp, async () => {
      // 从首页快捷入口进结汇首页，先把页面栈收敛到确定基线
      await cdp.eval(`PP.router.switchTab('index')`)
      await cdp.waitFor(`PP.router.current() === 'index'`, '回到首页')
      await sleep(150)
      await click(cdp, '.quick-item[data-go="rmb-exchange"]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange'`, '进入人民币结汇')
      await sleep(200)

      const tabState = (sel) => cdp.eval(`({
        texts: [].slice.call(document.querySelectorAll(${JSON.stringify(sel)} + ' .seg-item'))
          .map(function (b) { return b.textContent.trim() }),
        selected: [].slice.call(document.querySelectorAll(${JSON.stringify(sel)} + ' .seg-item'))
          .map(function (b) { return b.getAttribute('aria-selected') })
      })`)

      let s = await tabState('#rmb-tabseg')
      check('结汇首页顶部两个 tab：结汇提现 / 结汇账户',
        s.texts.join('/') === '结汇提现/结汇账户', JSON.stringify(s.texts))
      check('默认选中「结汇提现」', s.selected.join(',') === 'true,false', JSON.stringify(s.selected))
      s = await cdp.eval(`({
        entries: document.querySelectorAll('#entry-list .entry').length,
        entryTitles: [].slice.call(document.querySelectorAll('#entry-list .entry-title'))
          .map(function (e) { return e.textContent.trim() }),
        infos: document.querySelectorAll('#info-list .info-item').length,
        infoText: document.querySelector('#info-list').textContent,
        infoTones: [].slice.call(document.querySelectorAll('#info-list .info-icon'))
          .map(function (e) { return e.getAttribute('data-tone') })
      })`)
      check('企业结汇入口已隐藏，入口仅剩「结汇提现」',
        s.entries === 1 && s.entryTitles.join('/') === '结汇提现', JSON.stringify(s.entryTitles))
      check('优势信息 3 条且第三条文案为「全流程合规申报」',
        s.infos === 3 && s.infoText.indexOf('全流程合规申报') >= 0 &&
          s.infoText.indexOf('合规审核') < 0, JSON.stringify(s.infoText))
      // 本页视觉语言是「一支品牌蓝 + 中性灰」，优势信息不再用绿/橙语义色
      check('优势信息图标配色统一为品牌蓝（单色系）',
        s.infoTones.join(',') === 'blue,blue,blue', JSON.stringify(s.infoTones))

      // tab 一：从首页进结汇提现（入栈，返回键才有落点）
      await click(cdp, '#rmb-tabseg .seg-item[data-go="rmb-exchange-withdraw"]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-withdraw'`, '进入结汇提现')
      await sleep(150)
      s = await cdp.eval(`PP.router.stack().length`)
      const depth = s
      check('从结汇首页进子页是入栈（深度 3：首页/结汇/提现）', depth === 3, String(depth))
      s = await tabState('#withdraw-tabseg')
      check('结汇提现页 tab 选中状态正确', s.selected.join(',') === 'true,false', JSON.stringify(s.selected))

      // tab 二：平级互跳用替换，栈深度不得增长
      await click(cdp, '#withdraw-tabseg .seg-item[data-go="rmb-exchange-accounts"]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-accounts'`, '切到结汇账户')
      await sleep(200)
      s = await cdp.eval(`({ depth: PP.router.stack().length, title: document.querySelector('#bar-title').textContent })`)
      check('平级互跳不堆栈（深度仍为 3）', s.depth === depth, String(s.depth))
      check('导航栏标题为「人民币结汇账户」', s.title === '人民币结汇账户', s.title)
      s = await tabState('#acct-tabseg')
      check('结汇账户页 tab 选中状态正确', s.selected.join(',') === 'false,true', JSON.stringify(s.selected))

      // 切回结汇提现，同样不堆栈
      await click(cdp, '#acct-tabseg .seg-item[data-go="rmb-exchange-withdraw"]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-withdraw'`, '切回结汇提现')
      await sleep(150)
      s = await cdp.eval(`PP.router.stack().length`)
      check('切回结汇提现仍不堆栈', s === depth, String(s))

      // 点当前页自己的 tab：不动栈、不重进
      await click(cdp, '#withdraw-tabseg .seg-item[data-go="rmb-exchange-withdraw"]')
      await sleep(150)
      s = await cdp.eval(`({ cur: PP.router.current(), depth: PP.router.stack().length })`)
      check('点当前页自己的 tab 无副作用',
        s.cur === 'rmb-exchange-withdraw' && s.depth === depth, JSON.stringify(s))

      // 返回键落回人民币结汇首页
      await click(cdp, '#bar-back')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange'`, '返回结汇首页')
      await sleep(150)
      s = await cdp.eval(`({
        depth: PP.router.stack().length,
        active: document.querySelector('#rmb-tabseg .seg-item[aria-selected="true"]').textContent.trim()
      })`)
      check('返回键落回人民币结汇首页', s.depth === 2 && s.active === '结汇提现', JSON.stringify(s))
    })

    /* 11. 结汇账户列表 ---------------------------------------------- */
    await step('结汇账户页（统计 / 搜索 / 筛选 / 分页 / 管理）', cdp, async () => {
      // 步骤 10 结束时停在结汇首页；从顶部 tab「结汇账户」进入（入栈）
      await click(cdp, '#rmb-tabseg .seg-item[data-go="rmb-exchange-accounts"]')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-accounts'`, '进入结汇账户')
      await sleep(250)

      let s = await cdp.eval(`({
        counts: [].slice.call(document.querySelectorAll('.stat-bar [data-count]')).map(function (e) { return e.textContent }),
        cards: document.querySelectorAll('#acct-list .acct-item').length,
        count: document.querySelector('#acct-count').textContent,
        pager: !document.querySelector('#acct-pager').hidden,
        info: document.querySelector('.pager-info').textContent
      })`)
      check('状态统计条 10 / 8 / 2', s.counts.join(',') === '10,8,2', JSON.stringify(s.counts))
      check('第 1 页 5 张卡且分页可见', s.cards === 5 && s.pager, JSON.stringify(s))
      check('分页信息「第 1–5 条 / 共 10 条」',
        /第 1–5 条/.test(s.info) && /共 10 条/.test(s.info), s.info)

      // 翻页：数据按绑定时间倒序，第 2 页首卡应是北京达飞科技
      await click(cdp, '#acct-pager [data-pg="2"]')
      await sleep(250)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#acct-list .acct-item').length,
        name: document.querySelector('#acct-list .acct-name').textContent,
        info: document.querySelector('.pager-info').textContent
      })`)
      check('第 2 页 5 张卡且首卡为北京达飞科技（倒序）',
        s.cards === 5 && s.name === '北京达飞科技', JSON.stringify(s))
      check('第 2 页分页信息「第 6–10 条」', /第 6–10 条/.test(s.info), s.info)
      await click(cdp, '#acct-pager [data-pg="1"]')
      await sleep(250)

      // 状态统计点击即筛：正常 8 个
      await click(cdp, '.stat-bar [data-acct-status="ok"]')
      await sleep(200)
      s = await cdp.eval(`({
        count: document.querySelector('#acct-count').textContent,
        pressed: document.querySelector('[data-acct-status="ok"]').getAttribute('aria-pressed')
      })`)
      check('点「正常」筛出 8 个账户', s.count === '共 8 个结汇账户' && s.pressed === 'true', JSON.stringify(s))
      await click(cdp, '.stat-bar [data-acct-status=""]')
      await sleep(200)

      // 搜索（名称 / 账号 / 别名），输入即筛、可清除
      await cdp.eval(`(function () {
        var el = document.querySelector('#acct-search');
        el.value = '张三';
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await sleep(200)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#acct-list .acct-item').length,
        name: document.querySelector('#acct-list .acct-name').textContent,
        clear: !document.querySelector('#acct-clear').hidden
      })`)
      check('搜索「张三」→ 1 张卡且出现清除按钮', s.cards === 1 && s.name === '张三' && s.clear, JSON.stringify(s))
      await click(cdp, '#acct-clear')
      await sleep(200)
      s = await cdp.eval(`document.querySelectorAll('#acct-list .acct-item').length`)
      check('清除后回到第 1 页 5 张卡', s === 5, String(s))

      // 修改别名：王五原本未设置别名
      await click(cdp, '.acct-item:first-child .acct-op[data-act="alias"]')
      await cdp.waitFor(`!!document.querySelector('#acct-alias-input')`, '别名弹层出现')
      await cdp.eval(`document.querySelector('#acct-alias-input').value = '结算备用'`)
      await click(cdp, '[data-save]', 'document.querySelector("#layer-root")')
      await sleep(250)
      s = await cdp.eval(`({
        alias: document.querySelector('#acct-list .acct-item:first-child .acct-field:nth-child(3) .acct-value').textContent,
        empty: document.querySelector('#acct-list .acct-item:first-child .acct-value.is-empty') !== null
      })`)
      check('别名保存后卡片同步且不再是未设置态',
        s.alias === '结算备用' && !s.empty, JSON.stringify(s))

      // 修改资料：改第一张卡（王五）的银行名称
      await click(cdp, '.acct-item:first-child .acct-op[data-act="edit"]')
      await cdp.waitFor(`!!document.querySelector('#acct-edit-name')`, '修改资料弹层出现')
      await cdp.eval(`(function () {
        var el = document.querySelector('#acct-edit-bank');
        el.value = '工商银行深圳分行';
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await click(cdp, '[data-save]', 'document.querySelector("#layer-root")')
      await sleep(250)
      s = await cdp.eval(`document.querySelector('#acct-list .acct-item:first-child .acct-field:nth-child(1) .acct-value').textContent`)
      check('修改资料后银行名称同步', s === '工商银行深圳分行', s)

      // 删除：先取消后确认，列表与统计同步
      s = await cdp.eval(`document.querySelectorAll('#acct-list .acct-item').length`)
      const cardsBefore = s
      await click(cdp, '.acct-item:first-child .acct-op[data-act="delete"]')
      await sleep(300)
      s = await cdp.eval(`!!document.querySelector('#layer-root [data-ok]')`)
      check('删除弹层出现且文案警示不可恢复', s, '')
      await click(cdp, '[data-cancel]', 'document.querySelector("#layer-root")')
      await sleep(250)
      s = await cdp.eval(`document.querySelectorAll('#acct-list .acct-item').length`)
      check('取消删除后列表不变', s === cardsBefore, String(s))
      await click(cdp, '.acct-item:first-child .acct-op[data-act="delete"]')
      await sleep(300)
      await click(cdp, '[data-ok]', 'document.querySelector("#layer-root")')
      await sleep(300)
      s = await cdp.eval(`({
        cards: document.querySelectorAll('#acct-list .acct-item').length,
        total: document.querySelector('#acct-count').textContent,
        ok: document.querySelector('.stat-bar [data-count="ok"]').textContent
      })`)
      check('确认删除后列表与统计同步（剩 9 个、正常 7 个，第 1 页仍是 5 张卡）',
        s.cards === 5 && /共 9 个/.test(s.total) && s.ok === '7', JSON.stringify(s))

      // 筛选弹层：账户所属 = 供货商（删除王五后剩 4 个）
      // 注意 picker 是叠在筛选弹层之上的第二个弹层，全局检索它的选项即可，
      // 不要把 scope 限定在第一个 .mask（那是筛选弹层自己的）
      await click(cdp, '#acct-filter')
      await cdp.waitFor(`!!document.querySelector('#acct-f-owner')`, '筛选弹层出现')
      await click(cdp, '#acct-f-owner')
      await cdp.waitFor(`!!document.querySelector('#layer-root .option-row')`, '所属 picker 出现')
      await click(cdp, '.option-row[data-value="supplier"]')
      await sleep(200)
      await click(cdp, '[data-apply]', 'document.querySelector("#layer-root")')
      await sleep(300)
      s = await cdp.eval(`({
        count: document.querySelector('#acct-count').textContent,
        badge: document.querySelector('#acct-filter-badge').textContent,
        active: document.querySelector('#acct-filter').getAttribute('data-active')
      })`)
      check('筛选供货商 → 4 个且筛选徽标亮起',
        /共 4 个/.test(s.count) && s.badge === '1' && s.active === 'true', JSON.stringify(s))

      // 重置筛选
      await click(cdp, '#acct-filter')
      await cdp.waitFor(`!!document.querySelector('#acct-f-owner')`, '再次打开筛选弹层')
      await click(cdp, '[data-reset]', 'document.querySelector("#layer-root")')
      await sleep(150)
      await click(cdp, '[data-apply]', 'document.querySelector("#layer-root")')
      await sleep(300)
      s = await cdp.eval(`document.querySelector('#acct-count').textContent`)
      check('重置后回到全量 9 个', /共 9 个/.test(s), s)

      // 「添加账户」按钮直达新增向导
      await click(cdp, '.acct-add[data-go="add-rmb-exchange-account"]')
      await cdp.waitFor(`PP.router.current() === 'add-rmb-exchange-account'`, '进入添加账户向导')
      await sleep(150)
      s = await cdp.eval(`({ title: document.querySelector('#bar-title').textContent, depth: PP.router.stack().length })`)
      check('添加账户入口直达向导且入栈（深度 4）',
        s.title === '添加人民币结汇账户' && s.depth === 4, JSON.stringify(s))

      // 返回落回结汇账户页
      await click(cdp, '#bar-back')
      await cdp.waitFor(`PP.router.current() === 'rmb-exchange-accounts'`, '返回结汇账户')
      check('返回落回结汇账户页', true)
    })

    /* 12. 系统管理页（第 4 个 tab） ---------------------------------- */
    await step('系统管理页（设置行 / 开关 / 修改弹层）', cdp, async () => {
      await cdp.eval(`PP.router.switchTab('system-settings')`)
      await cdp.waitFor(`PP.router.current() === 'system-settings'`, '切到系统管理')
      await sleep(200)

      let s = await cdp.eval(`({
        selected: document.querySelector('.tab[data-name="system-settings"]').getAttribute('aria-selected'),
        title: document.querySelector('#bar-title').textContent,
        tabbarHidden: document.querySelector('#tabbar').hidden,
        back: !!document.querySelector('#bar-back'),
        cards: document.querySelectorAll('.sys-card').length,
        rows: document.querySelectorAll('.sys-row').length,
        labels: [].slice.call(document.querySelectorAll('.sys-label')).map(function (e) { return e.textContent.trim() }),
        switches: [].slice.call(document.querySelectorAll('.switch[role="switch"]')).map(function (e) { return e.getAttribute('aria-checked') })
      })`)
      check('tab 选中且为 tabBar 页（无返回键）',
        s.selected === 'true' && !s.tabbarHidden && !s.back, JSON.stringify({
          selected: s.selected, tabbarHidden: s.tabbarHidden, back: s.back }))
      check('导航栏标题为「系统管理」', s.title === '系统管理', s.title)
      check('三组设置卡共 9 行', s.cards === 3 && s.rows === 9,
        JSON.stringify({ cards: s.cards, rows: s.rows }))
      check('行齐全（账号信息 2 + 安全设置 4 + 通知偏好 3）',
        s.labels.join('/') === '手机号/邮箱/登录密码/交易密码/交易二次校验/付款交易审批/到账提醒/入账提醒/付款提醒',
        JSON.stringify(s.labels))
      check('开关初始态 开/关/开/开/开', s.switches.join(',') === 'true,false,true,true,true',
        JSON.stringify(s.switches))
      s = await cdp.eval(`({
        phone: document.querySelector('#sys-phone-value').textContent,
        email: document.querySelector('#sys-email-value').textContent
      })`)
      check('手机号 / 邮箱与 desktop 版一致',
        s.phone === '+86 17301643654' && s.email === '1950130401@qq.com', JSON.stringify(s))

      // 开关翻转 + toast 反馈
      await click(cdp, '.switch[data-toggle="verify"]')
      await sleep(150)
      s = await cdp.eval(`({
        checked: document.querySelector('.switch[data-toggle="verify"]').getAttribute('aria-checked'),
        toast: document.querySelector('#toast-layer').textContent
      })`)
      check('开关点击翻为关并 toast「交易二次校验已关闭」',
        s.checked === 'false' && s.toast.indexOf('交易二次校验已关闭') >= 0, JSON.stringify(s))
      await click(cdp, '.switch[data-toggle="verify"]')
      await sleep(120)

      // 修改手机号弹层：校验链 → 成功回写
      await click(cdp, '.sys-act[data-act="phone"]')
      await cdp.waitFor(`!!document.querySelector('#sys-contact-input')`, '修改手机号弹层出现')
      s = await cdp.eval(`({
        title: document.querySelector('.sheet-title').textContent,
        current: document.querySelector('.sys-current').textContent
      })`)
      check('弹层标题与当前掩码号',
        s.title === '修改手机号' && s.current === '当前：+86 173****3654', JSON.stringify(s))
      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await sleep(120)
      s = await cdp.eval(`({
        shown: !document.querySelector('#sys-contact-error').hidden,
        err: document.querySelector('#sys-contact-error').textContent
      })`)
      check('空提交给出错误提示', s.shown && s.err.indexOf('请输入') >= 0, JSON.stringify(s))

      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-contact-input')
        i.value = '13912345678'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await click(cdp, '[data-act="send"]', 'document.querySelector("#layer-root")')
      await sleep(150)
      s = await cdp.eval(`({
        disabled: document.querySelector('[data-act="send"]').disabled,
        text: document.querySelector('[data-act="send"]').textContent
      })`)
      check('获取验证码后进入 60 秒倒计时', s.disabled && /秒后重发/.test(s.text), JSON.stringify(s))

      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await sleep(120)
      s = await cdp.eval(`({
        shown: !document.querySelector('#sys-contact-error').hidden,
        err: document.querySelector('#sys-contact-error').textContent
      })`)
      check('缺验证码被拦截', s.shown && s.err.indexOf('验证码') >= 0, JSON.stringify(s))

      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-contact-code')
        i.value = '123456'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await cdp.waitFor(`!document.querySelector('#sys-contact-input')`, '保存成功后弹层关闭')
      await sleep(150)
      s = await cdp.eval(`({
        v: document.querySelector('#sys-phone-value').textContent,
        toast: document.querySelector('#toast-layer').textContent
      })`)
      check('手机号行值更新为 +86 13912345678', s.v === '+86 13912345678', JSON.stringify(s))

      // 修改登录密码：强度条联动 + 逐项校验
      await click(cdp, '.sys-act[data-act="login-pwd"]')
      await cdp.waitFor(`!!document.querySelector('#sys-pwd-new')`, '修改登录密码弹层出现')
      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-pwd-new')
        i.value = 'Ab123456!'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await sleep(120)
      s = await cdp.eval(`({
        lv: document.querySelector('#sys-strength').getAttribute('data-level'),
        text: document.querySelector('#sys-strength-text').textContent
      })`)
      check('密码强度条实时联动（Ab123456! → 强）', s.lv === '4', JSON.stringify(s))

      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await sleep(120)
      s = await cdp.eval(`document.querySelector('#sys-pwd-error').textContent`)
      check('未填当前密码被拦截', s.indexOf('当前密码') >= 0, s)

      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-pwd-old')
        i.value = 'old123'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-pwd-confirm')
        i.value = 'Ab123457!'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await sleep(120)
      s = await cdp.eval(`document.querySelector('#sys-pwd-error').textContent`)
      check('两次新密码不一致被拦截', s.indexOf('不一致') >= 0, s)

      await cdp.eval(`(function () {
        var i = document.querySelector('#sys-pwd-confirm')
        i.value = 'Ab123456!'
        i.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await click(cdp, '[data-act="save"]', 'document.querySelector("#layer-root")')
      await cdp.waitFor(`!document.querySelector('#sys-pwd-new')`, '密码保存成功弹层关闭')
      await sleep(150)
      s = await cdp.eval(`document.querySelector('#toast-layer').textContent`)
      check('toast「登录密码修改成功」', s.indexOf('登录密码修改成功') >= 0, s)

      // 状态持久性：切走再切回，开关与手机号保持修改后的值
      await click(cdp, '.switch[data-toggle="payment"]')
      await sleep(120)
      await cdp.eval(`PP.router.switchTab('index')`)
      await cdp.waitFor(`PP.router.current() === 'index'`, '切回首页')
      await sleep(150)
      await cdp.eval(`PP.router.switchTab('system-settings')`)
      await cdp.waitFor(`PP.router.current() === 'system-settings'`, '再回系统管理')
      await sleep(200)
      s = await cdp.eval(`({
        payment: document.querySelector('.switch[data-toggle="payment"]').getAttribute('aria-checked'),
        phone: document.querySelector('#sys-phone-value').textContent
      })`)
      check('切走再回来：开关与手机号保持修改后的状态',
        s.payment === 'false' && s.phone === '+86 13912345678', JSON.stringify(s))
      // 翻回付款提醒，避免给后续演示留脏状态
      await click(cdp, '.switch[data-toggle="payment"]')
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
