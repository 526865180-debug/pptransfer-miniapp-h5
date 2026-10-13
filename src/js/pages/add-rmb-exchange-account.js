/* ============================================================
   pages/add-rmb-exchange-account.js · 添加人民币结汇账户
   ------------------------------------------------------------
   参考 desktop 版 pages/add_rmb_exchange_account.html：
     步骤 1 账户所属 / 账户类型 / 开户地区 / 账户名称 / 银行账号 /
            银行名称 / 开户行支行号 / 别名，个人账户额外要 公司名称、
            统一信用代码、身份证号、历史采购合同
     步骤 2 授权声明（回填步骤 1 的账户信息）+ 交易密码 + 同意勾选
     步骤 3 申请成功
   账户类型切换只改 data-only="personal" 行的显隐，已填值留在 DOM 里，
   来回切换不会丢；提交时按类型决定是否校验个人账户字段。
   弹层统一走 PP.ui（picker / searchPicker / toast）。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 开户地区 */
  var REGIONS = [
    { value: '中国内地', title: '中国内地' },
    { value: '香港地区', title: '香港地区' },
    { value: '澳门地区', title: '澳门地区' },
    { value: '台湾地区', title: '台湾地区' }
  ]

  /** 银行（演示数据，sub 参与搜索：银行名称 / CNAPS 行号） */
  var BANKS = [
    { value: '招商银行', title: '招商银行', sub: 'CNAPS 308584000013' },
    { value: '工商银行', title: '工商银行', sub: 'CNAPS 102100099996' },
    { value: '建设银行', title: '建设银行', sub: 'CNAPS 105100000017' },
    { value: '中国银行', title: '中国银行', sub: 'CNAPS 104100000004' },
    { value: '农业银行', title: '农业银行', sub: 'CNAPS 103100000026' },
    { value: '交通银行', title: '交通银行', sub: 'CNAPS 301290000007' },
    { value: '浦发银行', title: '浦发银行', sub: 'CNAPS 310290000013' },
    { value: '中信银行', title: '中信银行', sub: 'CNAPS 302100011000' },
    { value: '民生银行', title: '民生银行', sub: 'CNAPS 305100000013' },
    { value: '兴业银行', title: '兴业银行', sub: 'CNAPS 309391000011' }
  ]

  /** 依所选银行生成开户支行（演示数据；CNAPS 前缀沿用银行自身的行号） */
  function branchesFor(bankName) {
    var bank = null
    BANKS.forEach(function (b) { if (b.value === bankName) bank = b })
    var base = (bank && /\d{12}/.exec(bank.sub)) ? String(/\d{12}/.exec(bank.sub)[0]) : '308584000013'
    var head = base.slice(0, 9)
    return [
      { value: head + '013', title: bankName + '深圳前海支行', sub: 'CNAPS ' + head + '013' },
      { value: head + '046', title: bankName + '深圳南山支行', sub: 'CNAPS ' + head + '046' },
      { value: head + '091', title: bankName + '深圳福田支行', sub: 'CNAPS ' + head + '091' }
    ]
  }

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 工具 */

  function val(sel) {
    var el = dom.qs(sel, view.root)
    return el ? el.value.trim() : ''
  }

  /** 去掉 4 位分组时插入的空格，得到原始账号 */
  function rawNum(sel) {
    return val(sel).replace(/\s+/g, '')
  }

  /** 长卡号按 4 位分组展示，如 6222 0202 0012 3456 789 */
  function group4(s) {
    return s.replace(/(\d{4})(?=\d)/g, '$1 ')
  }

  function setText(sel, text) {
    var el = dom.qs(sel, view.root)
    if (el) el.textContent = text
  }

  /** 个人账户专属行（企业账户时隐藏且不参与校验） */
  function isPersonal() { return view.type === 'personal' }

  function visibleRows() {
    return dom.qsa('[data-only="personal"]', view.root)
  }

  function syncTypeRows() {
    var personal = isPersonal()
    visibleRows().forEach(function (el) { el.hidden = !personal })
    /* 账户名称占位文案按类型切换（沿用 desktop 版细节） */
    var nameInput = dom.qs('#add-acct-name', view.root)
    if (nameInput) {
      nameInput.placeholder = personal
        ? '请输入'
        : '如：深圳市极光贸易有限公司'
    }
  }

  /* ---------------------------------------------- 行内校验 */

  /** 给字段所在 .frow 标红并滚动定位；返回行元素 */
  function showError(sel) {
    var el = dom.qs(sel, view.root)
    if (!el) return null
    var row = el.closest('.frow')
    if (row) row.classList.add('is-error')
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (el.focus) el.focus({ preventScroll: true })
    return row
  }

  /** 任何输入 / 选择都会清掉所在行的错误态 */
  function clearRowError(e, el) {
    var row = el.closest('.frow')
    if (row) row.classList.remove('is-error')
  }

  /** 步骤 1 的必填校验：返回第一个缺失项 { msg, sel } */
  function firstMissing() {
    if (!val('#add-acct-name')) return { msg: '请填写账户名称', sel: '#add-acct-name' }
    if (!rawNum('#add-acct-no')) return { msg: '请填写银行账号', sel: '#add-acct-no' }
    if (!view.bank) return { msg: '请选择银行名称', sel: '#add-bank-btn' }
    if (!view.branch) return { msg: '请选择开户行支行号', sel: '#add-branch-btn' }
    if (isPersonal()) {
      if (!val('#add-company-name')) return { msg: '请填写公司名称', sel: '#add-company-name' }
      if (!val('#add-credit-code')) return { msg: '请填写统一信用代码', sel: '#add-credit-code' }
      if (!val('#add-id-card')) return { msg: '请填写收款人身份证号', sel: '#add-id-card' }
    }
    return null
  }

  /** 把步骤 1 的账户信息同步到授权声明 */
  function syncAuth() {
    setText('#add-auth-bank', view.bank || '—')
    setText('#add-auth-name', val('#add-acct-name') || '—')
    setText('#add-auth-no', group4(rawNum('#add-acct-no')) || '—')
  }

  /* ---------------------------------------------- 列表渲染 */

  function fileRow(file, index) {
    var size = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + 'MB'
      : Math.ceil(file.size / 1024) + 'KB'
    return (
      '<li class="upload-item">' +
      '<svg class="upload-icon" aria-hidden="true"><use href="#i-doc"/></svg>' +
      '<span class="upload-name truncate">' + dom.esc(file.name) + '</span>' +
      '<span class="upload-size">' + dom.esc(size) + '</span>' +
      '<button type="button" class="upload-remove" data-index="' + index + '"' +
      ' aria-label="移除 ' + dom.esc(file.name) + '">' +
      '<svg aria-hidden="true"><use href="#i-close"/></svg>' +
      '</button>' +
      '</li>'
    )
  }

  function renderFiles() {
    var list = dom.qs('#add-upload-list', view.root)
    if (!list) return
    dom.setHTML(list, dom.raw(view.files.map(fileRow).join('')))
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
    var body = dom.qs('#app-body')
    if (body) body.scrollTop = 0
  }

  function refresh() {
    if (!view || !view.root) return
    dom.qs('#add-confirm-btn', view.root)
      .setAttribute('aria-disabled', (view.pwd.length === 6 && view.agreed) ? 'false' : 'true')
  }

  /* ---------------------------------------------- 选择器 */

  function pickRegion() {
    PP.ui.picker({
      title: '选择开户地区',
      value: view.region,
      options: REGIONS
    }).then(function (value) {
      if (!value || !view) return
      view.region = value
      setText('#add-region-value', value)
    })
  }

  function pickBank() {
    PP.ui.searchPicker({
      title: '选择银行名称',
      placeholder: '银行名称 / CNAPS 行号',
      value: view.bank,
      items: BANKS
    }).then(function (value) {
      if (!value || !view) return
      view.bank = value
      var el = dom.qs('#add-bank-value', view.root)
      el.textContent = value
      el.classList.remove('is-placeholder')
      /* 换银行后原支行不再有效，重置支行选择 */
      view.branch = ''
      view.branchTitle = ''
      var branch = dom.qs('#add-branch-value', view.root)
      branch.textContent = '请选择开户支行'
      branch.classList.add('is-placeholder')
    })
  }

  /** 支行号：依所选银行搜索选择（CNAPS 行号参与检索） */
  function pickBranch() {
    if (!view.bank) {
      PP.ui.toast('请先选择银行名称')
      showError('#add-bank-btn')
      return
    }
    PP.ui.searchPicker({
      title: '选择开户支行',
      placeholder: '支行名称 / CNAPS 行号',
      value: view.branch,
      items: branchesFor(view.bank)
    }).then(function (value) {
      if (!value || !view) return
      view.branch = value
      var items = branchesFor(view.bank)
      items.forEach(function (it) {
        if (String(it.value) === String(value)) view.branchTitle = it.title
      })
      var el = dom.qs('#add-branch-value', view.root)
      el.textContent = view.branchTitle || value
      el.classList.remove('is-placeholder')
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('add-rmb-exchange-account', {
    mount: function (root, ctx) {
      view = {
        root: root,
        step: 0,
        owner: 'company',
        type: 'enterprise',
        region: '中国内地',
        bank: '',
        branch: '',
        branchTitle: '',
        files: [],
        pwd: '',
        agreed: false
      }

      var offs = []
      function listen(type, sel, fn) { offs.push(dom.on(root, type, sel, fn)) }

      /* -------- 行内错误态：任何输入/选择都清掉所在行的标红 -------- */

      listen('input', '.field-input', clearRowError)
      listen('click', '.select-field', clearRowError)
      listen('click', '.radio-pill', clearRowError)

      /* -------- 单选：账户所属 / 账户类型 -------- */

      listen('click', '[data-owner]', function (e, el) {
        if (el.getAttribute('aria-checked') === 'true') return
        dom.qsa('[data-owner]', root).forEach(function (b) {
          b.setAttribute('aria-checked', b === el ? 'true' : 'false')
        })
        view.owner = el.getAttribute('data-owner')
      })

      listen('click', '[data-type]', function (e, el) {
        if (el.getAttribute('aria-checked') === 'true') return
        dom.qsa('[data-type]', root).forEach(function (b) {
          b.setAttribute('aria-checked', b === el ? 'true' : 'false')
        })
        view.type = el.getAttribute('data-type')
        syncTypeRows()
      })

      /* -------- 开户地区 / 银行名称 -------- */

      listen('click', '#add-region-btn', pickRegion)
      listen('click', '#add-bank-btn', pickBank)
      listen('click', '#add-branch-btn', pickBranch)

      /* -------- 银行账号：失焦时按 4 位分组展示，存值始终去空格 -------- */

      listen('input', '#add-acct-no', function (e, el) {
        el.value = el.value.replace(/[^\d\s]/g, '')
      })
      listen('focusout', '#add-acct-no', function (e, el) {
        el.value = group4(el.value.replace(/\s+/g, ''))
      })

      /* -------- 历史采购合同上传 -------- */

      listen('change', '#add-contract-file', function (e, el) {
        Array.prototype.slice.call(el.files || []).forEach(function (f) {
          view.files.push(f)
        })
        el.value = ''
        renderFiles()
      })

      listen('click', '.upload-remove', function (e, el) {
        view.files.splice(Number(el.getAttribute('data-index')), 1)
        renderFiles()
      })

      /* -------- 分步 -------- */

      listen('click', '#add-next-btn', function () {
        var missing = firstMissing()
        if (missing) {
          PP.ui.toast(missing.msg)
          showError(missing.sel)
          return
        }
        syncAuth()
        goStep(1)
      })

      listen('click', '#add-prev-btn', function () { goStep(0) })

      listen('input', '#add-trade-pwd', function (e, el) {
        view.pwd = el.value
        refresh()
      })

      listen('change', '#add-agree', function (e, el) {
        view.agreed = el.checked
        refresh()
      })

      listen('click', '#add-confirm-btn', function () {
        if (view.pwd.length !== 6) {
          PP.ui.toast('请输入 6 位交易密码')
          return
        }
        if (!view.agreed) {
          PP.ui.toast('请阅读并同意授权声明')
          return
        }
        setText('#add-result-name', val('#add-acct-name'))
        setText('#add-result-no', PP.format.maskAccount(rawNum('#add-acct-no')))
        setText('#add-result-region', view.region)
        goStep(2)
        dom.haptic()
      })

      /* -------- 初始状态 -------- */
      syncTypeRows()
      renderFiles()
      goStep(0)
      refresh()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
