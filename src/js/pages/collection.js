/* ============================================================
   pages/collection.js · 外贸收款账户
   ------------------------------------------------------------
   职责：账户列表渲染与筛选、账户详情弹层、筛选选择器、开通申请表单。
   数据与文案逐行对齐小程序 pages/collection/collection.js。
   弹层一律走 PP.ui（sheet / picker / toast），页面里不写遮罩结构。
   列表账号用 PP.format.maskAccount 脱敏，详情里展示完整账号。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 卡片上最多展示的币种标签数，超出折叠为 +N */
  var TAG_LIMIT = 7

  /** 筛选可选项（含「全部」哨兵值） */
  var ALL_REGION = '全部地区'
  var ALL_CURRENCY = '全部币种'
  var REGION_OPTIONS = [ALL_REGION, '全球', '香港地区']
  var CURRENCY_OPTIONS = [ALL_CURRENCY, 'USD', 'EUR', 'GBP', 'HKD', 'CNH', 'JPY', 'AUD', 'CAD', 'CHF', 'SGD']

  /** 收款账户（演示数据，字段与接口同名） */
  var ACCOUNTS = [
    {
      id: 'ocbc_hk', type: 'global', typeLabel: '全球收款账户',
      bankName: '华侨银行香港分行', bankNameEn: 'OCBC Hong Kong Branch',
      fullAccountNumber: '202-83740396',
      accountName: 'Shanghai Maoxue Information Technology Co., Ltd.',
      swiftCode: 'WHBHHKHHXXX',
      bankAddress: "161 Queen's Road Central, Central, Hong Kong",
      country: '中国香港',
      supportedCurrencies: ['AUD', 'CAD', 'CHF', 'CNH', 'DKK', 'EUR', 'GBP', 'HKD', 'JPY', 'NOK', 'NZD', 'SEK', 'SGD', 'USD'],
      paymentRegion: '全球', paymentMethod: '仅接受通过 SWIFT/FPS/CHATS 网络的付款',
      isDefault: true
    },
    {
      id: 'db_hk', type: 'global', typeLabel: '全球收款账户',
      bankName: '德意志银行香港分行', bankNameEn: 'Deutsche Bank Hong Kong Branch',
      fullAccountNumber: '008-11225245',
      accountName: 'Shanghai Maoxue Information Technology Co., Ltd.',
      swiftCode: 'DEUTHKHHXXX',
      bankAddress: 'Level 52, International Commerce Centre, 1 Austin Road West, Kowloon, Hong Kong',
      country: '中国香港',
      supportedCurrencies: ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'HKD', 'USD'],
      paymentRegion: '全球', paymentMethod: '仅接受通过 SWIFT 网络的付款',
      isDefault: false
    },
    {
      id: 'jpm_hk', type: 'global', typeLabel: '全球收款账户',
      bankName: '摩根大通银行香港分行', bankNameEn: 'JPMorgan Chase Hong Kong Branch',
      fullAccountNumber: '007-99881438',
      accountName: 'Shanghai Maoxue Information Technology Co., Ltd.',
      swiftCode: 'CHASHKHHXXX',
      bankAddress: 'Chater House, 8 Connaught Road Central, Hong Kong',
      country: '中国香港',
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'HKD'],
      paymentRegion: '全球', paymentMethod: 'SWIFT / CHATS',
      isDefault: false
    },
    {
      id: 'dbs_hk_local', type: 'local', typeLabel: '本地收款账户',
      bankName: '星展银行 (DBS)', bankNameEn: 'DBS Bank (Hong Kong) Limited',
      fullAccountNumber: '016-478-12348821',
      accountName: 'Shanghai Maoxue Information Technology Co., Ltd.',
      swiftCode: 'DBSSHKHH',
      bankAddress: "G/F, The Center, 99 Queen's Road Central, Hong Kong",
      country: '中国香港',
      supportedCurrencies: ['HKD', 'CNH'],
      paymentRegion: '香港地区', paymentMethod: 'FPS / CHATS / 转账',
      isDefault: false
    }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 工具 */

  /** 列表用脱敏账号：'202-83740396' → '****0396'（与小程序展示一致） */
  function maskedNo(a) {
    return PP.format.maskAccount(a.fullAccountNumber, 0, 4)
  }

  function byId(id) {
    for (var i = 0; i < ACCOUNTS.length; i++) {
      if (ACCOUNTS[i].id === id) return ACCOUNTS[i]
    }
    return null
  }

  function cardHTML(a) {
    var tags = a.supportedCurrencies.slice(0, TAG_LIMIT).map(function (c) {
      return '<span class="pill" data-tone="blue">' + dom.esc(c) + '</span>'
    }).join('')
    var more = a.supportedCurrencies.length - TAG_LIMIT
    if (more > 0) tags += '<span class="pill" data-tone="neutral">+' + more + '</span>'

    return (
      '<li>' +
      '<button type="button" class="acc-card" data-id="' + dom.esc(a.id) + '"' +
      ' aria-label="' + dom.esc(a.bankName + ' ' + maskedNo(a) + '，查看账户详情') + '">' +
      '<span class="acc-head">' +
      '<span class="tile" data-tone="success" aria-hidden="true">' +
      '<svg aria-hidden="true"><use href="#i-bldg"/></svg></span>' +
      '<span class="acc-head-body">' +
      '<span class="acc-name-row">' +
      '<span class="acc-name">' + dom.esc(a.bankName) + '</span>' +
      (a.isDefault ? '<span class="pill" data-tone="blue">默认</span>' : '') +
      '</span>' +
      '<span class="acc-sub">' + dom.esc(a.bankNameEn) + '</span>' +
      '</span>' +
      '<svg class="row-chev" aria-hidden="true"><use href="#i-chevron-right"/></svg>' +
      '</span>' +

      '<span class="acc-no-row">' +
      '<span class="acc-no num">' + dom.esc(maskedNo(a)) + '</span>' +
      '<span class="pill" data-tone="neutral">' + dom.esc(a.typeLabel) + '</span>' +
      '</span>' +

      '<span class="acc-tags">' + tags + '</span>' +

      '<span class="acc-foot">' +
      '<svg class="acc-foot-icon" aria-hidden="true"><use href="#i-globe"/></svg>' +
      '<span class="acc-foot-text">' + dom.esc(a.paymentMethod) + '</span>' +
      '<span class="acc-foot-count">' + a.supportedCurrencies.length + ' 种</span>' +
      '</span>' +
      '</button>' +
      '</li>'
    )
  }

  /**
   * 取页面里的 <template>，把 data-slot 占位符填上内容后返回 HTML 字符串。
   * 文本值走 textContent（天然转义），数组值渲染为一组 pill（仅币种用到）。
   */
  function fromTemplate(id, fill) {
    var tpl = dom.qs(id, view.root)
    if (!tpl) return ''
    var box = document.createElement('div')
    box.appendChild(tpl.content.cloneNode(true))

    Object.keys(fill).forEach(function (slot) {
      var el = dom.qs('[data-slot="' + slot + '"]', box)
      if (!el) return
      var v = fill[slot]
      if (Array.isArray(v)) {
        dom.setHTML(el, dom.raw(v.map(function (t) {
          return '<span class="pill" data-tone="neutral">' + dom.esc(t) + '</span>'
        }).join('')))
      } else {
        el.textContent = v
      }
    })
    return box.innerHTML
  }

  /* ---------------------------------------------- 列表与筛选 */

  function filtered() {
    return ACCOUNTS.filter(function (a) {
      if (view.type !== 'all' && a.type !== view.type) return false
      if (view.region && a.paymentRegion !== view.region) return false
      if (view.currency && a.supportedCurrencies.indexOf(view.currency) === -1) return false
      return true
    })
  }

  function renderList() {
    var root = view.root
    var list = filtered()
    dom.setHTML(dom.qs('#col-acct-list', root), dom.raw(list.map(cardHTML).join('')))
    dom.qs('#col-acct-empty', root).hidden = list.length > 0
    dom.qs('#acct-summary', root).textContent = '共 ' + list.length + ' 个账户 · 收款免费'
  }

  function syncFilters() {
    var root = view.root
    dom.qs('#region-label', root).textContent = view.region || ALL_REGION
    dom.qs('#currency-label', root).textContent = view.currency || ALL_CURRENCY
    dom.qs('[data-kind="region"]', root).setAttribute('aria-pressed', view.region ? 'true' : 'false')
    dom.qs('[data-kind="currency"]', root).setAttribute('aria-pressed', view.currency ? 'true' : 'false')
    dom.qs('#reset-filter', root).hidden = !(view.region || view.currency)
  }

  function openFilter(kind) {
    var isRegion = kind === 'region'
    var options = isRegion ? REGION_OPTIONS : CURRENCY_OPTIONS
    PP.ui.picker({
      title: isRegion ? '选择付款地区' : '选择币种',
      value: (isRegion ? view.region : view.currency) || (isRegion ? ALL_REGION : ALL_CURRENCY),
      options: options.map(function (v) { return { value: v, title: v } })
    }).then(function (val) {
      // val 为 null 表示用户直接关掉了选择器
      if (!val || !view) return
      if (isRegion) view.region = val === ALL_REGION ? '' : val
      else view.currency = val === ALL_CURRENCY ? '' : val
      syncFilters()
      renderList()
    })
  }

  /* ---------------------------------------------- 账户详情 */

  function copyInfo(a) {
    var text = [
      'Account name: ' + a.accountName,
      'Account no.: ' + a.fullAccountNumber,
      'SWIFT / BIC: ' + a.swiftCode,
      'Bank name: ' + a.bankNameEn,
      'Bank address: ' + a.bankAddress,
      'Country/Region: ' + a.country
    ].join('\n')

    dom.copy(text).then(
      function () { PP.ui.toast('账户信息已复制') },
      function () { PP.ui.toast('复制失败，请手动复制') }
    )
  }

  function openDetail(id) {
    var a = byId(id)
    if (!a) return

    PP.ui.sheet({
      title: a.bankName,
      body: fromTemplate('#detail-tpl', {
        'type-label': a.typeLabel,
        'ccy-count': a.supportedCurrencies.length + ' 种',
        'currencies': a.supportedCurrencies,
        'payment-region': a.paymentRegion,
        'payment-method': a.paymentMethod,
        'account-name': a.accountName,
        'account-number': a.fullAccountNumber,
        'swift': a.swiftCode,
        'bank-name-en': a.bankNameEn,
        'bank-address': a.bankAddress,
        'country': a.country
      }),
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-act="certify">账户证明</button>' +
        '<button type="button" class="btn btn--primary" data-act="copy">复制信息</button>' +
        '</div>',
      onMount: function (sheet) {
        var badge = dom.qs('[data-slot="default-badge"]', sheet)
        if (badge) badge.hidden = !a.isDefault

        dom.on(sheet, 'click', '[data-act]', function (e, btn) {
          if (btn.getAttribute('data-act') === 'certify') {
            PP.ui.toast('账户证明将发送至企业管理员邮箱')
            return
          }
          copyInfo(a)
        })
      }
    })
  }

  /* ---------------------------------------------- 开通收款账户 */

  function openApply() {
    var body = fromTemplate('#apply-tpl', {})
    if (!body) return

    PP.ui.sheet({
      title: '开通收款账户',
      body: body,
      footer:
        '<div class="sheet-footer col-apply-foot">' +
        '<button type="button" class="btn btn--primary" data-act="submit">提交申请</button>' +
        '<span class="col-apply-hint">提交后 1-2 个工作日完成审核，审核通过后账户自动开通</span>' +
        '</div>',
      onMount: function (sheet) {
        // 单选组：点谁谁选中。演示表单不提交数据，因此只同步选中态。
        function group(attr, stateAttr) {
          dom.on(sheet, 'click', '[' + attr + ']', function (e, btn) {
            dom.qsa('[' + attr + ']', sheet).forEach(function (b) {
              b.setAttribute(stateAttr, b === btn ? 'true' : 'false')
            })
          })
        }
        group('data-apply-type', 'aria-selected')
        group('data-apply-currency', 'aria-pressed')
        group('data-apply-region', 'aria-pressed')

        dom.on(sheet, 'click', '[data-act="submit"]', function () {
          sheet.close()
          PP.ui.toast('申请已提交，1-2 个工作日完成审核')
        })
      }
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('collection', {
    mount: function (root, ctx) {
      view = { root: root, type: 'all', region: '', currency: '' }

      var offs = []
      function listen(sel, fn) { offs.push(dom.on(root, 'click', sel, fn)) }

      listen('[data-type]', function (e, el) {
        view.type = el.getAttribute('data-type')
        dom.qsa('[data-type]', root).forEach(function (b) {
          b.setAttribute('aria-selected', b === el ? 'true' : 'false')
        })
        renderList()
      })

      listen('[data-kind]', function (e, el) { openFilter(el.getAttribute('data-kind')) })

      listen('#reset-filter', function () {
        view.region = ''
        view.currency = ''
        syncFilters()
        renderList()
      })

      listen('.acc-card', function (e, el) { openDetail(el.getAttribute('data-id')) })

      listen('#open-apply', openApply)

      renderList()
      syncFilters()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
