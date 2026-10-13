/* ============================================================
   pages/in-transit-funds.js · 在途资金
   ------------------------------------------------------------
   职责：渲染汇总 Hero、状态页签、资金列表与详情弹层。
   列表数据放在文件顶部常量里，由 PP.dom 渲染；事件统一用 dom.on 委托。

   汇总口径与原实现一致：合计与笔数始终按全量数据统计，
   不随状态筛选变化（筛选只影响下面的列表）。

   状态放在模块作用域闭包变量里（同 index.js），不挂到 this。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 在途资金明细（演示数据，字段与资金接口同名） */
  var ALL = [
    { id: 'f1', time: '2026-07-02 02:39:00', payer: 'DEBTOR NAME100ACC', amount: 888.10, currency: 'USD', country: 'SE', bank: 'ESSESESSXXX', note: 'INVOICE12300 PAYMENT', status: '收款行已到账' },
    { id: 'f2', time: '2026-07-01 18:22:15', payer: 'TRADE CORP LTD200AC', amount: 9960.10, currency: 'USD', country: 'PA', bank: 'BAGEPAPAXXX', note: 'INVOICE20260701 TRADE', status: '在途中' },
    { id: 'f3', time: '2026-06-30 14:55:42', payer: 'GLOBAL TRADING INC', amount: 860.10, currency: 'USD', country: 'DE', bank: 'DEUTDEFFXXX', note: 'INVOICE0630 PAYMENT', status: '收款行已到账' },
    { id: 'f4', time: '2026-06-29 09:12:33', payer: 'SUNRISE IMPORT EXP', amount: 1550.00, currency: 'EUR', country: 'FR', bank: 'BNPAFRPPXXX', note: 'INVOICE290624', status: '在途中' },
    { id: 'f5', time: '2026-06-28 16:44:08', payer: 'EASTERN MERCHANT CO', amount: 7200.00, currency: 'GBP', country: 'GB', bank: 'BARCGB22XXX', note: 'INVOICE2806', status: '收款行已到账' },
    { id: 'f6', time: '2026-06-27 11:30:55', payer: 'NORTH SEA TRADING', amount: 4300.50, currency: 'CNH', country: 'HK', bank: 'HSBCHKHHXXX', note: 'INVOICE0627 PAYMENT', status: '已退款' }
  ]

  /** 币种符号 */
  var SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNH: '¥' }

  /** 折算汇率（演示口径，合计按 USD 计价） */
  var RATE = { USD: 1, EUR: 1.08, GBP: 1.27, CNH: 0.14 }

  /** 状态页签 */
  var STATUS_TABS = [
    { key: 'all', label: '全部' },
    { key: 'transit', label: '在途中' },
    { key: 'arrived', label: '已到账' },
    { key: 'refund', label: '已退款' }
  ]

  /** 列表状态文案 → 页签 key */
  function keyOf(status) {
    if (status === '在途中') return 'transit'
    if (status === '已退款') return 'refund'
    return 'arrived'
  }

  /** 图标块色调：退款中转为中性，避免和正常到账混在一起 */
  function toneOf(status) {
    if (status === '已退款') return 'neutral'
    if (status === '在途中') return 'blue'
    return 'success'
  }

  /** 徽章色调 */
  function badgeToneOf(status) {
    if (status === '已退款') return 'danger'
    if (status === '在途中') return 'blue'
    return 'success'
  }

  /** 补齐展示字段：金额文案 / 页签 key / 色调 */
  function decorate(r) {
    return {
      id: r.id,
      time: r.time,
      payer: r.payer,
      amount: r.amount,
      currency: r.currency,
      country: r.country,
      bank: r.bank,
      note: r.note,
      status: r.status,
      key: keyOf(r.status),
      tone: toneOf(r.status),
      badgeTone: badgeToneOf(r.status),
      amountText: (SYMBOL[r.currency] || '') + ' ' + PP.format.fmtNum(r.amount) + ' ' + r.currency
    }
  }

  var ROWS = ALL.map(decorate)

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 取数 */

  function listOf() {
    return ROWS.filter(function (r) {
      return view.status === 'all' || r.key === view.status
    })
  }

  function rowOf(id) {
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].id === id) return ROWS[i]
    }
    return null
  }

  /* ---------------------------------------------- 渲染片段 */

  function renderHero(root) {
    var total = ROWS.reduce(function (acc, r) {
      return acc + r.amount * (RATE[r.currency] || 1)
    }, 0)

    var setText = function (sel, text) {
      var el = PP.dom.qs(sel, root)
      if (el) el.textContent = text
    }
    setText('#fund-total', PP.format.withSymbol('$', total))
    setText('#fund-all-count', ROWS.length + ' 笔')
    setText('#fund-transit-count', ROWS.filter(function (r) {
      return r.status === '在途中'
    }).length + ' 笔')
  }

  function renderTabs(root) {
    PP.dom.renderList(PP.dom.qs('#fund-status', root), STATUS_TABS, function (t) {
      return (
        '<button type="button" class="seg-item" role="tab"' +
        ' aria-selected="' + (t.key === view.status ? 'true' : 'false') + '"' +
        ' data-status="' + t.key + '">' + PP.dom.esc(t.label) + '</button>'
      )
    })
  }

  function fundHTML(r) {
    var esc = PP.dom.esc
    return (
      '<li>' +
      '<button type="button" class="fund" data-id="' + esc(r.id) + '">' +
      '<span class="tile" data-tone="' + r.tone + '">' +
      '<svg aria-hidden="true"><use href="#i-globe"/></svg></span>' +
      '<span class="fund-body">' +
      '<span class="fund-line1">' +
      '<span class="fund-payer">' + esc(r.payer) + '</span>' +
      '<span class="fund-amount num">' + esc(r.amountText) + '</span>' +
      '</span>' +
      '<span class="fund-line2">' +
      '<span class="fund-sub">' + esc(r.country + ' · ' + r.bank) + '</span>' +
      '<span class="pill" data-tone="' + r.badgeTone + '">' + esc(r.status) + '</span>' +
      '</span>' +
      '<span class="fund-time">' + esc(r.time) + '</span>' +
      '</span>' +
      '</button>' +
      '</li>'
    )
  }

  function renderList(root) {
    var list = listOf()
    PP.dom.renderList(PP.dom.qs('#fund-list', root), list, fundHTML)
    PP.dom.toggle(PP.dom.qs('#fund-list-card', root), list.length > 0)
    PP.dom.toggle(PP.dom.qs('#fund-empty', root), list.length === 0)

    var count = PP.dom.qs('#fund-count', root)
    if (count) count.textContent = '共 ' + list.length + ' 条记录'
  }

  /* ---------------------------------------------- 详情弹层 */

  function detailRow(label, value, isNum) {
    return (
      '<div class="detail-row">' +
      '<span class="detail-label">' + PP.dom.esc(label) + '</span>' +
      '<span class="detail-value"' + (isNum ? ' data-num' : '') + '>' +
      PP.dom.esc(value) + '</span>' +
      '</div>'
    )
  }

  function openDetail(id) {
    var r = rowOf(id)
    if (!r) return

    var body =
      detailRow('到账时间', r.time) +
      detailRow('付款人', r.payer) +
      detailRow('付款金额', r.amountText, true) +
      detailRow('付款币种', r.currency) +
      detailRow('付款国家/地区', r.country) +
      detailRow('付款银行', r.bank) +
      detailRow('附言', r.note) +
      detailRow('状态', r.status)

    if (view.sheet) view.sheet.close()
    view.sheet = PP.ui.sheet({ title: '在途资金详情', body: body })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('in-transit-funds', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = { root: root, status: 'all', sheet: null }

      renderHero(root)
      renderTabs(root)
      renderList(root)

      dom.on(root, 'click', '[data-status]', function (e, el) {
        var key = el.getAttribute('data-status')
        if (key === view.status) return
        view.status = key
        renderTabs(root)
        renderList(root)
      })

      dom.on(root, 'click', '[data-id]', function (e, el) {
        openDetail(el.getAttribute('data-id'))
      })

      ctx.onCleanup(function () {
        // 页面出栈时若弹层还开着，一并收掉，避免遮罩留在界面上
        if (view && view.sheet) view.sheet.close()
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
