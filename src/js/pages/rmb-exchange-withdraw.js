/* ============================================================
   pages/rmb-exchange-withdraw.js · 结汇提现（3 步向导）
   ------------------------------------------------------------
   职责：分步切换、金额与申报金额校验、提现账户选择、确认弹层、结果页。
   计算逻辑与文案逐行对齐小程序
   pages/rmb-exchange-withdraw/rmb-exchange-withdraw.js：
     手续费 = 金额 × 0.10%，到账 = 金额 − 手续费，
     下一步条件 = 金额 ≥ 100 且 0 < 申报合计 ≤ 金额。
   弹层统一走 PP.ui（confirm / picker / toast），页面不写遮罩结构。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 手续费率 0.10% */
  var FEE_RATE = 0.001
  /** 单笔最低提现金额（CNH） */
  var MIN_AMOUNT = 100
  /** 可结汇提现金额（演示数据） */
  var AVAILABLE = { symbol: '¥', value: 1000000 }

  /** 申报订单（演示数据，字段与接口同名） */
  var ORDER_ROWS = [
    {
      id: 'o1', no: 'ORD20260701001', contract: 'CT-2026-0701-A',
      buyer: 'Global Trade GmbH', goods: '消费电子配件',
      uploadTime: '2026-07-01', symbol: '$', amount: 12000
    },
    {
      id: 'o2', no: 'ORD20260628007', contract: 'CT-2026-0628-C',
      buyer: 'Sunrise Import LLC', goods: '家居家纺',
      uploadTime: '2026-06-28', symbol: '$', amount: 8600
    },
    {
      id: 'o3', no: 'ORD20260625013', contract: 'CT-2026-0625-B',
      buyer: 'Nordic Supplies AB', goods: '户外用品',
      uploadTime: '2026-06-25', symbol: '$', amount: 5200
    }
  ]

  /** 可选提现账户（演示数据；首项与小程序默认展示一致） */
  var WITHDRAW_ACCOUNTS = [
    { value: 'cmb-8888', title: '招商银行 · 6225 **** 8888（顾人）', sub: '默认提现账户' },
    { value: 'icbc-6301', title: '工商银行 · 6212 **** 6301（顾人）', sub: '对公账户' }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 工具 */

  /** '1,000,000.00' —— 提现相关金额一律两位小数 */
  function num(n) {
    return PP.format.fmtNum(n, 2)
  }

  /** 金额输入只保留数字与一个小数点，避免出现科学计数法一类的脏值 */
  function sanitize(raw) {
    var s = String(raw).replace(/[^\d.]/g, '')
    var dot = s.indexOf('.')
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
    return s
  }

  function text(sel, value) {
    var el = dom.qs(sel, view.root)
    if (el) el.textContent = value
  }

  function amountValue() {
    return parseFloat(view.amount) || 0
  }

  function declaredValue() {
    return view.rows.reduce(function (sum, r) {
      if (!r.checked || !r.declared) return sum
      return sum + (parseFloat(r.declared) || 0)
    }, 0)
  }

  function feeValue() {
    return amountValue() * FEE_RATE
  }

  function arrivalValue() {
    return Math.max(amountValue() - feeValue(), 0)
  }

  function canNext() {
    var amount = amountValue()
    var declared = declaredValue()
    return amount >= MIN_AMOUNT && declared > 0 && declared <= amount
  }

  /* ---------------------------------------------- 渲染 */

  function orderHTML(r) {
    var checked = !!r.checked
    return (
      '<li class="order" data-id="' + dom.esc(r.id) + '" data-selected="' + (checked ? 'true' : 'false') + '">' +
      '<button type="button" class="order-head" data-id="' + dom.esc(r.id) + '"' +
      ' aria-pressed="' + (checked ? 'true' : 'false') + '"' +
      ' aria-label="' + dom.esc('选择申报订单 ' + r.no) + '">' +
      '<span class="order-check" aria-hidden="true">' +
      '<svg aria-hidden="true"><use href="#i-check"/></svg></span>' +
      '<span class="order-head-body">' +
      '<span class="order-no">' + dom.esc(r.no) + '</span>' +
      '<span class="order-sub">合同编号 ' + dom.esc(r.contract) + '</span>' +
      '</span>' +
      '<span class="order-amount num">' + dom.esc(PP.format.withSymbol(r.symbol, r.amount)) + '</span>' +
      '</button>' +

      '<div class="order-meta">' +
      '<span class="order-meta-item">买方 ' + dom.esc(r.buyer) + '</span>' +
      '<span class="order-meta-item">商品 ' + dom.esc(r.goods) + '</span>' +
      '<span class="order-meta-item">上传 ' + dom.esc(r.uploadTime) + '</span>' +
      '</div>' +

      '<div class="order-declared"' + (checked ? '' : ' hidden') + '>' +
      '<label class="order-declared-label" for="declared-' + dom.esc(r.id) + '">订单申报金额</label>' +
      '<input class="order-declared-input" id="declared-' + dom.esc(r.id) + '"' +
      ' data-id="' + dom.esc(r.id) + '" type="text" inputmode="decimal" autocomplete="off"' +
      ' placeholder="0.00" value="' + dom.esc(r.declared || '') + '">' +
      '</div>' +
      '</li>'
    )
  }

  function renderOrders() {
    dom.setHTML(dom.qs('#order-list', view.root), dom.raw(view.rows.map(orderHTML).join('')))
    var checked = view.rows.filter(function (r) { return r.checked }).length
    dom.qs('#order-count', view.root).textContent =
      '共 ' + view.rows.length + ' 条 · 已选 ' + checked + ' 条'
  }

  /** 把所有派生金额与按钮可用态刷新一遍 */
  function refresh() {
    if (!view || !view.root) return

    text('#declared-total', num(declaredValue()) + ' CNH')
    text('#confirm-amount', num(amountValue()) + ' CNH')
    text('#confirm-fee', num(feeValue()) + ' CNH')
    text('#confirm-arrival', num(arrivalValue()) + ' CNH')

    var bad = view.amount !== '' && amountValue() < MIN_AMOUNT
    var input = dom.qs('#amount-input', view.root)
    var err = dom.qs('#amount-error', view.root)
    input.setAttribute('aria-invalid', bad ? 'true' : 'false')
    err.hidden = !bad
    err.textContent = bad ? '单笔最低 100.00 CNH' : ''

    // 用 aria-disabled 而不是 disabled：保留点击后说明原因的提示，
    // 与小程序里「按钮置灰但仍会 toast 原因」的行为一致
    dom.qs('#next-btn', view.root)
      .setAttribute('aria-disabled', canNext() ? 'false' : 'true')
    dom.qs('#submit-btn', view.root)
      .setAttribute('aria-disabled', view.pwd.length === 6 ? 'false' : 'true')
  }

  /* ---------------------------------------------- 分步 */

  function syncSteps() {
    dom.qsa('.step', view.root).forEach(function (li, i) {
      li.setAttribute('data-tone', i < view.step ? 'success' : (i === view.step ? 'blue' : 'neutral'))
      if (i === view.step) li.setAttribute('aria-current', 'step')
      else li.removeAttribute('aria-current')

      var dot = dom.qs('.step-dot', li)
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

  /* ---------------------------------------------- 提交 */

  function stamp() {
    var d = new Date()
    function pad(n) { return String(n).padStart(2, '0') }
    return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  }

  function submit() {
    view.orderNo = 'EXC' + stamp()
    text('#result-amount', num(amountValue()) + ' CNH')
    text('#result-arrival', num(arrivalValue()) + ' CNH')
    text('#result-order-no', view.orderNo)

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
        pwd: '',
        account: WITHDRAW_ACCOUNTS[0].value,
        orderNo: '',
        rows: ORDER_ROWS.map(function (r) {
          var row = Object.assign({}, r)
          row.checked = false
          row.declared = ''
          return row
        })
      }

      var offs = []
      function listen(type, sel, fn) { offs.push(dom.on(root, type, sel, fn)) }

      /* -------- 步骤 1：金额与申报订单 -------- */

      listen('click', '#fill-all', function () {
        view.amount = String(AVAILABLE.value)
        dom.qs('#amount-input', root).value = view.amount
        dom.haptic()
        refresh()
      })

      listen('input', '#amount-input', function (e, el) {
        var clean = sanitize(el.value)
        if (clean !== el.value) el.value = clean
        view.amount = clean
        refresh()
      })

      listen('click', '.order-head', function (e, btn) {
        var id = btn.getAttribute('data-id')
        view.rows = view.rows.map(function (r) {
          if (r.id !== id) return r
          var row = Object.assign({}, r)
          row.checked = !r.checked
          // 取消勾选时清掉已填的申报金额（与小程序一致）
          if (r.checked) row.declared = ''
          return row
        })
        renderOrders()
        refresh()
      })

      listen('input', '.order-declared-input', function (e, el) {
        var id = el.getAttribute('data-id')
        var clean = sanitize(el.value)
        if (clean !== el.value) el.value = clean
        view.rows.forEach(function (r) { if (r.id === id) r.declared = clean })
        refresh()
      })

      listen('click', '#next-btn', function () {
        if (!canNext()) {
          PP.ui.toast('请填写金额并关联申报订单')
          return
        }
        goStep(1)
      })

      /* -------- 步骤 2：确认信息 -------- */

      listen('click', '#prev-btn', function () { goStep(0) })

      listen('click', '#account-btn', function () {
        PP.ui.picker({
          title: '选择提现账户',
          value: view.account,
          options: WITHDRAW_ACCOUNTS
        }).then(function (value) {
          if (!value || !view) return
          view.account = value
          WITHDRAW_ACCOUNTS.forEach(function (a) {
            if (a.value === value) text('#confirm-account', a.title)
          })
        })
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
      text('#available-amount', PP.format.withSymbol(AVAILABLE.symbol, AVAILABLE.value))
      renderOrders()
      goStep(0)
      refresh()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
