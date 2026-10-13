/* ============================================================
   pages/trade-collection.js · 外贸收款管理
   ------------------------------------------------------------
   职责：按状态分段 / 搜索词 / 筛选条件过滤收款记录并渲染卡片列表，
   以及详情、分配业务员、回单、导出明细四个动作。
   演示数据放在文件顶部的大写常量里，字段名与小程序源码保持一致，
   换成接口数据时只需替换 COLLECTIONS 与 decorate()。

   筛选弹层内编辑的是 draft（草稿），点「查询」才写回 filters ——
   与小程序一致，避免边改边筛导致列表跳动。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 收款状态 → 徽章色调（对应小程序 STATUS_CLASS 的 绿 / 橙 / 红） */
  var STATUS_TONE = { '已入账': 'success', '审核中': 'warning', '已驳回': 'danger' }

  /** 收款账号筛选项（源页面 fAccount 下拉） */
  var ACCOUNT_OPTIONS = ['全部账号', '7968710000000029', '1519342219826434048', '1519344936053510144']

  /** 业务员选项（源页面 assignSales 下拉） */
  var SALES_OPTIONS = ['未分配', '张伟', '李娜', '王芳', '赵强', '陈敏', '刘洋', '周婷', '吴刚', '孙丽', '黄磊']

  /** 收款记录（演示数据，源 trade_collection.html collData 的 10 条原样迁入） */
  var COLLECTIONS = [
    { id: 'c1', no: '1523737768042303488', time: '2026-07-16 09:15:22', status: '已入账', payer: 'LLC ARCADIA & GEORGIA', amount: 3000.00, currency: 'USD', account: '7968710000000029', payerAccount: 'US123456789012', bic: 'BOFAUS3N', country: '美国', sales: '张伟', note: '货款 INVOICE #2026-0716' },
    { id: 'c2', no: '1523737768042303489', time: '2026-07-16 08:42:10', status: '已驳回', payer: 'SUNRISE TRADING CO., LTD', amount: 12500.00, currency: 'CNH', account: '1519342219826434048', payerAccount: 'HK987654321098', bic: 'HSBCHKHH', country: '中国香港', sales: '李娜', note: '服务费' },
    { id: 'c3', no: '1523737768042303490', time: '2026-07-15 16:28:35', status: '审核中', payer: 'GLOBAL MERCHANDISE INC', amount: 8200.00, currency: 'USD', account: '7968710000000029', payerAccount: 'US987654321001', bic: 'CHASUS33', country: '美国', sales: '王芳', note: '合同号 CT2026-0715' },
    { id: 'c4', no: '1523737768042303491', time: '2026-07-15 14:10:05', status: '已入账', payer: 'EURO IMPORT GMBH', amount: 15000.00, currency: 'EUR', account: '1519344936053510144', payerAccount: 'DE1234567890', bic: 'DEUTDEFF', country: '德国', sales: '赵强', note: '设备尾款' },
    { id: 'c5', no: '1523737768042303492', time: '2026-07-15 11:33:48', status: '已驳回', payer: 'TOKYO ELECTRONICS KK', amount: 5800.00, currency: 'CNH', account: '1519342219826434048', payerAccount: 'JP112233445566', bic: 'BOTKJPJT', country: '日本', sales: '陈敏', note: '样品费' },
    { id: 'c6', no: '1523737768042303493', time: '2026-07-14 17:55:12', status: '审核中', payer: 'ASIA PACIFIC TRADING PTE', amount: 22000.00, currency: 'USD', account: '7968710000000029', payerAccount: 'SG556677889900', bic: 'DBSSSGSG', country: '新加坡', sales: '刘洋', note: '订单 #PO20260714-001' },
    { id: 'c7', no: '1523737768042303494', time: '2026-07-14 09:20:33', status: '已入账', payer: 'BRITISH IMPORT LTD', amount: 4500.00, currency: 'USD', account: '1519344936053510144', payerAccount: 'GB998877665544', bic: 'BARCGB22', country: '英国', sales: '周婷', note: '咨询费' },
    { id: 'c8', no: '1523737768042303495', time: '2026-07-14 08:05:47', status: '已驳回', payer: 'CANADA EXPORT CORP', amount: 9999.00, currency: 'CNH', account: '1519342219826434048', payerAccount: 'CA112233445566', bic: 'ROYCCAT2', country: '加拿大', sales: '吴刚', note: '退款' },
    { id: 'c9', no: '1523737768042303496', time: '2026-07-13 15:40:19', status: '审核中', payer: 'AUSTRALIA PTY TRADING', amount: 7200.00, currency: 'USD', account: '7968710000000029', payerAccount: 'AU778899001122', bic: 'ANZBAU3M', country: '澳大利亚', sales: '孙丽', note: '运费结算' },
    { id: 'c10', no: '1523737768042303497', time: '2026-07-13 10:18:56', status: '已入账', payer: 'KOREA TRADING CO', amount: 6300.00, currency: 'CNH', account: '1519344936053510144', payerAccount: 'KR334455667788', bic: 'KOEXKRSE', country: '韩国', sales: '黄磊', note: '模具费' }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 数据 */

  function decorate(a) {
    return Object.assign({}, a, {
      statusTone: STATUS_TONE[a.status] || 'warning',
      amountText: PP.format.fmtNum(a.amount) + ' ' + a.currency
    })
  }

  function emptyFilters() {
    return { startDate: '', endDate: '', accountIndex: 0, payer: '', currency: '', min: '', max: '' }
  }

  function findById(id) {
    for (var i = 0; i < view.list.length; i++) {
      if (view.list[i].id === id) return view.list[i]
    }
    return null
  }

  /* ---------------------------------------------- 渲染 */

  function rowHTML(a) {
    return (
      '<li class="coll-card">' +
        '<button type="button" class="cc-main" data-act="detail" data-id="' + dom.esc(a.id) + '"' +
          ' aria-label="查看收款 ' + dom.esc(a.no) + ' 的详情">' +
          '<span class="cc-top">' +
            '<span class="cc-no">' + dom.esc(a.no) + '</span>' +
            '<span class="pill cc-status" data-tone="' + a.statusTone + '">' + dom.esc(a.status) + '</span>' +
          '</span>' +
          '<span class="cc-mid">' +
            '<span class="cc-payer-wrap">' +
              '<span class="cc-payer">' + dom.esc(a.payer) + '</span>' +
              '<span class="cc-meta num">' + dom.esc(a.time) + ' · ' + dom.esc(a.country) + '</span>' +
            '</span>' +
            '<span class="cc-amount num" data-amount>+' + dom.esc(a.amountText) + '</span>' +
          '</span>' +
          '<span class="cc-note">附言：' + dom.esc(a.note) + '</span>' +
        '</button>' +
        '<div class="cc-bottom">' +
          '<button type="button" class="cc-sales" data-act="assign" data-id="' + dom.esc(a.id) + '"' +
            ' aria-label="分配业务员，当前 ' + dom.esc(a.sales) + '">' +
            '<svg aria-hidden="true"><use href="#i-user"/></svg>' +
            '<span>' + dom.esc(a.sales) + '</span>' +
          '</button>' +
          '<div class="cc-ops">' +
            '<button type="button" class="cc-op" data-act="detail" data-id="' + dom.esc(a.id) + '">详情</button>' +
            '<button type="button" class="cc-op" data-act="receipt" data-id="' + dom.esc(a.id) + '">回单</button>' +
            '<button type="button" class="cc-op" data-act="assign" data-id="' + dom.esc(a.id) + '">分配</button>' +
          '</div>' +
        '</div>' +
      '</li>'
    )
  }

  function render() {
    var listEl = dom.qs('#tc-list', view.root)
    dom.renderList(listEl, view.rows, rowHTML)
    dom.toggle(listEl, view.rows.length > 0)
    dom.toggle(dom.qs('#tc-empty', view.root), view.rows.length === 0)
    dom.qs('#tc-count', view.root).textContent = '共 ' + view.rows.length + ' 条收款记录'
  }

  function refreshCounts() {
    var c = { all: view.list.length, credited: 0, reviewing: 0, rejected: 0 }
    view.list.forEach(function (a) {
      if (a.status === '已入账') c.credited += 1
      else if (a.status === '审核中') c.reviewing += 1
      else if (a.status === '已驳回') c.rejected += 1
    })
    Object.keys(c).forEach(function (k) {
      var el = dom.qs('[data-count="' + k + '"]', view.root)
      if (el) el.textContent = String(c[k])
    })
  }

  /* ---------------------------------------------- 过滤 */

  function getFiltered() {
    var f = view.filters
    var seg = view.statusSeg
    var kw = view.searchText.trim().toLowerCase()
    var s = f.startDate ? f.startDate + ' 00:00:00' : ''
    var e = f.endDate ? f.endDate + ' 23:59:59' : ''
    var account = f.accountIndex > 0 ? ACCOUNT_OPTIONS[f.accountIndex] : ''
    var min = parseFloat(f.min)
    var max = parseFloat(f.max)

    return view.list.filter(function (a) {
      if (s && a.time < s) return false
      if (e && a.time > e) return false
      if (account && a.account !== account) return false
      if (f.payer && a.payer.toLowerCase().indexOf(f.payer.toLowerCase()) === -1) return false
      if (f.currency && a.currency !== f.currency) return false
      if (seg && a.status !== seg) return false
      if (f.min !== '' && !isNaN(min) && a.amount < min) return false
      if (f.max !== '' && !isNaN(max) && a.amount > max) return false
      if (kw && (a.no + ' ' + a.payer + ' ' + a.note).toLowerCase().indexOf(kw) === -1) return false
      return true
    })
  }

  function countActiveFilters() {
    var f = view.filters
    var n = 0
    if (f.startDate) n += 1
    if (f.endDate) n += 1
    if (f.accountIndex > 0) n += 1
    if (f.payer) n += 1
    if (f.currency) n += 1
    if (f.min || f.max) n += 1
    return n
  }

  function syncFilterBadge() {
    var n = countActiveFilters()
    var badge = dom.qs('#tc-filter-badge', view.root)
    var btn = dom.qs('#tc-filter', view.root)
    badge.textContent = String(n)
    badge.hidden = n <= 0
    btn.setAttribute('data-active', n > 0 ? 'true' : 'false')
    btn.setAttribute('aria-label', n > 0 ? '筛选，已生效 ' + n + ' 项条件' : '筛选')
  }

  function applyFilters() {
    view.rows = getFiltered()
    syncFilterBadge()
    render()
  }

  /* ---------------------------------------------- 筛选弹层 */

  function ccySegHTML(ccy) {
    return ['', 'USD', 'CNH', 'EUR'].map(function (c) {
      return '<button type="button" class="seg-item" role="tab" data-ccy="' + c + '"' +
        ' aria-selected="' + (c === ccy ? 'true' : 'false') + '">' + (c || '全部') + '</button>'
    }).join('')
  }

  function filterBody() {
    return (
      '<div class="field">' +
        '<label class="field-label" for="tc-f-start">收款时间</label>' +
        '<div class="date-row">' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="tc-f-start" aria-label="开始日期">' +
          '</div>' +
          '<span class="date-sep" aria-hidden="true">至</span>' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="tc-f-end" aria-label="结束日期">' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="tc-f-account">收款账号</label>' +
        '<button type="button" class="date-box tc-pick" id="tc-f-account" data-empty="true"' +
          ' aria-haspopup="dialog">全部账号</button>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="tc-f-payer">付款方名称</label>' +
        '<input type="text" class="field-input" id="tc-f-payer" placeholder="请输入付款方名称">' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="tc-ccy-label">收款币种</span>' +
        '<div class="seg" role="tablist" aria-labelledby="tc-ccy-label">' + ccySegHTML('') + '</div>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label">金额范围</span>' +
        '<div class="date-row">' +
          '<input type="text" inputmode="decimal" class="field-input tc-amt" id="tc-f-min"' +
            ' placeholder="最小金额" aria-label="最小金额">' +
          '<span class="date-sep" aria-hidden="true">至</span>' +
          '<input type="text" inputmode="decimal" class="field-input tc-amt" id="tc-f-max"' +
            ' placeholder="最大金额" aria-label="最大金额">' +
        '</div>' +
      '</div>'
    )
  }

  function syncAccount(root, draft) {
    var btn = dom.qs('#tc-f-account', root)
    btn.textContent = ACCOUNT_OPTIONS[draft.accountIndex]
    btn.setAttribute('data-empty', draft.accountIndex > 0 ? 'false' : 'true')
  }

  function syncCcy(root, ccy) {
    dom.qsa('[data-ccy]', root).forEach(function (el) {
      el.setAttribute('aria-selected', el.getAttribute('data-ccy') === ccy ? 'true' : 'false')
    })
  }

  function syncFilterForm(root, draft) {
    dom.qs('#tc-f-start', root).value = draft.startDate
    dom.qs('#tc-f-end', root).value = draft.endDate
    dom.qs('#tc-f-payer', root).value = draft.payer
    dom.qs('#tc-f-min', root).value = draft.min
    dom.qs('#tc-f-max', root).value = draft.max
    syncAccount(root, draft)
    syncCcy(root, draft.currency)
  }

  function openFilter() {
    // 草稿：弹层内随便改，点「查询」才生效
    var draft = Object.assign({}, view.filters)

    var sheet = PP.ui.sheet({
      title: '筛选条件',
      body: filterBody(),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-reset>重置</button>' +
          '<button type="button" class="btn btn--primary" data-apply>查询</button>' +
        '</div>',
      onMount: function (root) {
        syncFilterForm(root, draft)

        dom.on(root, 'change', '#tc-f-start', function (e, el) { draft.startDate = el.value })
        dom.on(root, 'change', '#tc-f-end', function (e, el) { draft.endDate = el.value })
        dom.on(root, 'input', '#tc-f-payer', function (e, el) { draft.payer = el.value })
        dom.on(root, 'input', '#tc-f-min', function (e, el) { draft.min = el.value })
        dom.on(root, 'input', '#tc-f-max', function (e, el) { draft.max = el.value })

        dom.on(root, 'click', '#tc-f-account', function () {
          PP.ui.picker({
            title: '收款账号',
            value: ACCOUNT_OPTIONS[draft.accountIndex],
            options: ACCOUNT_OPTIONS.map(function (name) {
              return { value: name, title: name }
            })
          }).then(function (picked) {
            if (picked === null) return
            var i = ACCOUNT_OPTIONS.indexOf(picked)
            draft.accountIndex = i < 0 ? 0 : i
            syncAccount(root, draft)
          })
        })

        dom.on(root, 'click', '[data-ccy]', function (e, el) {
          draft.currency = el.getAttribute('data-ccy')
          syncCcy(root, draft.currency)
        })

        dom.on(root, 'click', '[data-reset]', function () {
          draft = emptyFilters()
          syncFilterForm(root, draft)
        })

        dom.on(root, 'click', '[data-apply]', function () {
          view.filters = Object.assign({}, draft)
          sheet.close()
          applyFilters()
        })
      }
    })
  }

  /* ---------------------------------------------- 详情弹层 */

  function detailRow(label, valueHTML, extraClass) {
    return '<div class="detail-row">' +
      '<span class="detail-label">' + dom.esc(label) + '</span>' +
      '<span class="detail-value' + (extraClass ? ' ' + extraClass : '') + '">' + valueHTML + '</span>' +
      '</div>'
  }

  function detailBody(a) {
    return '<div class="detail-box">' +
      detailRow('收款编号', dom.esc(a.no), 'num') +
      detailRow('收款时间', dom.esc(a.time)) +
      detailRow('付款方', dom.esc(a.payer)) +
      detailRow('收款金额', '+' + dom.esc(a.amountText), 'num tc-strong') +
      detailRow('收款账户', dom.esc(a.account), 'num') +
      detailRow('付款方账户', dom.esc(a.payerAccount), 'num') +
      detailRow('付款方 Bic', dom.esc(a.bic), 'num') +
      detailRow('付款方国家', dom.esc(a.country)) +
      detailRow('业务员', dom.esc(a.sales)) +
      detailRow('附言', dom.esc(a.note)) +
      detailRow('状态', '<span class="pill cc-status" data-tone="' + a.statusTone + '">' +
        dom.esc(a.status) + '</span>') +
      '</div>'
  }

  function copyDetail(a) {
    var text = [
      '收款编号：' + a.no,
      '收款时间：' + a.time,
      '付款方：' + a.payer,
      '收款金额：' + a.amountText,
      '收款账户：' + a.account,
      '付款方账户：' + a.payerAccount,
      '付款方Bic：' + a.bic,
      '付款方国家：' + a.country,
      '业务员：' + a.sales,
      '附言：' + a.note,
      '状态：' + a.status
    ].join('\n')

    dom.copy(text).then(function () {
      PP.ui.toast('已复制', { icon: 'success' })
    }).catch(function () {
      PP.ui.toast('复制失败，请手动选择文本复制')
    })
  }

  /** 回单：Web 版为模拟发送，小程序侧待接入真实回单文件 */
  function sendReceipt(a) {
    PP.ui.toast('回单已发送至邮箱：' + a.no)
  }

  function openDetail(a) {
    PP.ui.sheet({
      title: '收款详情',
      body: detailBody(a),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-copy>复制信息</button>' +
          '<button type="button" class="btn btn--primary" data-receipt>回单下载</button>' +
        '</div>',
      onMount: function (root) {
        dom.on(root, 'click', '[data-copy]', function () { copyDetail(a) })
        dom.on(root, 'click', '[data-receipt]', function () { sendReceipt(a) })
      }
    })
  }

  /* ---------------------------------------------- 分配业务员弹层 */

  function assignBody(a, pick) {
    return (
      '<div class="assign-no-row">' +
        '<span class="assign-no-label">收款编号</span>' +
        '<span class="assign-no num">' + dom.esc(a.no) + '</span>' +
      '</div>' +
      '<div class="assign-list stack-2" role="listbox" aria-label="选择业务员">' +
        SALES_OPTIONS.map(function (name) {
          var on = name === pick
          return '<button type="button" class="option-row" role="option"' +
            ' data-name="' + dom.esc(name) + '" aria-selected="' + (on ? 'true' : 'false') + '">' +
            '<span class="tile"><svg aria-hidden="true"><use href="#i-user"/></svg></span>' +
            '<span class="option-body"><span class="option-title">' + dom.esc(name) + '</span></span>' +
            '<svg class="option-check" aria-hidden="true"' + (on ? '' : ' hidden') +
              '><use href="#i-check"/></svg>' +
            '</button>'
        }).join('') +
      '</div>'
    )
  }

  function openAssign(a) {
    var pick = a.sales

    var sheet = PP.ui.sheet({
      title: '分配业务员',
      body: assignBody(a, pick),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-close>取消</button>' +
          '<button type="button" class="btn btn--primary" data-save>保存</button>' +
        '</div>',
      onMount: function (root) {
        dom.on(root, 'click', '.option-row', function (e, row) {
          pick = row.getAttribute('data-name')
          dom.qsa('.option-row', root).forEach(function (item) {
            var on = item === row
            item.setAttribute('aria-selected', on ? 'true' : 'false')
            var check = dom.qs('.option-check', item)
            if (check) check.hidden = !on
          })
          dom.haptic()
        })

        dom.on(root, 'click', '[data-save]', function () {
          a.sales = pick
          sheet.close()
          applyFilters()
          PP.ui.toast('业务员已分配：' + pick, { icon: 'success' })
        })
      }
    })
  }

  /* ---------------------------------------------- 导出明细 */

  function exportList() {
    var header = ['序号', '收款编号', '收款时间', '状态', '付款方', '收款金额', '收款币种', '收款账户',
      '付款方账户', '付款方Bic', '付款方国家', '业务员', '附言']
    var rows = view.rows.map(function (a, i) {
      return [
        i + 1, a.no, a.time, a.status, a.payer, PP.format.fmtNum(a.amount), a.currency,
        a.account, a.payerAccount, a.bic, a.country, a.sales, a.note
      ]
    })
    var tsv = [header].concat(rows).map(function (r) { return r.join('\t') }).join('\n')

    dom.copy(tsv).then(function () {
      PP.ui.toast('已复制 ' + rows.length + ' 条明细，可粘贴到 Excel', { icon: 'success' })
    }).catch(function () {
      PP.ui.toast('复制失败，请手动选择文本复制')
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('trade-collection', {
    mount: function (root, ctx) {
      view = {
        root: root,
        // 每次挂载都从常量复制一份，编辑（分配业务员）不会污染演示数据
        list: COLLECTIONS.map(decorate),
        rows: [],
        searchText: '',
        statusSeg: '',
        filters: emptyFilters()
      }

      refreshCounts()

      var offs = [
        // 状态统计：点击即筛选
        dom.on(root, 'click', '[data-status]', function (e, el) {
          var next = el.getAttribute('data-status')
          if (next === view.statusSeg) return
          view.statusSeg = next
          dom.qsa('[data-status]', root).forEach(function (btn) {
            btn.setAttribute('aria-pressed', btn.getAttribute('data-status') === next ? 'true' : 'false')
          })
          applyFilters()
        }),

        // 搜索
        dom.on(root, 'input', '#tc-search', function (e, el) {
          view.searchText = el.value
          dom.toggle(dom.qs('#tc-clear', root), !!el.value)
          applyFilters()
        }),
        dom.on(root, 'click', '#tc-clear', function () {
          var input = dom.qs('#tc-search', root)
          input.value = ''
          view.searchText = ''
          dom.toggle(dom.qs('#tc-clear', root), false)
          applyFilters()
          input.focus()
        }),

        dom.on(root, 'click', '#tc-filter', openFilter),
        dom.on(root, 'click', '#tc-export', exportList),

        // 卡片动作：详情 / 回单 / 分配（列表重渲染后依然有效）
        dom.on(root, 'click', '[data-act]', function (e, el) {
          var a = findById(el.getAttribute('data-id'))
          if (!a) return
          var act = el.getAttribute('data-act')
          if (act === 'detail') openDetail(a)
          else if (act === 'receipt') sendReceipt(a)
          else if (act === 'assign') openAssign(a)
        })
      ]

      applyFilters()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
