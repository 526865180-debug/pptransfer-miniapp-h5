/* ============================================================
   pages/exchange.js · 换汇中心
   ------------------------------------------------------------
   职责：卖出/买入币种与金额联动试算、历史列表渲染、确认与成功弹层。
   金额算法与小程序版逐行对齐：
     参考汇率 = RATES[buy] / RATES[sell]（四舍五入到 4 位小数）
     买入金额 = 卖出金额 × 参考汇率
     可提交条件 = 金额 > 0 且 ≤ 卖出币种余额 且 卖出 ≠ 买入

   状态放在模块作用域闭包变量里 —— 页面可反复挂载/卸载，
   闭包变量随实例生灭，不会把上一次的输入带到下一次。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 币种表（演示数据，字段与接口同名；余额与 wallet 页一致） */
  var CURRENCIES = [
    { code: 'USD', name: '美元', flag: '🇺🇸', symbol: '$', balance: 842500.20, balanceText: '$ 842,500.20' },
    { code: 'CNH', name: '人民币', flag: '🇨🇳', symbol: '¥', balance: 890000.00, balanceText: '¥ 890,000.00' },
    { code: 'EUR', name: '欧元', flag: '🇪🇺', symbol: '€', balance: 156920.00, balanceText: '€ 156,920.00' },
    { code: 'GBP', name: '英镑', flag: '🇬🇧', symbol: '£', balance: 42000.00, balanceText: '£ 42,000.00' },
    { code: 'HKD', name: '港币', flag: '🇭🇰', symbol: 'HK$', balance: 125000.00, balanceText: 'HK$ 125,000.00' },
    { code: 'AUD', name: '澳元', flag: '🇦🇺', symbol: 'A$', balance: 68400.00, balanceText: 'A$ 68,400.00' }
  ]

  /** 以 USD 为锚的参考汇率（演示数据） */
  var RATES = { USD: 1, CNH: 7.2345, EUR: 0.9234, GBP: 0.7891, HKD: 7.8102, AUD: 1.5234 }

  /** 换汇历史（演示数据），每次挂载都从这份原始数据重新展开 */
  var RECORDS = [
    { pair: 'USD → CNH', time: '2026-04-01 09:42', amount: '- $ 50,000.00', rate: '7.2345', status: '已完成' },
    { pair: 'EUR → USD', time: '2026-04-01 15:45', amount: '- € 12,000.00', rate: '1.0842', status: '已完成' },
    { pair: 'USD → HKD', time: '2026-03-30 11:08', amount: '- $ 8,000.00', rate: '7.8102', status: '已完成' }
  ]

  /** 汇率锁定倒计时秒数（与源文件一致） */
  var LOCK_SECONDS = 30

  /** 当前实例的可变状态；未挂载时为 null */
  var view = null

  function findCcy(code) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === code) return CURRENCIES[i]
    }
    return null
  }

  /** 参考汇率 = 目标币种 / 源币种 */
  function currentRate() {
    var r = RATES[view.buy] / RATES[view.sell]
    return Math.round(r * 10000) / 10000
  }

  /** 只保留数字与一个小数点 */
  function sanitize(raw) {
    var v = String(raw || '').replace(/[^\d.]/g, '')
    var firstDot = v.indexOf('.')
    if (firstDot >= 0) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
    }
    return v
  }

  /* ---------------------------------------------- 渲染 */

  function recordRow(item) {
    var tone = item.status === '已完成' ? 'success' : 'warning'
    return (
      '<li class="list-row">' +
      '<span class="tile" data-tone="warning" aria-hidden="true">' +
      '<svg aria-hidden="true"><use href="#i-swap"/></svg></span>' +
      '<div class="row-body">' +
      '<span class="row-title">' + PP.dom.esc(item.pair) + '</span>' +
      '<span class="row-sub">' + PP.dom.esc(item.time) + ' · 汇率 ' + PP.dom.esc(item.rate) + '</span>' +
      '</div>' +
      '<div class="rec-right">' +
      '<span class="row-value num" data-amount>' + PP.dom.esc(item.amount) + '</span>' +
      '<span class="pill rec-pill" data-tone="' + tone + '">' + PP.dom.esc(item.status) + '</span>' +
      '</div>' +
      '</li>'
    )
  }

  function renderRecords() {
    PP.dom.renderList(PP.dom.qs('#rec-list', view.root), view.records, recordRow)
  }

  /** 表单与按钮状态随币种/金额重算 */
  function paint() {
    var dom = PP.dom
    var rate = currentRate()
    var amount = parseFloat(view.amount) || 0
    var buyValue = amount * rate
    var sellCcy = findCcy(view.sell)
    var buyCcy = findCcy(view.buy)

    view.canSubmit = amount > 0 && amount <= sellCcy.balance && view.sell !== view.buy

    dom.qs('#sell-flag', view.root).textContent = sellCcy.flag
    dom.qs('#sell-code', view.root).textContent = view.sell
    dom.qs('#sell-bal', view.root).textContent = sellCcy.balanceText
    dom.qs('#buy-flag', view.root).textContent = buyCcy.flag
    dom.qs('#buy-code', view.root).textContent = view.buy
    dom.qs('#buy-rate', view.root).textContent =
      '参考汇率 1 ' + view.sell + ' = ' + rate.toFixed(4) + ' ' + view.buy
    dom.qs('#buy-amount', view.root).textContent =
      amount > 0 ? PP.format.withSymbol(buyCcy.symbol, buyValue) : '—'
    dom.qs('#submit-swap', view.root)
      .setAttribute('aria-disabled', view.canSubmit ? 'false' : 'true')
  }

  /** 金额错误内联展示（同时保留源实现的 toast 文案） */
  function showAmountError(message) {
    var box = PP.dom.qs('#amount-error', view.root)
    var input = PP.dom.qs('#sell-amount', view.root)
    if (box) {
      box.textContent = message || ''
      box.hidden = !message
    }
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    }
  }

  /* ---------------------------------------------- 币种选择 */

  function pickCcy(side, code) {
    // 与另一侧相同时自动对调，避免同币种互换
    if (side === 'sell' && code === view.buy) view.buy = view.sell
    else if (side === 'buy' && code === view.sell) view.sell = view.buy
    if (side === 'sell') view.sell = code
    else view.buy = code

    showAmountError('')
    paint()
  }

  function openPicker(side) {
    PP.ui.picker({
      title: side === 'sell' ? '选择卖出币种' : '选择买入币种',
      value: side === 'sell' ? view.sell : view.buy,
      options: CURRENCIES.map(function (c) {
        return {
          value: c.code,
          title: c.flag + ' ' + c.code,
          sub: c.name,
          valueText: c.balanceText
        }
      })
    }).then(function (code) {
      if (!code || !view) return
      pickCcy(side, code)
    })
  }

  /* ---------------------------------------------- 汇率锁定倒计时 */

  function clearCountdown() {
    if (view && view.timer) {
      clearInterval(view.timer)
      view.timer = null
    }
  }

  function paintCountdown(el, left) {
    if (el) el.textContent = '00:' + (left < 10 ? '0' + left : left)
  }

  function startCountdown(el) {
    clearCountdown()
    var left = LOCK_SECONDS
    paintCountdown(el, left)
    view.timer = setInterval(function () {
      left -= 1
      if (left <= 0) {
        var sheet = view.sheet
        clearCountdown()
        if (sheet) sheet.close()
        PP.ui.toast('汇率已刷新，请重新确认')
        return
      }
      paintCountdown(el, left)
    }, 1000)
  }

  /* ---------------------------------------------- 确认与结果弹层 */

  function detailRow(label, value, isNum) {
    return (
      '<div class="detail-row">' +
      '<span class="detail-label">' + label + '</span>' +
      '<span class="detail-value' + (isNum ? ' num' : '') + '">' + value + '</span>' +
      '</div>'
    )
  }

  function openConfirm() {
    var dom = PP.dom
    var esc = dom.esc
    var rate = currentRate()
    var amount = parseFloat(view.amount) || 0
    var sellFmt = PP.format.fmtNum(amount)
    var buyFmt = PP.format.fmtNum(amount * rate)

    var body =
      '<p class="confirm-lock">' +
      '<span class="countdown num" id="fx-countdown" role="timer" ' +
      'aria-label="汇率剩余锁定时间">00:30</span></p>' +
      detailRow('卖出', '- ' + esc(sellFmt) + ' ' + esc(view.sell), true) +
      detailRow('买入', '+ ' + esc(buyFmt) + ' ' + esc(view.buy), true) +
      detailRow('交易汇率', '1 ' + esc(view.sell) + ' = ' + esc(rate.toFixed(4)) + ' ' + esc(view.buy), true) +
      detailRow('手续费', '免手续费', false) +
      detailRow('预计到账', esc(buyFmt) + ' ' + esc(view.buy), true) +
      '<div class="field pwd-field">' +
      '<label class="field-label" for="confirm-pwd">交易密码</label>' +
      '<input class="field-input" id="confirm-pwd" type="password" inputmode="numeric" ' +
      'maxlength="6" autocomplete="off" placeholder="请输入 6 位交易密码" ' +
      'aria-describedby="confirm-pwd-error">' +
      '<span class="field-hint">汇率锁定时长 30 秒，超时后需重新确认</span>' +
      '<p class="field-error" id="confirm-pwd-error" role="alert" hidden></p>' +
      '</div>'

    var footer =
      '<div class="sheet-footer">' +
      '<button type="button" class="btn btn--ghost" data-cancel>取消</button>' +
      '<button type="button" class="btn btn--primary" data-ok aria-disabled="true">确定交易</button>' +
      '</div>'

    view.sheet = PP.ui.sheet({
      title: '确认换汇交易',
      body: body,
      footer: footer,
      onMount: function (sheet, api) {
        var pwd = dom.qs('#confirm-pwd', sheet)
        var okBtn = dom.qs('[data-ok]', sheet)
        var err = dom.qs('#confirm-pwd-error', sheet)

        sheet.addEventListener('input', function () {
          var v = String(pwd.value || '').replace(/\D/g, '').slice(0, 6)
          if (v !== pwd.value) pwd.value = v
          view.password = v
          okBtn.setAttribute('aria-disabled', v.length === 6 ? 'false' : 'true')
          if (v.length === 6) {
            err.hidden = true
            pwd.removeAttribute('aria-invalid')
          }
        })

        sheet.addEventListener('click', function (e) {
          if (e.target.closest('[data-cancel]')) {
            api.close()
            return
          }
          if (!e.target.closest('[data-ok]')) return

          if (view.password.length !== 6) {
            err.textContent = '请输入 6 位交易密码'
            err.hidden = false
            pwd.setAttribute('aria-invalid', 'true')
            PP.ui.toast('请输入 6 位交易密码')
            return
          }
          submitTrade()
          api.close()
        })

        startCountdown(dom.qs('#fx-countdown', sheet))
      },
      onClose: function () {
        view.sheet = null
        clearCountdown()
      }
    })
  }

  function submitTrade() {
    clearCountdown()
    var sellCcy = findCcy(view.sell)
    var amount = parseFloat(view.amount) || 0

    view.records.unshift({
      pair: view.sell + ' → ' + view.buy,
      time: PP.format.isoDateTime(new Date()),
      amount: '- ' + sellCcy.symbol + ' ' + PP.format.fmtNum(amount),
      rate: currentRate().toFixed(4),
      status: '处理中'
    })
    view.password = ''
    renderRecords()
    openSuccess()
  }

  function openSuccess() {
    var dom = PP.dom
    var esc = dom.esc
    var rate = currentRate()
    var amount = parseFloat(view.amount) || 0
    var buyFmt = PP.format.fmtNum(amount * rate)

    var body =
      '<svg class="done-icon" aria-hidden="true"><use href="#i-check-circle"/></svg>' +
      '<p class="dialog-title">换汇申请成功</p>' +
      '<p class="dialog-desc">我们将尽快为您处理，到账后可在资产中查看</p>' +
      '<div class="dialog-detail">' +
      detailRow('卖出', esc(PP.format.fmtNum(amount)) + ' ' + esc(view.sell), true) +
      detailRow('买入', esc(buyFmt) + ' ' + esc(view.buy), true) +
      detailRow('参考汇率', '1 ' + esc(view.sell) + ' = ' + esc(rate.toFixed(4)) + ' ' + esc(view.buy), true) +
      '</div>'

    var footer =
      '<div class="sheet-footer">' +
      '<button type="button" class="btn btn--ghost" data-again>继续换汇</button>' +
      '<button type="button" class="btn btn--primary" data-done>完成</button>' +
      '</div>'

    PP.ui.sheet({
      align: 'center',
      body: body,
      footer: footer,
      onMount: function (sheet, api) {
        sheet.setAttribute('aria-label', '换汇申请成功')
        sheet.addEventListener('click', function (e) {
          if (e.target.closest('[data-again]')) {
            resetForm()
            api.close()
            return
          }
          if (e.target.closest('[data-done]')) {
            api.close()
            view.ctx.back()
          }
        })
      }
    })
  }

  function resetForm() {
    view.amount = ''
    view.password = ''
    var input = PP.dom.qs('#sell-amount', view.root)
    if (input) input.value = ''
    showAmountError('')
    paint()
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('exchange', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = {
        root: root,
        ctx: ctx,
        sell: 'USD',
        buy: 'CNH',
        amount: '',
        password: '',
        canSubmit: false,
        records: RECORDS.slice(),
        sheet: null,
        timer: null
      }

      renderRecords()
      paint()

      /* 卖出 / 买入币种 */
      dom.on(root, 'click', '[data-pick]', function (e, el) {
        dom.haptic()
        openPicker(el.getAttribute('data-pick'))
      })

      /* 币种对调 */
      dom.on(root, 'click', '#swap-sides', function () {
        var sell = view.sell
        view.sell = view.buy
        view.buy = sell
        dom.haptic()
        showAmountError('')
        paint()
      })

      /* 金额输入 */
      dom.on(root, 'input', '#sell-amount', function (e, el) {
        var v = sanitize(el.value)
        if (v !== el.value) el.value = v
        view.amount = v
        showAmountError('')
        paint()
      })

      /* 提交 */
      dom.on(root, 'click', '#submit-swap', function () {
        if (!view.canSubmit) {
          var ccy = findCcy(view.sell)
          var amount = parseFloat(view.amount) || 0
          var msg = amount <= 0 ? '请输入换汇金额' : '超出可用余额 ' + ccy.balanceText
          showAmountError(msg)
          PP.ui.toast(msg)
          return
        }
        showAmountError('')
        openConfirm()
      })

      ctx.onCleanup(function () {
        clearCountdown()
        view = null
      })
    },

    /** 离开页面（切走或返回）时停掉倒计时，避免后台继续跑 */
    hide: function () {
      clearCountdown()
    }
  })
})((window.PP = window.PP || {}))
