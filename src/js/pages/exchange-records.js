/* ============================================================
   pages/exchange-records.js · 换汇记录
   ------------------------------------------------------------
   入口：换汇中心「换汇历史」右侧「查看全部 ›」。职责与 desktop 版
   pages/exchange_records.html 对齐：
     · 概览 KPI（换汇成功 / 申请中笔数与金额）
     · 状态统计条（点击即筛选列表）
     · 筛选弹层（交易时间 / 买入币种 / 卖出币种 / 下单方式）
     · 记录卡片列表 + 详情弹层 + 导出列表 + 分页

   统计口径：KPI 与状态笔数都按**全量**数据算，只有列表跟着筛选走 ——
   与桌面版一致（桌面版的 KPI 固定在筛选栏上方，属于整页统计）。

   演示数据放在文件顶部的大写常量里。买入金额统一以 CNH 计价，
   所以「成功换入金额」可以直接求和；换成接口数据时若出现非 CNH 的
   买入币种，需要先折算成同一币种再加总。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 每页条数（与收款页、在途资金保持一致） */
  var PAGE_SIZE = 5

  /** 状态 → 徽章文案与色调 */
  var STATUS = {
    success: { label: '换汇成功', tone: 'success' },
    pending: { label: '换汇申请中', tone: 'orange' }
  }

  /** 下单方式选项（与桌面版下拉一致） */
  var ORDER_TYPES = ['现汇', '远期', '掉期']

  /** 换汇记录（演示数据；源 desktop 版 pages/exchange_records.html 的 10 条） */
  var RECORDS = [
    { id: 'x1', time: '2026-07-07 13:43:18', type: '现汇', sellCcy: 'USD', sellAmt: 3000.00, buyCcy: 'CNH', buyAmt: 20396.73, rate: '6.798911', status: 'success', email: 'wuyanzu1.hz.yh@gmail.com', sn: '1524048125382234112' },
    { id: 'x2', time: '2026-07-06 16:33:51', type: '现汇', sellCcy: 'USD', sellAmt: 700.00, buyCcy: 'CNH', buyAmt: 4746.35, rate: '6.780511', status: 'success', email: '11022921@qq.com', sn: '1523728628167348224' },
    { id: 'x3', time: '2026-07-06 16:27:14', type: '现汇', sellCcy: 'USD', sellAmt: 200.00, buyCcy: 'CNH', buyAmt: 1357.16, rate: '6.785811', status: 'success', email: '11022921@qq.com', sn: '1523727016292126720' },
    { id: 'x4', time: '2026-07-06 16:22:02', type: '现汇', sellCcy: 'USD', sellAmt: 600.00, buyCcy: 'CNH', buyAmt: 4071.30, rate: '6.785511', status: 'success', email: '11022921@qq.com', sn: '1523725673821245440' },
    { id: 'x5', time: '2026-07-06 15:55:39', type: '现汇', sellCcy: 'USD', sellAmt: 2000.00, buyCcy: 'CNH', buyAmt: 13570.04, rate: '6.785024', status: 'success', email: '11022921@qq.com', sn: '1523719009915244544' },
    { id: 'x6', time: '2026-07-06 15:33:27', type: '现汇', sellCcy: 'USD', sellAmt: 200.00, buyCcy: 'CNH', buyAmt: 1356.30, rate: '6.7815', status: 'success', email: '11022921@qq.com', sn: '1523713452059791360' },
    { id: 'x7', time: '2026-07-01 16:32:50', type: '现汇', sellCcy: 'GBP', sellAmt: 78.05, buyCcy: 'CNH', buyAmt: 700.00, rate: '8.969', status: 'success', email: '11022921@qq.com', sn: '1521916414926131200' },
    { id: 'x8', time: '2026-04-28 17:06:27', type: '现汇', sellCcy: 'USD', sellAmt: 123.00, buyCcy: 'CNH', buyAmt: 839.98, rate: '6.829111', status: 'pending', email: '11022921@qq.com', sn: '1498732122465243136' },
    { id: 'x9', time: '2026-04-28 17:06:20', type: '现汇', sellCcy: 'USD', sellAmt: 123.00, buyCcy: 'CNH', buyAmt: 839.98, rate: '6.829111', status: 'pending', email: '11022921@qq.com', sn: '1498732091834241024' },
    { id: 'x10', time: '2026-04-28 17:06:13', type: '现汇', sellCcy: 'USD', sellAmt: 123.00, buyCcy: 'CNH', buyAmt: 840.00, rate: '6.829311', status: 'pending', email: '11022921@qq.com', sn: '1498732030278635520' }
  ]

  /** 当前实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 数据 */

  function statusOf(key) {
    return STATUS[key] || STATUS.success
  }

  function emptyFilters() {
    return { startDate: '', endDate: '', buyCcy: '', sellCcy: '', orderType: '' }
  }

  /** 补上展示用派生字段；seq 是原始序号，不随筛选变化 */
  function decorate(r, i) {
    var st = statusOf(r.status)
    return Object.assign({}, r, {
      seq: String(i + 1).padStart(2, '0'),
      statusLabel: st.label,
      statusTone: st.tone,
      sellText: r.sellCcy + ' ' + PP.format.fmtNum(r.sellAmt),
      buyText: r.buyCcy + ' ' + PP.format.fmtNum(r.buyAmt)
    })
  }

  /** 从数据里取某侧出现过的币种，避免筛选器出现选不中的选项 */
  function ccyOptions(key) {
    var seen = []
    RECORDS.forEach(function (r) {
      if (seen.indexOf(r[key]) < 0) seen.push(r[key])
    })
    return seen.sort()
  }

  /* ---------------------------------------------- 概览 KPI */

  /** 概览按全量统计（不随筛选变化），与桌面版口径一致 */
  function renderKpis() {
    var done = RECORDS.filter(function (r) { return r.status === 'success' })
    var pending = RECORDS.filter(function (r) { return r.status === 'pending' })
    var inAmt = done.reduce(function (s, r) { return s + r.buyAmt }, 0)
    var pendAmt = pending.reduce(function (s, r) { return s + r.buyAmt }, 0)

    var set = function (sel, text) {
      var el = dom.qs(sel, view.root)
      if (el) el.textContent = text
    }
    set('#exr-kpi-done', String(done.length))
    set('#exr-kpi-pending', String(pending.length))
    set('#exr-kpi-in', PP.format.withSymbol('¥', inAmt))
    set('#exr-kpi-in-sub', '折合 CNH · ' + done.length + ' 笔')
    set('#exr-kpi-pending-amt', PP.format.withSymbol('¥', pendAmt))
    set('#exr-kpi-pending-sub', '折合 CNH · ' + pending.length + ' 笔')
  }

  /** 状态统计条上的笔数（同样按全量算） */
  function renderCounts() {
    var c = { all: RECORDS.length, success: 0, pending: 0 }
    RECORDS.forEach(function (r) {
      if (c[r.status] !== undefined) c[r.status] += 1
    })
    Object.keys(c).forEach(function (k) {
      var el = dom.qs('[data-count="' + k + '"]', view.root)
      if (el) el.textContent = String(c[k])
    })
  }

  /* ---------------------------------------------- 过滤 */

  function getFiltered() {
    var f = view.filters
    var s = f.startDate ? f.startDate + ' 00:00:00' : ''
    var e = f.endDate ? f.endDate + ' 23:59:59' : ''

    return view.list.filter(function (r) {
      if (s && r.time < s) return false
      if (e && r.time > e) return false
      if (f.buyCcy && r.buyCcy !== f.buyCcy) return false
      if (f.sellCcy && r.sellCcy !== f.sellCcy) return false
      if (f.orderType && r.type !== f.orderType) return false
      if (view.status && r.status !== view.status) return false
      return true
    })
  }

  function countActiveFilters() {
    var f = view.filters
    var n = 0
    if (f.startDate) n += 1
    if (f.endDate) n += 1
    if (f.buyCcy) n += 1
    if (f.sellCcy) n += 1
    if (f.orderType) n += 1
    return n
  }

  function syncFilterBadge() {
    var n = countActiveFilters()
    var badge = dom.qs('#exr-filter-badge', view.root)
    var btn = dom.qs('#exr-filter', view.root)
    badge.textContent = String(n)
    badge.hidden = n <= 0
    btn.setAttribute('data-active', n > 0 ? 'true' : 'false')
    btn.setAttribute('aria-label', n > 0 ? '筛选，已生效 ' + n + ' 项条件' : '筛选')
  }

  function applyFilters() {
    view.rows = getFiltered()
    // 条件一变结果集就不是刚才那批了，页码必须回到第 1 页
    view.page = 1
    syncFilterBadge()
    render()
  }

  /* ---------------------------------------------- 渲染 */

  function pageCount(total) {
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }

  function pageSlice(list, page) {
    var start = (page - 1) * PAGE_SIZE
    return list.slice(start, start + PAGE_SIZE)
  }

  function scrollViewTop() {
    if (!view.root) return
    if (view.root.scrollTo) view.root.scrollTo({ top: 0, behavior: 'smooth' })
    else view.root.scrollTop = 0
  }

  function rowHTML(r) {
    return (
      '<li class="exr-item">' +
        '<button type="button" class="exr-main" data-id="' + dom.esc(r.id) + '"' +
          ' aria-label="查看换汇记录 ' + dom.esc(r.sn) + ' 的详情">' +
          '<span class="exr-top">' +
            '<span class="exr-no">#' + dom.esc(r.seq) + '</span>' +
            '<span class="pill" data-tone="' + r.statusTone + '">' + dom.esc(r.statusLabel) + '</span>' +
          '</span>' +
          '<span class="exr-meta num">' + dom.esc(r.time) + ' · ' + dom.esc(r.type) + '</span>' +
          '<span class="exr-legs">' +
            '<span class="exr-leg">' +
              '<span class="exr-leg-label">卖出</span>' +
              '<span class="exr-leg-value" data-amount>' + dom.esc(r.sellText) + '</span>' +
            '</span>' +
            '<span class="exr-leg exr-leg--buy">' +
              '<span class="exr-leg-label">买入</span>' +
              '<span class="exr-leg-value" data-amount>' + dom.esc(r.buyText) + '</span>' +
            '</span>' +
          '</span>' +
          '<span class="exr-foot">' +
            '<span class="exr-line">' +
              '<span class="exr-line-label">交易汇率</span>' +
              '<span class="exr-line-value">' + dom.esc(r.rate) + '</span>' +
            '</span>' +
            '<span class="exr-line">' +
              '<span class="exr-line-label">流水号</span>' +
              '<span class="exr-line-value">' + dom.esc(r.sn) + '</span>' +
            '</span>' +
          '</span>' +
        '</button>' +
      '</li>'
    )
  }

  function render() {
    // 筛选后条数变少时先把越界页码收回来，否则会渲染出一个空页
    if (view.page > pageCount(view.rows.length)) view.page = pageCount(view.rows.length)

    var listEl = dom.qs('#exr-list', view.root)
    var rows = pageSlice(view.rows, view.page)
    dom.renderList(listEl, rows, rowHTML)
    dom.toggle(listEl, rows.length > 0)
    dom.toggle(dom.qs('#exr-empty', view.root), view.rows.length === 0)
    // 计数是筛选后的总数，不受当前页影响
    dom.qs('#exr-count', view.root).textContent = '共 ' + view.rows.length + ' 条换汇记录'

    var p = PP.ui.pager({
      el: dom.qs('#exr-pager', view.root),
      total: view.rows.length,
      page: view.page,
      pageSize: PAGE_SIZE,
      label: '换汇记录分页',
      onGo: function (page) {
        view.page = page
        render()
        scrollViewTop()
      }
    })
    view.page = p.page
  }

  /* ---------------------------------------------- 筛选弹层 */

  function pickerOptions(values) {
    return [{ value: '', title: '全部' }].concat(values.map(function (v) {
      return { value: v, title: v }
    }))
  }

  function filterBody() {
    return (
      '<div class="field">' +
        '<label class="field-label" for="exr-f-start">交易时间</label>' +
        '<div class="date-row">' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="exr-f-start" aria-label="开始日期">' +
          '</div>' +
          '<span class="date-sep" aria-hidden="true">至</span>' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="exr-f-end" aria-label="结束日期">' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="exr-f-buy-label">买入币种</span>' +
        '<button type="button" class="select-field" id="exr-f-buy" aria-labelledby="exr-f-buy-label">' +
          '<span class="select-value is-placeholder" id="exr-f-buy-v">全部</span>' +
          '<svg class="select-caret" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="exr-f-sell-label">卖出币种</span>' +
        '<button type="button" class="select-field" id="exr-f-sell" aria-labelledby="exr-f-sell-label">' +
          '<span class="select-value is-placeholder" id="exr-f-sell-v">全部</span>' +
          '<svg class="select-caret" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="exr-f-type-label">下单方式</span>' +
        '<button type="button" class="select-field" id="exr-f-type" aria-labelledby="exr-f-type-label">' +
          '<span class="select-value is-placeholder" id="exr-f-type-v">全部</span>' +
          '<svg class="select-caret" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
        '</button>' +
      '</div>'
    )
  }

  /** 伪选择框回填：空值回到占位态（浅色） */
  function syncPick(root, id, value) {
    var text = dom.qs('#' + id + '-v', root)
    if (!text) return
    text.textContent = value || '全部'
    if (value) text.classList.remove('is-placeholder')
    else text.classList.add('is-placeholder')
  }

  function syncFilterForm(root, draft) {
    dom.qs('#exr-f-start', root).value = draft.startDate
    dom.qs('#exr-f-end', root).value = draft.endDate
    syncPick(root, 'exr-f-buy', draft.buyCcy)
    syncPick(root, 'exr-f-sell', draft.sellCcy)
    syncPick(root, 'exr-f-type', draft.orderType)
  }

  function openFilter() {
    // 草稿：弹层内随便改，点「查询」才写回 filters
    var draft = Object.assign({}, view.filters)

    PP.ui.sheet({
      title: '筛选条件',
      body: filterBody(),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-reset>重置</button>' +
          '<button type="button" class="btn btn--primary" data-apply>查询</button>' +
        '</div>',
      onMount: function (root, api) {
        syncFilterForm(root, draft)

        dom.on(root, 'change', '#exr-f-start', function (e, el) { draft.startDate = el.value })
        dom.on(root, 'change', '#exr-f-end', function (e, el) { draft.endDate = el.value })

        var pick = function (id, key, values) {
          dom.on(root, 'click', '#' + id, function () {
            PP.ui.picker({
              title: key === 'buyCcy' ? '买入币种' : key === 'sellCcy' ? '卖出币种' : '下单方式',
              value: draft[key],
              options: pickerOptions(values)
            }).then(function (picked) {
              if (picked === null || !view) return
              draft[key] = picked
              syncPick(root, id, picked)
            })
          })
        }
        pick('exr-f-buy', 'buyCcy', ccyOptions('buyCcy'))
        pick('exr-f-sell', 'sellCcy', ccyOptions('sellCcy'))
        pick('exr-f-type', 'orderType', ORDER_TYPES)

        dom.on(root, 'click', '[data-reset]', function () {
          draft = emptyFilters()
          syncFilterForm(root, draft)
        })

        dom.on(root, 'click', '[data-apply]', function () {
          if (!view) return
          view.filters = draft
          applyFilters()
          api.close()
          PP.ui.toast('筛选条件已应用', { icon: 'success' })
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

  function detailBody(r) {
    return (
      detailRow('交易流水号', dom.esc(r.sn), 'num') +
      detailRow('交易时间', dom.esc(r.time)) +
      detailRow('下单方式', dom.esc(r.type)) +
      detailRow('交割日期', dom.esc(r.time.slice(0, 10))) +
      detailRow('卖出', '<span data-amount>' + dom.esc(r.sellText) + '</span>', 'num') +
      detailRow('买入', '<span data-amount>' + dom.esc(r.buyText) + '</span>', 'num') +
      detailRow('交易汇率', dom.esc(r.rate), 'num') +
      detailRow('订单状态', dom.esc(r.statusLabel)) +
      detailRow('操作人邮箱', dom.esc(r.email))
    )
  }

  function openDetail(r) {
    PP.ui.sheet({ title: '换汇记录详情', body: detailBody(r) })
  }

  /* ---------------------------------------------- 导出列表 */

  function exportList() {
    var header = ['序号', '交易时间', '下单方式', '卖出', '买入', '交易汇率', '订单状态', '操作人邮箱', '交易流水号']
    var rows = view.rows.map(function (r) {
      return [r.seq, r.time, r.type, r.sellText, r.buyText, r.rate, r.statusLabel, r.email, r.sn]
    })
    var tsv = [header].concat(rows).map(function (r) { return r.join('\t') }).join('\n')

    dom.copy(tsv).then(function () {
      PP.ui.toast('已复制 ' + rows.length + ' 条明细，可粘贴到 Excel', { icon: 'success' })
    }).catch(function () {
      PP.ui.toast('复制失败，请手动选择文本复制')
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('exchange-records', {
    mount: function (root, ctx) {
      view = {
        root: root,
        ctx: ctx,
        list: RECORDS.map(decorate),
        rows: [],
        page: 1,
        status: '',
        filters: emptyFilters()
      }

      var offs = [
        // 状态统计：点击即筛选
        dom.on(root, 'click', '[data-status]', function (e, el) {
          var key = el.getAttribute('data-status')
          if (key === view.status) return
          view.status = key
          dom.qsa('[data-status]', root).forEach(function (btn) {
            btn.setAttribute('aria-pressed', btn.getAttribute('data-status') === key ? 'true' : 'false')
          })
          applyFilters()
        }),

        dom.on(root, 'click', '#exr-filter', openFilter),
        dom.on(root, 'click', '#exr-export', exportList),

        // 卡片点击 → 详情（列表重渲染后依然有效）
        dom.on(root, 'click', '.exr-main', function (e, el) {
          var id = el.getAttribute('data-id')
          var row = view.rows.filter(function (r) { return r.id === id })[0]
          if (row) openDetail(row)
        })
      ]

      renderKpis()
      renderCounts()
      applyFilters()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
