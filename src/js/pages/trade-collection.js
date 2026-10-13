/* ============================================================
   pages/trade-collection.js · 外贸收款管理
   ------------------------------------------------------------
   本页含两个视图，由顶部 .tc-viewseg 分段切换：
     collection  收款记录 —— 按状态 / 搜索词 / 筛选条件过滤并渲染卡片列表，
                            以及详情、分配业务员、回单、导出明细四个动作
     fund        在途资金 —— 合计 Hero、状态页签、资金列表与详情弹层
                            （原 in-transit-funds 一级页整体迁入，
                              首页「详情 ›」带 { view: 'fund' } 直达）
   两套演示数据各自放在文件顶部的大写常量里，字段名与源码保持一致，
   换成接口数据时只需替换 COLLECTIONS / FUNDS 与各自的 decorate()。

   筛选弹层内编辑的是 draft（草稿），点「查询」才写回 filters ——
   与小程序一致，避免边改边筛导致列表跳动。

   两个列表都做客户端分页（每页 PAGE_SIZE 条，见 PP.ui.pager）：
   数据本来就在内存里，翻页只换一段切片，不重新过滤。
   筛选条件变化会把页码拨回第 1 页，否则会停在一个空页上。

   两个视图共存于同一页面根元素下，事件委托的属性名必须互不重叠：
   收款用 data-status / data-act / data-id，在途用 data-fstatus / data-fid。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 每页条数：两个列表共用（演示数据量小，5 条即可看出翻页效果） */
  var PAGE_SIZE = 5

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

  /* =============================================== 在途资金（第二个视图）
     以下是原 in-transit-funds 页的内容，整体迁入本页。
     汇总口径与原实现一致：合计与笔数始终按全量数据统计，
     不随状态筛选变化（筛选只影响下面的列表）。 */

  /** 在途资金明细（演示数据，字段与资金接口同名） */
  var FUNDS = [
    { id: 'f1', time: '2026-07-02 02:39:00', payer: 'DEBTOR NAME100ACC', amount: 888.10, currency: 'USD', country: 'SE', bank: 'ESSESESSXXX', note: 'INVOICE12300 PAYMENT', status: '收款行已到账' },
    { id: 'f2', time: '2026-07-01 18:22:15', payer: 'TRADE CORP LTD200AC', amount: 9960.10, currency: 'USD', country: 'PA', bank: 'BAGEPAPAXXX', note: 'INVOICE20260701 TRADE', status: '在途中' },
    { id: 'f3', time: '2026-06-30 14:55:42', payer: 'GLOBAL TRADING INC', amount: 860.10, currency: 'USD', country: 'DE', bank: 'DEUTDEFFXXX', note: 'INVOICE0630 PAYMENT', status: '收款行已到账' },
    { id: 'f4', time: '2026-06-29 09:12:33', payer: 'SUNRISE IMPORT EXP', amount: 1550.00, currency: 'EUR', country: 'FR', bank: 'BNPAFRPPXXX', note: 'INVOICE290624', status: '在途中' },
    { id: 'f5', time: '2026-06-28 16:44:08', payer: 'EASTERN MERCHANT CO', amount: 7200.00, currency: 'GBP', country: 'GB', bank: 'BARCGB22XXX', note: 'INVOICE2806', status: '收款行已到账' },
    { id: 'f6', time: '2026-06-27 11:30:55', payer: 'NORTH SEA TRADING', amount: 4300.50, currency: 'CNH', country: 'HK', bank: 'HSBCHKHHXXX', note: 'INVOICE0627 PAYMENT', status: '已退款' }
  ]

  /** 币种符号 */
  var FUND_SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNH: '¥' }

  /** 折算汇率（演示口径，合计按 USD 计价） */
  var FUND_RATE = { USD: 1, EUR: 1.08, GBP: 1.27, CNH: 0.14 }

  /** 在途资金状态页签 */
  var FUND_STATUS_TABS = [
    { key: 'all', label: '全部' },
    { key: 'transit', label: '在途中' },
    { key: 'arrived', label: '已到账' },
    { key: 'refund', label: '已退款' }
  ]

  /** 在途列表状态文案 → 页签 key */
  function fundKeyOf(status) {
    if (status === '在途中') return 'transit'
    if (status === '已退款') return 'refund'
    return 'arrived'
  }

  /** 在途条目图标块色调：退款中转为中性，避免和正常到账混在一起 */
  function fundToneOf(status) {
    if (status === '已退款') return 'neutral'
    if (status === '在途中') return 'blue'
    return 'success'
  }

  /** 在途条目徽章色调 */
  function fundBadgeToneOf(status) {
    if (status === '已退款') return 'danger'
    if (status === '在途中') return 'blue'
    return 'success'
  }

  /** 补齐在途条目的展示字段：金额文案 / 页签 key / 色调 */
  function decorateFund(r) {
    return {
      id: r.id,
      time: r.time,
      payer: r.payer,
      amount: r.amount,
      currency: r.currency,
      country: r.country,
      bank: r.bank,
      note: r.note,
      status: r.status,
      key: fundKeyOf(r.status),
      tone: fundToneOf(r.status),
      badgeTone: fundBadgeToneOf(r.status),
      amountText: (FUND_SYMBOL[r.currency] || '') + ' ' + PP.format.fmtNum(r.amount) + ' ' + r.currency
    }
  }

  var FUND_ROWS = FUNDS.map(decorateFund)

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

  /** 总页数（至少 1，空列表也不出现「第 0 页」） */
  function pageCount(total) {
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }

  /** 取当前页的数据切片 */
  function pageSlice(list, page) {
    var start = (page - 1) * PAGE_SIZE
    return list.slice(start, start + PAGE_SIZE)
  }

  /** 渲染底部翻页控件（单页时组件自行清空并隐藏） */
  function renderPager(sel, total, page, label, onGo) {
    return PP.ui.pager({
      el: dom.qs(sel, view.root),
      total: total,
      page: page,
      pageSize: PAGE_SIZE,
      label: label,
      onGo: onGo
    })
  }

  /** 翻页后把视图滚回顶部，用户从本页第一条继续往下看 */
  function scrollViewTop() {
    if (!view.root) return
    if (view.root.scrollTo) view.root.scrollTo({ top: 0, behavior: 'smooth' })
    else view.root.scrollTop = 0
  }

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
    // 筛选后条数变少时，先把越界的页码收回来再切片，否则会渲染出一个空页
    if (view.page > pageCount(view.rows.length)) view.page = pageCount(view.rows.length)

    var listEl = dom.qs('#tc-list', view.root)
    var rows = pageSlice(view.rows, view.page)
    dom.renderList(listEl, rows, rowHTML)
    dom.toggle(listEl, rows.length > 0)
    dom.toggle(dom.qs('#tc-empty', view.root), rows.length === 0)
    // 计数始终是筛选后的总数，不受当前页影响
    dom.qs('#tc-count', view.root).textContent = '共 ' + view.rows.length + ' 条收款记录'

    var p = renderPager('#tc-pager', view.rows.length, view.page, '收款记录分页', function (page) {
      view.page = page
      render()
      scrollViewTop()
    })
    view.page = p.page
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
    // 条件一变，结果集就不是刚才那一批了，页码必须回到第 1 页
    view.page = 1
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
          // 分配不改筛选结果，只重渲染，页码停在原处
          render()
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

  /* =============================================== 在途资金 · 渲染与交互 */

  function fundListOf() {
    return FUND_ROWS.filter(function (r) {
      return view.fundStatus === 'all' || r.key === view.fundStatus
    })
  }

  function fundRowOf(id) {
    for (var i = 0; i < FUND_ROWS.length; i++) {
      if (FUND_ROWS[i].id === id) return FUND_ROWS[i]
    }
    return null
  }

  /** 汇总 Hero：合计与笔数始终按全量统计，不随下方状态筛选变化 */
  function renderFundHero() {
    var total = FUND_ROWS.reduce(function (acc, r) {
      return acc + r.amount * (FUND_RATE[r.currency] || 1)
    }, 0)

    var setText = function (sel, text) {
      var el = dom.qs(sel, view.root)
      if (el) el.textContent = text
    }
    setText('#fund-total', PP.format.withSymbol('$', total))
    setText('#fund-all-count', FUND_ROWS.length + ' 笔')
    setText('#fund-transit-count', FUND_ROWS.filter(function (r) {
      return r.status === '在途中'
    }).length + ' 笔')
  }

  function renderFundTabs() {
    dom.renderList(dom.qs('#fund-status', view.root), FUND_STATUS_TABS, function (t) {
      return (
        '<button type="button" class="seg-item" role="tab"' +
        ' aria-selected="' + (t.key === view.fundStatus ? 'true' : 'false') + '"' +
        ' data-fstatus="' + t.key + '">' + dom.esc(t.label) + '</button>'
      )
    })
  }

  function fundRowHTML(r) {
    return (
      '<li>' +
      '<button type="button" class="fund" data-fid="' + dom.esc(r.id) + '">' +
      '<span class="tile" data-tone="' + r.tone + '">' +
      '<svg aria-hidden="true"><use href="#i-globe"/></svg></span>' +
      '<span class="fund-body">' +
      '<span class="fund-line1">' +
      '<span class="fund-payer">' + dom.esc(r.payer) + '</span>' +
      '<span class="fund-amount num">' + dom.esc(r.amountText) + '</span>' +
      '</span>' +
      '<span class="fund-line2">' +
      '<span class="fund-sub">' + dom.esc(r.country + ' · ' + r.bank) + '</span>' +
      '<span class="pill" data-tone="' + r.badgeTone + '">' + dom.esc(r.status) + '</span>' +
      '</span>' +
      '<span class="fund-time">' + dom.esc(r.time) + '</span>' +
      '</span>' +
      '</button>' +
      '</li>'
    )
  }

  function renderFundList() {
    var list = fundListOf()
    if (view.fundPage > pageCount(list.length)) view.fundPage = pageCount(list.length)

    dom.renderList(dom.qs('#fund-list', view.root), pageSlice(list, view.fundPage), fundRowHTML)
    dom.toggle(dom.qs('#fund-list-card', view.root), list.length > 0)
    dom.toggle(dom.qs('#fund-empty', view.root), list.length === 0)

    var count = dom.qs('#fund-count', view.root)
    if (count) count.textContent = '共 ' + list.length + ' 条记录'

    var p = renderPager('#fund-pager', list.length, view.fundPage, '在途资金分页', function (page) {
      view.fundPage = page
      renderFundList()
      scrollViewTop()
    })
    view.fundPage = p.page
  }

  function fundDetailRow(label, value, isNum) {
    return '<div class="detail-row">' +
      '<span class="detail-label">' + dom.esc(label) + '</span>' +
      '<span class="detail-value"' + (isNum ? ' data-num' : '') + '>' +
      dom.esc(value) + '</span>' +
      '</div>'
  }

  function openFundDetail(id) {
    var r = fundRowOf(id)
    if (!r) return

    var body =
      fundDetailRow('到账时间', r.time) +
      fundDetailRow('付款人', r.payer) +
      fundDetailRow('付款金额', r.amountText, true) +
      fundDetailRow('付款币种', r.currency) +
      fundDetailRow('付款国家/地区', r.country) +
      fundDetailRow('付款银行', r.bank) +
      fundDetailRow('附言', r.note) +
      fundDetailRow('状态', r.status)

    if (view.fundSheet) view.fundSheet.close()
    view.fundSheet = PP.ui.sheet({ title: '在途资金详情', body: body })
  }

  /** 切换页面内两个视图（收款记录 / 在途资金），同步分段控件的选中态 */
  function switchView(mode) {
    if (mode !== 'collection' && mode !== 'fund') return
    view.mode = mode
    dom.qsa('[data-view]', view.root).forEach(function (btn) {
      btn.setAttribute('aria-selected', btn.getAttribute('data-view') === mode ? 'true' : 'false')
    })
    dom.toggle(dom.qs('#tc-pane-collection', view.root), mode === 'collection')
    dom.toggle(dom.qs('#tc-pane-fund', view.root), mode === 'fund')
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('trade-collection', {
    mount: function (root, ctx) {
      view = {
        root: root,
        /** 当前视图：collection 收款记录 / fund 在途资金 */
        mode: 'collection',
        // 每次挂载都从常量复制一份，编辑（分配业务员）不会污染演示数据
        list: COLLECTIONS.map(decorate),
        rows: [],
        /** 收款列表当前页（1 起） */
        page: 1,
        searchText: '',
        statusSeg: '',
        filters: emptyFilters(),
        /** 在途资金视图状态（与收款的状态筛选各自独立） */
        fundStatus: 'all',
        /** 在途列表当前页（1 起） */
        fundPage: 1,
        fundSheet: null
      }

      refreshCounts()
      renderFundHero()
      renderFundTabs()
      renderFundList()

      var offs = [
        // 视图切换：收款记录 / 在途资金
        dom.on(root, 'click', '#tc-viewseg [data-view]', function (e, el) {
          switchView(el.getAttribute('data-view'))
        }),

        // 状态统计：点击即筛选
        dom.on(root, 'click', '#tc-pane-collection [data-status]', function (e, el) {
          var next = el.getAttribute('data-status')
          if (next === view.statusSeg) return
          view.statusSeg = next
          dom.qsa('#tc-pane-collection [data-status]', root).forEach(function (btn) {
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
        }),

        // 在途资金：状态页签（只影响列表，不影响 Hero 汇总）；换状态即回第 1 页
        dom.on(root, 'click', '#tc-pane-fund [data-fstatus]', function (e, el) {
          var key = el.getAttribute('data-fstatus')
          if (key === view.fundStatus) return
          view.fundStatus = key
          view.fundPage = 1
          renderFundTabs()
          renderFundList()
        }),

        // 在途资金：条目整行可点，打开详情弹层
        dom.on(root, 'click', '[data-fid]', function (e, el) {
          openFundDetail(el.getAttribute('data-fid'))
        })
      ]

      applyFilters()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        // 页面出栈时若在途详情弹层还开着，一并收掉，避免遮罩留在界面上
        if (view && view.fundSheet) view.fundSheet.close()
        view = null
      })
    },

    /** 带视图意图进入本页时直接落位（如首页在途资金「详情 ›」→ { view: 'fund' }） */
    onParams: function (el, params) {
      if (view && params && params.view) switchView(params.view)
    }
  })
})((window.PP = window.PP || {}))
