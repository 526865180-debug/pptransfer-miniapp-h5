/* ============================================================
   pages/rmb-exchange-withdraw.js · 结汇提现
   ------------------------------------------------------------
   职责：金额双向计算、提现至单选、结汇提现账户搜索选择、
         分步切换、确认弹层、结果页。
   金额规则：
     基础手续费 = 提现金额 × 0.10%
     到账金额   = 提现金额 − 手续费
     反算       = 到账金额 ÷ (1 − 0.10%)
   两个输入框「最后编辑的为准」：改提现金额 → 刷到账金额；
   改到账金额 → 反算提现金额。手续费未定前显示 “-- CNH”。
   弹层统一走 PP.ui（sheet / confirm / toast），页面不写遮罩结构。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 手续费率 0.10% */
  var FEE_RATE = 0.001
  /** 可提现金额（CNH，演示数据） */
  var AVAILABLE = 997

  /** 结汇提现账户（演示数据；sub 用于搜索：账户名称/备注名/卡号/银行名称） */
  var ACCOUNTS = [
    { value: 'cmb-8888', title: '招商银行 · 6225 **** 8888', sub: '顾人 · 备注：主账户' },
    { value: 'icbc-6301', title: '工商银行 · 6212 **** 6301', sub: '对公账户 · 备注：货款' },
    { value: 'ccb-2044', title: '建设银行 · 6217 **** 2044', sub: '顾人 · 备注：备用' },
    { value: 'boc-7715', title: '中国银行 · 6216 **** 7715', sub: '财务部 · 备注：结算' },
    { value: 'comm-0913', title: '交通银行 · 6222 **** 0913', sub: '顾人 · 备注：供应商付款' },
    { value: 'spdb-3308', title: '浦发银行 · 6225 **** 3308', sub: '极光科技 · 备注：对私' }
  ]

  var TO_LABELS = { company: '本公司', supplier: '供应商' }

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 工具 */

  /** '997.00' —— 提现相关金额一律两位小数 */
  function num(n) {
    return PP.format.fmtNum(n, 2)
  }

  /** 保留两位的合法浮点 */
  function round2(n) {
    return Math.round(n * 100) / 100
  }

  /** 金额输入只保留数字与一个小数点 */
  function sanitize(raw) {
    var s = String(raw).replace(/[^\d.]/g, '')
    var dot = s.indexOf('.')
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
    return s
  }

  function amountValue() { return parseFloat(view.amount) || 0 }
  function arrivalValue() { return parseFloat(view.arrival) || 0 }
  function feeValue() { return round2(amountValue() * FEE_RATE) }

  function canNext() {
    var amount = amountValue()
    return amount > 0 && amount <= AVAILABLE &&
      arrivalValue() > 0 && !!view.account
  }

  /** 下一步不可用时的原因，用于点击置灰按钮后的 toast */
  function nextBlocker() {
    if (amountValue() <= 0) return '请输入提现金额'
    if (amountValue() > AVAILABLE) return '超过可提现金额 ' + num(AVAILABLE) + ' CNH'
    if (!view.account) return '请选择结汇提现账户'
    if (arrivalValue() <= 0) return '请确认到账金额'
    return ''
  }

  /* ---------------------------------------------- 渲染 */

  function refresh() {
    if (!view || !view.root) return

    // 手续费：金额未填时保持截图中的 “-- CNH”
    dom.qs('#fee-value', view.root).textContent =
      amountValue() > 0 ? num(feeValue()) + ' CNH' : '-- CNH'

    var bad = view.amount !== '' && amountValue() > AVAILABLE
    var input = dom.qs('#amount-input', view.root)
    var err = dom.qs('#amount-error', view.root)
    input.setAttribute('aria-invalid', bad ? 'true' : 'false')
    err.hidden = !bad
    err.textContent = bad ? '超过可提现金额 ' + num(AVAILABLE) + ' CNH' : ''

    dom.qs('#next-btn', view.root)
      .setAttribute('aria-disabled', canNext() ? 'false' : 'true')
    dom.qs('#submit-btn', view.root)
      .setAttribute('aria-disabled', view.pwd.length === 6 ? 'false' : 'true')
  }

  /* ---------------------------------------------- 账户搜索选择 */

  function pickAccount() {
    PP.ui.searchPicker({
      title: '选择结汇提现账户',
      placeholder: '账户名称/备注名/卡号/银行名称',
      value: view.account,
      items: ACCOUNTS
    }).then(function (value) {
      if (!value || !view) return
      view.account = value
      ACCOUNTS.forEach(function (a) {
        if (a.value !== value) return
        var el = dom.qs('#account-value', view.root)
        el.textContent = a.title
        el.classList.remove('is-placeholder')
      })
      dom.haptic()
      refresh()
    })
  }

  /* ---------------------------------------------- 分步 */

  function syncSteps() {
    dom.qsa('.wz-step', view.root).forEach(function (li, i) {
      li.setAttribute('data-tone', i < view.step ? 'success' : (i === view.step ? 'blue' : 'neutral'))
      if (i === view.step) li.setAttribute('aria-current', 'step')
      else li.removeAttribute('aria-current')

      var dot = dom.qs('.wz-dot', li)
      if (i < view.step) dom.setHTML(dot, dom.raw('<svg aria-hidden="true"><use href="#i-check"/></svg>'))
      else dot.textContent = String(i + 1)
    })
  }

  function goStep(step) {
    view.step = step
    dom.qsa('.wizard-step', view.root).forEach(function (el) {
      el.hidden = Number(el.getAttribute('data-step')) !== step
    })
    syncSteps()
    // 步骤切换后回到顶部，避免停在上一屏的滚动位置
    var body = dom.qs('#app-body')
    if (body) body.scrollTop = 0
  }

  /** 进入确认步骤前，把步骤 1 的选择同步到确认卡 */
  function syncConfirm() {
    dom.qs('#confirm-amount', view.root).textContent = num(amountValue()) + ' CNH'
    dom.qs('#confirm-to', view.root).textContent = TO_LABELS[view.to]
    var acct = ACCOUNTS.filter(function (a) { return a.value === view.account })[0]
    dom.qs('#confirm-account', view.root).textContent = acct ? acct.title : '--'
    dom.qs('#confirm-fee', view.root).textContent = num(feeValue()) + ' CNH'
    dom.qs('#confirm-arrival', view.root).textContent = num(arrivalValue()) + ' CNH'
    var memoRow = dom.qs('#confirm-memo-row', view.root)
    memoRow.hidden = !view.memo
    dom.qs('#confirm-memo', view.root).textContent = view.memo
  }

  /* ---------------------------------------------- 提交 */

  function stamp() {
    var d = new Date()
    function pad(n) { return String(n).padStart(2, '0') }
    return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  }

  function submit() {
    view.orderNo = 'EXC' + stamp()
    dom.qs('#result-amount', view.root).textContent = num(amountValue()) + ' CNH'
    dom.qs('#result-arrival', view.root).textContent = num(arrivalValue()) + ' CNH'
    dom.qs('#result-order-no', view.root).textContent = view.orderNo

    var pwd = dom.qs('#pwd-input', view.root)
    pwd.value = ''
    view.pwd = ''

    goStep(2)
    dom.haptic()
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('rmb-exchange-withdraw', {
    mount: function (root, ctx) {
      view = {
        root: root,
        step: 0,
        amount: '',
        arrival: '',
        to: 'company',
        account: null,
        memo: '',
        pwd: '',
        orderNo: ''
      }

      var offs = []
      function listen(type, sel, fn) { offs.push(dom.on(root, type, sel, fn)) }

      /* -------- 金额双向计算 -------- */

      // 改提现金额 → 重算到账金额
      listen('input', '#amount-input', function (e, el) {
        var clean = sanitize(el.value)
        if (clean !== el.value) el.value = clean
        view.amount = clean
        var amount = amountValue()
        var arrival = amount > 0 ? String(round2(amount * (1 - FEE_RATE))) : ''
        view.arrival = arrival
        dom.qs('#arrival-input', root).value = arrival
        refresh()
      })

      // 改到账金额 → 反算提现金额
      listen('input', '#arrival-input', function (e, el) {
        var clean = sanitize(el.value)
        if (clean !== el.value) el.value = clean
        view.arrival = clean
        var arrival = arrivalValue()
        var amount = arrival > 0 ? String(round2(arrival / (1 - FEE_RATE))) : ''
        view.amount = amount
        dom.qs('#amount-input', root).value = amount
        refresh()
      })

      listen('click', '#fill-all', function () {
        view.amount = String(AVAILABLE)
        dom.qs('#amount-input', root).value = view.amount
        var arrival = String(round2(AVAILABLE * (1 - FEE_RATE)))
        view.arrival = arrival
        dom.qs('#arrival-input', root).value = arrival
        dom.haptic()
        refresh()
      })

      /* -------- 提现至单选 -------- */

      listen('click', '.radio-pill', function (e, el) {
        if (el.getAttribute('aria-checked') === 'true') return
        dom.qsa('.radio-pill', root).forEach(function (b) {
          b.setAttribute('aria-checked', b === el ? 'true' : 'false')
        })
        view.to = el.getAttribute('data-value')
        dom.haptic()
      })

      /* -------- 结汇提现账户 -------- */

      listen('click', '#account-btn', pickAccount)

      /* -------- 分步与提交 -------- */

      listen('click', '#next-btn', function () {
        var blocker = nextBlocker()
        if (blocker) {
          PP.ui.toast(blocker)
          return
        }
        syncConfirm()
        goStep(1)
      })

      listen('click', '#prev-btn', function () { goStep(0) })

      listen('input', '#memo-input', function (e, el) {
        view.memo = el.value.trim()
      })

      listen('input', '#pwd-input', function (e, el) {
        view.pwd = el.value
        refresh()
      })

      listen('click', '#submit-btn', function () {
        if (view.pwd.length !== 6) {
          PP.ui.toast('请输入 6 位交易密码')
          return
        }
        PP.ui.confirm({
          title: '确认提交',
          content: '本次结汇提现 ' + num(amountValue()) + ' CNH，到账 ' +
            num(arrivalValue()) + ' CNH，确认提交？',
          confirmText: '确认提交'
        }).then(function (ok) {
          if (ok && view) submit()
        })
      })

      /* -------- 初始状态 -------- */
      goStep(0)
      refresh()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
