/* ============================================================
   pages/rights-center.js · 权益中心
   ------------------------------------------------------------
   职责：渲染概览四格与优惠券列表、状态筛选、抵扣规则说明、券详情弹层。
   列表数据放在文件顶部常量里，由 PP.dom 渲染；事件统一用 dom.on 委托。

   状态放在模块作用域闭包变量里（同 index.js），不挂到 this。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 券状态 → 展示文案与徽章色调（原 STATUS_TEXT / STATUS_PILL 合并） */
  var STATUS = {
    active: { text: '可用', tone: 'success' },
    expiring: { text: '即将过期', tone: 'warning' },
    usedup: { text: '已用完', tone: 'neutral' },
    expired: { text: '已过期', tone: 'danger' }
  }

  /**
   * 适用范围 → 场景色调（沿用原实现：按关键词判定）
   * emerald/purple 映射到设计令牌的 success/violet 语义色
   */
  function toneOf(scope) {
    if (scope.indexOf('跨境收款') >= 0) return 'blue'
    if (scope.indexOf('结汇') >= 0) return 'violet'
    if (scope.indexOf('汇款') >= 0) return 'success'
    return 'warning'
  }

  /** 优惠券（演示数据，字段与优惠券接口同名） */
  var RAW = [
    {
      id: 'c1', name: '跨境收款手续费券', type: '满减券',
      face: '¥200', amount: 200, used: 120, scope: '跨境收款手续费',
      valid: '2026-06-30', status: 'active',
      records: [
        { date: '2026-04-01 09:23', desc: '收款 USD 5,200.00 手续费抵扣', amt: '-¥12.00' },
        { date: '2026-03-28 16:45', desc: '收款 EUR 1,200.00 手续费抵扣', amt: '-¥8.50' },
        { date: '2026-03-21 11:02', desc: '收款 GBP 880.00 手续费抵扣', amt: '-¥6.00' }
      ]
    },
    {
      id: 'c2', name: '人民币结汇手续费券', type: '满减券',
      face: '¥150', amount: 150, used: 150, scope: '人民币结汇手续费',
      valid: '2026-05-20', status: 'usedup',
      records: [
        { date: '2026-03-31 14:30', desc: '结汇 USD 25,000.00 手续费抵扣', amt: '-¥80.00' },
        { date: '2026-03-18 10:12', desc: '结汇 EUR 6,000.00 手续费抵扣', amt: '-¥70.00' }
      ]
    },
    {
      id: 'c3', name: '国际汇款手续费券', type: '满减券',
      face: '¥100', amount: 100, used: 35, scope: '国际汇款手续费',
      valid: '2026-05-10', status: 'expiring',
      records: [
        { date: '2026-04-01 10:15', desc: '付款 USD 3,200.00 手续费抵扣', amt: '-¥12.00' },
        { date: '2026-03-25 09:40', desc: '付款 USD 1,500.00 手续费抵扣', amt: '-¥23.00' }
      ]
    },
    {
      id: 'c4', name: '跨境收款折扣券', type: '折扣券 · 8.5折',
      face: '8.5折', amount: 300, used: 80, scope: '跨境收款 / 人民币结汇手续费',
      valid: '2026-07-15', status: 'active',
      records: [
        { date: '2026-03-30 15:20', desc: '收款 USD 8,800.00 手续费抵扣（8.5折）', amt: '-¥46.00' },
        { date: '2026-03-22 13:05', desc: '结汇 USD 4,000.00 手续费抵扣（8.5折）', amt: '-¥34.00' }
      ]
    },
    {
      id: 'c5', name: '新客专享券', type: '满减券',
      face: '¥500', amount: 500, used: 0, scope: '全场景手续费',
      valid: '2026-12-31', status: 'active',
      records: []
    },
    {
      id: 'c6', name: '节日营销券', type: '满减券',
      face: '¥80', amount: 80, used: 80, scope: '国际汇款手续费',
      valid: '2026-03-15', status: 'expired',
      records: [
        { date: '2026-03-10 18:30', desc: '付款 USD 2,000.00 手续费抵扣', amt: '-¥80.00' }
      ]
    }
  ]

  /** 概览四格：value 由 statValues() 现算，key 与之一一对应 */
  var STATS = [
    { key: 'avail', icon: 'i-ticket', tone: 'blue', label: '可用优惠券' },
    { key: 'totalUsed', icon: 'i-coin', tone: 'success', label: '累计已抵扣' },
    { key: 'totalLeft', icon: 'i-wallet', tone: 'warning', label: '剩余可用额度' },
    { key: 'expiring', icon: 'i-clock', tone: 'violet', label: '30天内过期' }
  ]

  /**
   * 状态筛选。注意「可用」= 可用 + 即将过期，
   * 因此它与「即将过期」的计数不互斥（与原实现一致）。
   */
  var FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '可用' },
    { key: 'expiring', label: '即将过期' },
    { key: 'usedup', label: '已用完' },
    { key: 'expired', label: '已过期' }
  ]

  /** 补齐展示字段：场景色调 / 状态徽章 / 金额文案 / 使用进度 / 适用范围拆分 */
  function decorate(c) {
    var st = STATUS[c.status]
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      face: c.face,
      amount: c.amount,
      used: c.used,
      status: c.status,
      valid: c.valid,
      records: c.records,
      tone: toneOf(c.scope),
      statusText: st.text,
      statusTone: st.tone,
      usedText: '¥' + PP.format.fmtNum(c.used),
      amountText: '¥' + PP.format.fmtNum(c.amount),
      leftText: '¥' + PP.format.fmtNum(c.amount - c.used),
      pct: c.amount > 0 ? Math.min(100, Math.round((c.used / c.amount) * 100)) : 0,
      scopeList: c.scope.split('/').map(function (s) { return s.trim() })
    }
  }

  var COUPONS = RAW.map(decorate)

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 取数 */

  function byKey(key) {
    if (key === 'all') return COUPONS
    if (key === 'active') {
      return COUPONS.filter(function (c) {
        return c.status === 'active' || c.status === 'expiring'
      })
    }
    return COUPONS.filter(function (c) { return c.status === key })
  }

  function sum(list, pick) {
    return list.reduce(function (acc, c) { return acc + pick(c) }, 0)
  }

  function statValues() {
    var avail = byKey('active')
    return {
      avail: String(avail.length),
      totalUsed: '¥' + PP.format.fmtNum(sum(COUPONS, function (c) { return c.used })),
      totalLeft: '¥' + PP.format.fmtNum(sum(avail, function (c) { return c.amount - c.used })),
      expiring: String(byKey('expiring').length)
    }
  }

  function couponOf(id) {
    for (var i = 0; i < COUPONS.length; i++) {
      if (COUPONS[i].id === id) return COUPONS[i]
    }
    return null
  }

  /* ---------------------------------------------- 渲染片段 */

  function renderStats(root) {
    var values = statValues()
    PP.dom.renderList(PP.dom.qs('#rc-stats', root), STATS, function (s) {
      return (
        '<div class="stat-card">' +
        '<span class="tile" data-tone="' + s.tone + '">' +
        '<svg aria-hidden="true"><use href="#' + s.icon + '"/></svg></span>' +
        '<div class="stat-card-body">' +
        '<span class="stat-card-value">' + PP.dom.esc(values[s.key]) + '</span>' +
        '<span class="stat-card-label">' + PP.dom.esc(s.label) + '</span>' +
        '</div>' +
        '</div>'
      )
    })
  }

  function renderFilters(root) {
    PP.dom.renderList(PP.dom.qs('#rc-filters', root), FILTERS, function (f) {
      return (
        '<button type="button" class="chip" data-filter="' + f.key + '"' +
        ' aria-pressed="' + (f.key === view.filter ? 'true' : 'false') + '">' +
        PP.dom.esc(f.label) +
        '<span class="chip-count">' + byKey(f.key).length + '</span>' +
        '</button>'
      )
    })
  }

  function scopesHTML(list) {
    return list.map(function (s) {
      return '<span class="coupon-scope">' + PP.dom.esc(s) + '</span>'
    }).join('')
  }

  function couponHTML(c) {
    var esc = PP.dom.esc
    return (
      '<li class="coupon" data-tone="' + c.tone + '" data-state="' + c.status + '">' +
      '<span class="coupon-cord" aria-hidden="true"></span>' +

      '<div class="coupon-head">' +
      '<span class="tile" data-tone="' + c.tone + '">' +
      '<svg aria-hidden="true"><use href="#i-ticket"/></svg></span>' +
      '<div class="coupon-id">' +
      '<span class="coupon-name">' + esc(c.name) + '</span>' +
      '<span class="coupon-type">' + esc(c.type) + '</span>' +
      '</div>' +
      '<span class="pill" data-tone="' + c.statusTone + '">' + esc(c.statusText) + '</span>' +
      '</div>' +

      '<div class="coupon-amount-row">' +
      '<span class="coupon-amount num">' + esc(c.face) + '</span>' +
      '<span class="coupon-amount-cap">面额</span>' +
      '</div>' +

      '<div class="coupon-scopes">' + scopesHTML(c.scopeList) + '</div>' +

      '<div class="coupon-usage">' +
      '<div class="coupon-usage-top">' +
      '<span>已用 <strong>' + esc(c.usedText) + '</strong></span>' +
      '<span>总额 ' + esc(c.amountText) + '</span>' +
      '</div>' +
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"' +
      ' aria-valuenow="' + c.pct + '" aria-label="' + esc(c.name) + ' 已使用 ' + c.pct + '%">' +
      '<span class="bar-in" style="width:' + c.pct + '%"></span>' +
      '</div>' +
      '</div>' +

      '<div class="coupon-foot">' +
      '<span class="coupon-valid">有效期至 <strong>' + esc(c.valid) + '</strong></span>' +
      '<button type="button" class="btn-text coupon-detail" data-detail="' + esc(c.id) + '">' +
      '查看使用记录</button>' +
      '</div>' +
      '</li>'
    )
  }

  function renderList(root) {
    var list = byKey(view.filter)
    var host = PP.dom.qs('#rc-list', root)
    PP.dom.renderList(host, list, couponHTML)
    PP.dom.toggle(host, list.length > 0)
    PP.dom.toggle(PP.dom.qs('#rc-empty', root), list.length === 0)
  }

  /* ---------------------------------------------- 详情弹层 */

  function ovCell(value, label) {
    return (
      '<div class="rc-ov-cell">' +
      '<span class="rc-ov-val num">' + PP.dom.esc(value) + '</span>' +
      '<span class="rc-ov-label">' + PP.dom.esc(label) + '</span>' +
      '</div>'
    )
  }

  function recordHTML(r) {
    return (
      '<li class="rc-rec">' +
      '<span class="rc-rec-body">' +
      '<span class="rc-rec-date">' + PP.dom.esc(r.date) + '</span>' +
      '<span class="rc-rec-desc">' + PP.dom.esc(r.desc) + '</span>' +
      '</span>' +
      '<span class="rc-rec-amt num">' + PP.dom.esc(r.amt) + '</span>' +
      '</li>'
    )
  }

  function openDetail(id) {
    var c = couponOf(id)
    if (!c) return

    var body =
      '<div class="rc-sheet">' +
      '<div class="rc-sheet-id">' +
      '<span class="tile" data-tone="' + c.tone + '">' +
      '<svg aria-hidden="true"><use href="#i-ticket"/></svg></span>' +
      '<span class="rc-sheet-sub">' + PP.dom.esc(c.type + ' · ' + c.statusText) + '</span>' +
      '</div>' +

      '<div class="rc-ov">' +
      ovCell(c.face, '面额') +
      ovCell(c.usedText, '已抵扣') +
      ovCell(c.leftText, '剩余可用') +
      '</div>' +

      '<div class="rc-sheet-scopes">' + scopesHTML(c.scopeList) + '</div>' +

      '<div class="rc-rec-head">' +
      '<svg class="rc-rec-ico" aria-hidden="true"><use href="#i-clock"/></svg>' +
      '<span class="rc-rec-title">抵扣使用记录</span>' +
      '</div>' +

      (c.records.length
        ? '<ul class="rc-rec-list" role="list">' +
          c.records.map(recordHTML).join('') + '</ul>'
        : '<div class="empty">' +
          '<svg class="empty-icon" aria-hidden="true"><use href="#i-inbox"/></svg>' +
          '<span class="empty-text">该券暂无抵扣记录</span>' +
          '</div>') +
      '</div>'

    if (view.sheet) view.sheet.close()
    view.sheet = PP.ui.sheet({ title: c.name, body: body })
  }

  /** 抵扣规则（等价于原小程序的 showModal，showCancel:false） */
  function showRules() {
    PP.ui.confirm({
      title: '抵扣规则',
      content: '优惠券按手续费场景自动匹配，单笔不足面额时智能拆分组合抵扣。',
      showCancel: false,
      confirmText: '知道了'
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('rights-center', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = { root: root, filter: 'all', sheet: null }

      renderStats(root)
      renderFilters(root)
      renderList(root)

      dom.on(root, 'click', '[data-filter]', function (e, el) {
        var key = el.getAttribute('data-filter')
        if (key === view.filter) return
        view.filter = key
        renderFilters(root)
        renderList(root)
      })

      dom.on(root, 'click', '[data-detail]', function (e, el) {
        openDetail(el.getAttribute('data-detail'))
      })

      dom.on(root, 'click', '#rc-rules', showRules)

      ctx.onCleanup(function () {
        // 页面出栈时若弹层还开着，一并收掉，避免遮罩留在界面上
        if (view && view.sheet) view.sheet.close()
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
