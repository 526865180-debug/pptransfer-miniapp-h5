/* ============================================================
   pages/wallet.js · 我的资产
   ------------------------------------------------------------
   职责：渲染币种账户列表、驱动行内「换汇 / 提现」动作、同步金额脱敏开关。
   列表数据与文案逐行对齐小程序 pages/wallet/wallet.js。
   金额用 PP.format.withSymbol 格式化（保持原稿的千分位与两位小数）。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 总资产与在途资金（演示数据，字段与接口同名） */
  var TOTAL_ASSET = { symbol: '$', value: 1723225.51 }
  var IN_TRANSIT = { symbol: '$', value: 177088.52 }

  /** 币种账户（演示数据，字段与接口同名） */
  var ACCOUNTS = [
    { ccy: 'CNH', name: '人民币', flag: '🇨🇳', symbol: '¥', value: 10000000 },
    { ccy: 'USD', name: '美元', flag: '🇺🇸', symbol: '$', value: 842500 },
    { ccy: 'EUR', name: '欧元', flag: '🇪🇺', symbol: '€', value: 156920 },
    { ccy: 'GBP', name: '英镑', flag: '🇬🇧', symbol: '£', value: 42000 },
    { ccy: 'HKD', name: '港币', flag: '🇭🇰', symbol: 'HK$', value: 125000 },
    { ccy: 'AUD', name: '澳元', flag: '🇦🇺', symbol: 'A$', value: 98000 },
    { ccy: 'CAD', name: '加元', flag: '🇨🇦', symbol: 'C$', value: 51800 },
    { ccy: 'CHF', name: '瑞郎', flag: '🇨🇭', symbol: 'Fr', value: 38500 },
    { ccy: 'JPY', name: '日元', flag: '🇯🇵', symbol: '¥', value: 23400000 },
    { ccy: 'SGD', name: '新加坡元', flag: '🇸🇬', symbol: 'S$', value: 64200 }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /** '¥ 10,000,000.00' —— 币种符号 + 千分位两位小数 */
  function money(entry) {
    return PP.format.withSymbol(entry.symbol, entry.value)
  }

  /* ---------------------------------------------- 渲染 */

  function renderAccounts(root) {
    dom.setHTML(dom.qs('#wallet-acct-list', root), dom.raw(ACCOUNTS.map(function (a) {
      var label = a.name + ' ' + a.ccy
      return (
        '<li class="acct">' +
        '<span class="acct-flag" aria-hidden="true">' + dom.esc(a.flag) + '</span>' +
        '<span class="acct-body">' +
        '<span class="acct-name">' + dom.esc(label) + '</span>' +
        '<span class="acct-amount num" data-amount>' + dom.esc(money(a)) + '</span>' +
        '</span>' +
        '<span class="acct-ops">' +
        '<button type="button" class="acct-op" data-op="exchange" data-ccy="' + dom.esc(a.ccy) + '"' +
        ' aria-label="换汇 ' + dom.esc(label) + '">换汇</button>' +
        '<button type="button" class="acct-op" data-op="withdraw" data-ccy="' + dom.esc(a.ccy) + '"' +
        ' aria-label="提现 ' + dom.esc(label) + '">提现</button>' +
        '</span>' +
        '</li>'
      )
    }).join('')))
  }

  /* ---------------------------------------------- 金额脱敏 */

  function syncAmount() {
    if (!view) return
    var visible = PP.store.get('amountVisible')
    var btn = dom.qs('#wallet-amount-toggle', view.root)

    // 用 body 属性驱动，全站所有 [data-amount] 一次性生效
    if (visible) document.body.removeAttribute('data-amount-hidden')
    else document.body.setAttribute('data-amount-hidden', 'true')

    if (!btn) return
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false')
    btn.setAttribute('aria-label', visible ? '隐藏金额' : '显示金额')
    var use = btn.querySelector('use')
    if (use) use.setAttribute('href', visible ? '#i-eye' : '#i-eye-off')
  }

  /* ---------------------------------------------- 行内动作 */

  function onAction(el) {
    var ccy = el.getAttribute('data-ccy')
    if (el.getAttribute('data-op') === 'exchange') {
      PP.ui.toast('换汇（' + ccy + '）待接入')
      return
    }
    // 人民币账户走结汇提现流程，其余币种待接入
    if (ccy === 'CNH') {
      PP.router.go('rmb-exchange-withdraw')
      return
    }
    PP.ui.toast('提现（' + ccy + '）待接入')
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('wallet', {
    mount: function (root, ctx) {
      view = { root: root }

      renderAccounts(root)

      dom.qs('#total-asset', root).textContent = money(TOTAL_ASSET)
      dom.qs('#in-transit', root).textContent = money(IN_TRANSIT)
      dom.qs('#acct-count', root).textContent = String(ACCOUNTS.length)

      var offToggle = dom.on(root, 'click', '#wallet-amount-toggle', function () {
        PP.store.set({ amountVisible: !PP.store.get('amountVisible') })
        dom.haptic()
      })

      var offOps = dom.on(root, 'click', '[data-op]', function (e, el) {
        onAction(el)
      })

      syncAmount()

      var unsub = PP.store.subscribe(syncAmount)

      ctx.onCleanup(function () {
        offToggle()
        offOps()
        unsub()
        view = null
      })
    },

    /** 从提现等页面返回时，脱敏开关可能已被改过，重新同步一次 */
    show: syncAmount
  })
})((window.PP = window.PP || {}))
