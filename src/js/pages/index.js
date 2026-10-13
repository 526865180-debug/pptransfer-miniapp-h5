/* ============================================================
   pages/index.js · 商户首页
   ------------------------------------------------------------
   职责：渲染币种余额、驱动汇率图表、金额脱敏开关、未读角标同步。
   页面间跳转统一交给全局的 [data-go] 委托处理，这里不重复写导航。

   状态放在模块作用域而不是挂到页面对象上 —— 页面可能被反复
   挂载/卸载，闭包变量随实例生灭，语义更清楚也不会残留。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 币种余额（演示数据） */
  var BALANCES = [
    { ccy: 'CNH', flag: '🇨🇳', amount: '¥ 890,000.00' },
    { ccy: 'USD', flag: '🇺🇸', amount: '$ 842,500.00' },
    { ccy: 'EUR', flag: '🇪🇺', amount: '€ 156,920.00' },
    { ccy: 'GBP', flag: '🇬🇧', amount: '£ 42,000.00' },
    { ccy: 'HKD', flag: '🇭🇰', amount: 'HK$ 125,000.00' },
    { ccy: 'SGD', flag: '🇸🇬', amount: 'S$ 64,200.00' }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 渲染片段 */

  function renderBalances(root) {
    PP.dom.setHTML(PP.dom.qs('#bal-scroll', root), PP.dom.raw(BALANCES.map(function (b) {
      return (
        '<div class="bal-chip">' +
        '<div class="bal-chip-head">' +
        '<span class="bal-flag" aria-hidden="true">' + b.flag + '</span>' +
        '<span class="bal-ccy">' + PP.dom.esc(b.ccy) + '</span>' +
        '</div>' +
        '<span class="bal-amount">' + PP.dom.esc(b.amount) + '</span>' +
        '</div>'
      )
    }).join('')))
  }

  /* ---------------------------------------------- 金额脱敏 */

  function syncAmount() {
    if (!view) return
    var visible = PP.store.get('amountVisible')
    var btn = PP.dom.qs('#amount-toggle', view.root)

    // 用 body 属性驱动，全站所有 [data-amount] 一次性生效
    if (visible) document.body.removeAttribute('data-amount-hidden')
    else document.body.setAttribute('data-amount-hidden', 'true')

    if (!btn) return
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false')
    btn.setAttribute('aria-label', visible ? '隐藏金额' : '显示金额')
    var use = btn.querySelector('use')
    if (use) use.setAttribute('href', visible ? '#i-eye' : '#i-eye-off')
  }

  /* ---------------------------------------------- 未读角标 */

  function syncBadge() {
    if (!view) return
    var n = PP.store.get('unread')
    var badge = PP.dom.qs('#notice-badge', view.root)
    var btn = PP.dom.qs('#go-notifications', view.root)
    if (badge) {
      badge.textContent = n > 99 ? '99+' : String(n)
      badge.hidden = n <= 0
    }
    if (btn) {
      btn.setAttribute('aria-label', n > 0 ? '通知，' + n + ' 条未读' : '通知')
    }
  }

  /* ---------------------------------------------- 汇率图表 */

  function drawRate() {
    if (!view) return
    var series = PP.chart.buildRateSeries(view.pair, view.range)

    if (!view.chart && view.canvas) {
      view.chart = new PP.chart.RateChart(view.canvas)
    }
    if (view.chart) view.chart.render(series)

    var now = PP.dom.qs('#rate-now', view.root)
    var chg = PP.dom.qs('#rate-change', view.root)
    if (now) now.textContent = series.currentRate.toFixed(4)
    if (chg) {
      chg.textContent = series.change
      chg.setAttribute('data-trend', PP.format.trend(series.changeValue))
    }
    if (view.canvas) {
      view.canvas.setAttribute('aria-label',
        view.pair + ' 汇率走势，最新 ' + series.currentRate.toFixed(4) + '，' + series.change)
    }
  }

  function selectSeg(root, attr, value) {
    PP.dom.qsa('[' + attr + ']', root).forEach(function (el) {
      el.setAttribute('aria-selected', el.getAttribute(attr) === value ? 'true' : 'false')
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('index', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = {
        root: root,
        pair: 'USD/CNH',
        range: '24H',
        chart: null,
        canvas: dom.qs('#rate-canvas', root),
        raf: 0
      }

      renderBalances(root)

      /* 金额脱敏 */
      dom.on(root, 'click', '#amount-toggle', function () {
        PP.store.set({ amountVisible: !PP.store.get('amountVisible') })
        dom.haptic()
      })

      /* 通知入口 */
      dom.on(root, 'click', '#go-notifications', function () {
        PP.router.go('notifications')
      })

      /* 币对 / 区间切换 */
      dom.on(root, 'click', '[data-pair]', function (e, el) {
        var next = el.getAttribute('data-pair')
        if (next === view.pair) return
        view.pair = next
        selectSeg(root, 'data-pair', next)
        drawRate()
      })
      dom.on(root, 'click', '[data-range]', function (e, el) {
        var next = el.getAttribute('data-range')
        if (next === view.range) return
        view.range = next
        selectSeg(root, 'data-range', next)
        drawRate()
      })

      syncAmount()
      syncBadge()

      // 容器尺寸要等片段完成布局才量得准，延后一帧再首绘
      view.raf = requestAnimationFrame(drawRate)

      var unsub = PP.store.subscribe(function () {
        syncAmount()
        syncBadge()
      })

      ctx.onCleanup(function () {
        unsub()
        if (view && view.raf) cancelAnimationFrame(view.raf)
        if (view && view.chart) view.chart.destroy()
        document.body.removeAttribute('data-amount-hidden')
        view = null
      })
    },

    /** 从其他页面返回时，未读与脱敏状态可能已变，重新同步一次 */
    show: function () {
      syncAmount()
      syncBadge()
    }
  })
})((window.PP = window.PP || {}))
