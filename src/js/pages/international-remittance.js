/* ============================================================
   pages/international-remittance.js · 国际汇款向导
   ------------------------------------------------------------
   职责：三步流转、币种选择、费用试算、表单校验、付款材料、结果页。
   费用算法与小程序版逐行对齐（常量与源文件一致）：
     手续费   = 金额 > 0 ? max(金额 × 0.1%, 15) : 0
     全额到账费 = 勾选「是」且金额 > 0 ? 25 : 0
     费用合计 = 手续费 + 全额到账费
     扣款金额 = 汇出金额 + 费用合计
     到账金额 = 金额 > 手续费 ? 金额 - 手续费 : 0
   注意最后一条是源实现的口径（不含全额到账费），此处保持不改。

   步骤条状态写成 data-state 属性，面板显隐用 hidden —— JS 不拼结构。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 币种与可用余额（演示数据，字段与接口同名） */
  var CURRENCIES = [
    { code: 'USD', name: '美元', flag: '🇺🇸', symbol: '$', balance: 128450.00, balanceText: '$ 128,450.00' },
    { code: 'EUR', name: '欧元', flag: '🇪🇺', symbol: '€', balance: 86420.50, balanceText: '€ 86,420.50' },
    { code: 'GBP', name: '英镑', flag: '🇬🇧', symbol: '£', balance: 53120.00, balanceText: '£ 53,120.00' },
    { code: 'JPY', name: '日元', flag: '🇯🇵', symbol: '¥', balance: 9800000, balanceText: '¥ 9,800,000' },
    { code: 'AUD', name: '澳元', flag: '🇦🇺', symbol: 'A$', balance: 41200.00, balanceText: 'A$ 41,200.00' },
    { code: 'CAD', name: '加元', flag: '🇨🇦', symbol: 'C$', balance: 37650.00, balanceText: 'C$ 37,650.00' }
  ]

  /** 费率规则（与源文件常量一致） */
  var FEE_RATE = 0.001      // 0.1%
  var FEE_MIN = 15          // 最低手续费
  var FULL_FEE = 25         // 全额到账费
  var MAX_FILE = 20 * 1024 * 1024 // 单个材料 20MB

  /** 汇款人（演示数据，与源文件一致） */
  var REMITTER = 'PPTRANSFER LIMITED'

  /** 校验错误 → 展示位与字段的映射 */
  var ERROR_TARGET = {
    currency: { box: '#err-currency', field: '#ccy-trigger' },
    name: { box: '#err-name', field: '#beneficiary-name' },
    account: { box: '#err-account', field: '#beneficiary-account' },
    swift: { box: '#err-swift', field: '#swift-code' },
    amount: { box: '#err-amount', field: '#amount' },
    password: { box: '#err-password', field: '#trade-password' }
  }

  /** 当前实例的可变状态；未挂载时为 null */
  var view = null

  function findCcy(code) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === code) return CURRENCIES[i]
    }
    return null
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n
  }

  function sanitize(raw) {
    var v = String(raw || '').replace(/[^\d.]/g, '')
    var firstDot = v.indexOf('.')
    if (firstDot >= 0) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
    }
    return v
  }

  /* ---------------------------------------------- 费用试算 */

  function calcFee() {
    var amt = parseFloat(view.amount) || 0
    var fee = amt > 0 ? Math.max(amt * FEE_RATE, FEE_MIN) : 0
    var full = view.fullArrival && amt > 0 ? FULL_FEE : 0
    var total = fee + full
    return { amt: amt, fee: fee, full: full, total: total, deduct: amt + total }
  }

  /** 金额带币种；为 0 时显示破折号（与源实现一致） */
  function money(value) {
    return value > 0 ? PP.format.fmtNum(value) + ' ' + view.currency : '—'
  }

  function paintFees() {
    var dom = PP.dom
    var f = calcFee()

    dom.qs('#s1-fee', view.root).textContent = money(f.fee)
    dom.qs('#s1-full', view.root).textContent = money(f.full)
    dom.qs('#s1-total', view.root).textContent = money(f.total)
    dom.qs('#s1-deduct', view.root).textContent = money(f.deduct)

    view.amountFmt = PP.format.fmtNum(f.amt)
    view.arriveFmt = PP.format.fmtNum(f.amt > f.fee && f.amt > 0 ? f.amt - f.fee : 0)
    view.feeBearer = view.fullArrival ? '付款人全额承担' : '共同承担/付款人'
  }

  /* ---------------------------------------------- 校验 */

  function clearError(key) {
    var t = ERROR_TARGET[key]
    if (!t) return
    var box = PP.dom.qs(t.box, view.root)
    var field = PP.dom.qs(t.field, view.root)
    if (box) {
      box.textContent = ''
      box.hidden = true
    }
    if (field) field.removeAttribute('aria-invalid')
  }

  function clearErrors() {
    Object.keys(ERROR_TARGET).forEach(clearError)
  }

  function showError(key, message) {
    clearErrors()
    var t = ERROR_TARGET[key]
    if (!t) return
    var box = PP.dom.qs(t.box, view.root)
    var field = PP.dom.qs(t.field, view.root)
    if (box) {
      box.textContent = message
      box.hidden = false
    }
    if (field) field.setAttribute('aria-invalid', 'true')
  }

  /** 返回 { key, message } 或 null；顺序与源实现 validate 一致 */
  function validate() {
    var amt = parseFloat(view.amount) || 0
    var ccy = findCcy(view.currency)

    if (!view.currency) return { key: 'currency', message: '请选择付款币种' }
    if (!view.beneficiaryName) return { key: 'name', message: '请输入收款人账户名称' }
    if (!view.beneficiaryAccount) return { key: 'account', message: '请输入收款人账号' }
    if (!view.swiftCode) return { key: 'swift', message: '请输入 Swift Code' }
    if (!(amt > 0)) return { key: 'amount', message: '请输入汇出金额' }
    if (ccy && amt > ccy.balance) return { key: 'amount', message: '超出可用余额 ' + ccy.balanceText }
    return null
  }

  function checkNext() {
    var amt = parseFloat(view.amount) || 0
    var ccy = findCcy(view.currency)
    view.canNext = !!(view.currency && view.beneficiaryName && view.beneficiaryAccount &&
      view.swiftCode && amt > 0 && ccy && amt <= ccy.balance)
    PP.dom.qs('#next-step', view.root)
      .setAttribute('aria-disabled', view.canNext ? 'false' : 'true')
    return view.canNext
  }

  /* ---------------------------------------------- 渲染 */

  function paintCcy() {
    var dom = PP.dom
    var ccy = findCcy(view.currency)
    var value = dom.qs('#ccy-value', view.root)
    var flag = dom.qs('#ccy-flag', view.root)

    value.textContent = view.currency || '请选择币种'
    if (view.currency) value.classList.remove('placeholder')
    else value.classList.add('placeholder')

    flag.hidden = !ccy
    if (ccy) flag.textContent = ccy.flag

    var hint = ccy ? '可用余额 ' + ccy.balanceText : ''
    ;['#ccy-balance', '#amount-balance'].forEach(function (sel) {
      var el = dom.qs(sel, view.root)
      el.textContent = hint
      el.hidden = !ccy
    })
    dom.qs('#full-fee-ccy', view.root).textContent = view.currency || ''
  }

  function paintFile() {
    var dom = PP.dom
    dom.qs('#upload-trigger', view.root).hidden = !!view.fileName
    dom.qs('#file-row', view.root).hidden = !view.fileName
    dom.qs('#file-name', view.root).textContent = view.fileName
  }

  function paintArrival() {
    PP.dom.qsa('[data-arrival]', view.root).forEach(function (el) {
      var on = (el.getAttribute('data-arrival') === '1') === view.fullArrival
      el.setAttribute('aria-checked', on ? 'true' : 'false')
    })
  }

  /** 第 2 步的确认信息 */
  function paintSummary() {
    var dom = PP.dom
    var f = calcFee()
    var cur = view.currency ? ' ' + view.currency : ''

    dom.qs('#s2-currency', view.root).textContent = view.currency
    dom.qs('#s2-name', view.root).textContent = view.beneficiaryName
    dom.qs('#s2-account', view.root).textContent = view.beneficiaryAccount
    dom.qs('#s2-swift', view.root).textContent = view.swiftCode
    dom.qs('#s2-remitter', view.root).textContent = view.remitter
    dom.qs('#s2-file', view.root).textContent = view.fileName || '未上传'
    dom.qs('#s2-remark', view.root).textContent = view.remark || '—'
    dom.qs('#s2-amount', view.root).textContent = view.amountFmt + cur
    dom.qs('#s2-fee', view.root).textContent = money(f.fee)
    dom.qs('#s2-bearer', view.root).textContent = view.feeBearer
    dom.qs('#s2-arrive', view.root).textContent = view.arriveFmt + cur
  }

  function renderStep() {
    var dom = PP.dom

    dom.qs('#panel-1', view.root).hidden = view.step !== 1
    dom.qs('#panel-2', view.root).hidden = view.step !== 2
    dom.qs('#panel-3', view.root).hidden = view.step !== 3

    dom.qsa('[data-step]', view.root).forEach(function (el) {
      var n = Number(el.getAttribute('data-step'))
      el.setAttribute('data-state', view.step > n ? 'done' : (view.step === n ? 'on' : 'off'))
      el.setAttribute('aria-current', view.step === n ? 'step' : 'false')
      var dot = el.querySelector('.step-dot')
      if (dot) dot.textContent = view.step > n ? '✓' : String(n)
    })

    dom.qsa('[data-line]', view.root).forEach(function (el) {
      var n = Number(el.getAttribute('data-line'))
      el.setAttribute('data-state', view.step > n ? 'on' : 'off')
    })
  }

  /** 步骤切换后回到页首，避免停在上一屏的滚动位置 */
  function scrollTop() {
    var box = view.root.parentNode
    if (box) box.scrollTop = 0
  }

  /* ---------------------------------------------- 流程 */

  function goStep(step) {
    view.step = step
    renderStep()
    scrollTop()
  }

  function goStep2() {
    var err = validate()
    if (err) {
      showError(err.key, err.message)
      PP.ui.toast(err.message)
      var field = PP.dom.qs(ERROR_TARGET[err.key].field, view.root)
      if (field && field.focus) field.focus({ preventScroll: false })
      return
    }
    clearErrors()
    paintFees()
    paintSummary()
    view.password = ''
    PP.dom.qs('#trade-password', view.root).value = ''
    PP.dom.qs('#submit-apply', view.root).setAttribute('aria-disabled', 'true')
    goStep(2)
  }

  function submitApply() {
    if (view.password.length !== 6) {
      showError('password', '请输入 6 位交易密码')
      PP.ui.toast('请输入 6 位交易密码')
      PP.dom.qs('#trade-password', view.root).focus()
      return
    }
    clearError('password')
    var now = new Date()
    view.refNo = 'IR' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      String(Date.now()).slice(-6)
    PP.dom.qs('#ref-no', view.root).textContent = view.refNo
    view.password = ''
    PP.dom.qs('#trade-password', view.root).value = ''
    PP.dom.qs('#submit-apply', view.root).setAttribute('aria-disabled', 'true')
    goStep(3)
  }

  function resetAll() {
    view.beneficiaryName = ''
    view.beneficiaryAccount = ''
    view.swiftCode = ''
    view.amount = ''
    view.amountFmt = '0.00'
    view.arriveFmt = '0.00'
    view.remark = ''
    view.fileName = ''
    view.password = ''
    view.refNo = ''
    view.canNext = false
    view.fullArrival = false

    var dom = PP.dom
    ;['#beneficiary-name', '#beneficiary-account', '#swift-code', '#amount', '#remark',
      '#trade-password'].forEach(function (sel) {
      var el = dom.qs(sel, view.root)
      if (el) el.value = ''
    })
    var file = dom.qs('#file-input', view.root)
    if (file) file.value = ''

    clearErrors()
    paintArrival()
    paintFile()
    paintFees()
    checkNext()
    goStep(1)
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('international-remittance', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = {
        root: root,
        ctx: ctx,
        step: 1,
        currency: '',
        beneficiaryName: '',
        beneficiaryAccount: '',
        swiftCode: '',
        amount: '',
        amountFmt: '0.00',
        arriveFmt: '0.00',
        fullArrival: false,
        remark: '',
        remitter: REMITTER,
        fileName: '',
        feeBearer: '共同承担/付款人',
        canNext: false,
        password: '',
        refNo: ''
      }

      paintCcy()
      paintArrival()
      paintFile()
      paintFees()
      checkNext()
      renderStep()

      /* 付款币种 */
      dom.on(root, 'click', '#ccy-trigger', function () {
        dom.haptic()
        PP.ui.picker({
          title: '选择付款币种',
          value: view.currency,
          options: CURRENCIES.map(function (c) {
            return {
              value: c.code,
              title: c.flag + ' ' + c.code,
              sub: '可用余额 ' + c.balanceText
            }
          })
        }).then(function (code) {
          if (!code || !view) return
          view.currency = code
          clearError('currency')
          paintCcy()
          paintFees()
          checkNext()
        })
      })

      /* 文本输入 */
      dom.on(root, 'input', '#beneficiary-name', function (e, el) {
        view.beneficiaryName = el.value
        clearError('name')
        checkNext()
      })
      dom.on(root, 'input', '#beneficiary-account', function (e, el) {
        view.beneficiaryAccount = el.value
        clearError('account')
        checkNext()
      })
      dom.on(root, 'input', '#swift-code', function (e, el) {
        var v = String(el.value || '').toUpperCase()
        if (v !== el.value) el.value = v
        view.swiftCode = v
        clearError('swift')
        checkNext()
      })
      dom.on(root, 'input', '#amount', function (e, el) {
        var v = sanitize(el.value)
        if (v !== el.value) el.value = v
        view.amount = v
        clearError('amount')
        paintFees()
        checkNext()
      })
      dom.on(root, 'input', '#remark', function (e, el) {
        view.remark = el.value
      })

      /* 全部余额 */
      dom.on(root, 'click', '#use-all', function () {
        var ccy = findCcy(view.currency)
        if (!ccy) {
          PP.ui.toast('请先选择付款币种')
          return
        }
        view.amount = String(ccy.balance)
        dom.qs('#amount', root).value = view.amount
        clearError('amount')
        paintFees()
        checkNext()
      })

      /* 是否全额到账 */
      dom.on(root, 'click', '[data-arrival]', function (e, el) {
        view.fullArrival = el.getAttribute('data-arrival') === '1'
        paintArrival()
        paintFees()
      })

      /* 付款材料 */
      dom.on(root, 'click', '#upload-trigger', function () {
        var input = dom.qs('#file-input', root)
        if (input) input.click()
      })
      dom.on(root, 'change', '#file-input', function (e, el) {
        var file = el.files && el.files[0]
        if (!file) return
        if (file.size > MAX_FILE) {
          el.value = ''
          PP.ui.toast('文件不能超过 20MB')
          return
        }
        view.fileName = file.name
        paintFile()
      })
      dom.on(root, 'click', '#file-remove', function () {
        view.fileName = ''
        var input = dom.qs('#file-input', root)
        if (input) input.value = ''
        paintFile()
      })

      /* 步骤流转 */
      dom.on(root, 'click', '#next-step', goStep2)
      dom.on(root, 'click', '#prev-step', function () { goStep(1) })
      dom.on(root, 'click', '#submit-apply', submitApply)
      dom.on(root, 'input', '#trade-password', function (e, el) {
        var v = String(el.value || '').replace(/\D/g, '').slice(0, 6)
        if (v !== el.value) el.value = v
        view.password = v
        if (v.length === 6) clearError('password')
        dom.qs('#submit-apply', root)
          .setAttribute('aria-disabled', v.length === 6 ? 'false' : 'true')
      })

      /* 结果页 */
      dom.on(root, 'click', '#copy-ref', function () {
        dom.copy(view.refNo).then(function () {
          PP.ui.toast('汇款单号已复制')
        }).catch(function () {
          PP.ui.toast('复制失败，请长按选择')
        })
      })
      dom.on(root, 'click', '#reset-all', resetAll)
      dom.on(root, 'click', '#finish', function () { ctx.back() })

      ctx.onCleanup(function () {
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
