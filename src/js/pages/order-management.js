/* ============================================================
   pages/order-management.js · 订单管理
   ------------------------------------------------------------
   职责：按状态分段 / 搜索词 / 筛选条件过滤订单并渲染卡片，
   以及详情、复制、编辑、创建（新增）、导出列表。
   演示数据放在文件顶部的大写常量里，字段名与小程序源码保持一致。

   列表数据 view.list 在挂载时从常量复制一份，编辑 / 新建只改副本，
   重新进入页面时看到的仍是干净的演示数据。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 订单状态 → 徽章色调（对应小程序 STATUS_CLASS 的 橙 / 蓝 / 绿） */
  var STATUS_TONE = { '待关联': 'warning', '部分关联': 'blue', '全部关联': 'success' }

  /** 发货状态 → 徽章色调（未发货为中性灰） */
  var SHIP_TONE = { '未发货': 'neutral', '发货': 'success' }

  /** 订单列表（演示数据，源 order_management.html orderData 的 10 条原样迁入） */
  var ORDERS = [
    { id: 'o1', no: '1525100569881088000', contract: '20260104', time: '2026-07-15 10:23:45', buyer: 'leehorn wang', product: '测试', amount: 100.00, currency: 'USD', orderStatus: '待关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '0%' },
    { id: 'o2', no: '1525100569881088001', contract: '20260105', time: '2026-07-14 15:30:12', buyer: 'royWang', product: '除害剂', amount: 3000.00, currency: 'USD', orderStatus: '全部关联', shipStatus: '发货', creator: '11022921@qq.com', ratio: '100%' },
    { id: 'o3', no: '1525100569881088002', contract: '20260106', time: '2026-07-14 11:18:33', buyer: 'Test Enterprise', product: '智能手机', amount: 13241.00, currency: 'CNH', orderStatus: '部分关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '45%' },
    { id: 'o4', no: '1525100569881088003', contract: '20260107', time: '2026-07-13 09:45:28', buyer: 'leehorn wang', product: '衣服', amount: 600022.00, currency: 'USD', orderStatus: '全部关联', shipStatus: '发货', creator: '11022921@qq.com', ratio: '100%' },
    { id: 'o5', no: '1525100569881088004', contract: '20260108', time: '2026-07-12 16:52:10', buyer: 'royWang', product: '测试', amount: 500.00, currency: 'USD', orderStatus: '待关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '0%' },
    { id: 'o6', no: '1525100569881088005', contract: '20260109', time: '2026-07-12 14:21:55', buyer: 'Test Enterprise', product: '除害剂', amount: 8500.00, currency: 'USD', orderStatus: '部分关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '60%' },
    { id: 'o7', no: '1525100569881088006', contract: '20260110', time: '2026-07-11 10:08:42', buyer: 'leehorn wang', product: '智能手机', amount: 22000.00, currency: 'CNH', orderStatus: '全部关联', shipStatus: '发货', creator: '11022921@qq.com', ratio: '100%' },
    { id: 'o8', no: '1525100569881088007', contract: '20260111', time: '2026-07-10 13:37:19', buyer: 'royWang', product: '衣服', amount: 1200.00, currency: 'USD', orderStatus: '待关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '0%' },
    { id: 'o9', no: '1525100569881088008', contract: '20260112', time: '2026-07-09 09:15:33', buyer: 'Test Enterprise', product: '测试', amount: 45000.00, currency: 'USD', orderStatus: '部分关联', shipStatus: '发货', creator: '11022921@qq.com', ratio: '75%' },
    { id: 'o10', no: '1525100569881088009', contract: '20260113', time: '2026-07-08 17:42:08', buyer: 'leehorn wang', product: '除害剂', amount: 2800.00, currency: 'USD', orderStatus: '全部关联', shipStatus: '未发货', creator: '11022921@qq.com', ratio: '100%' }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 数据 */

  function decorate(a) {
    return Object.assign({}, a, {
      statusTone: STATUS_TONE[a.orderStatus] || 'warning',
      shipTone: SHIP_TONE[a.shipStatus] || 'neutral',
      amountText: PP.format.fmtNum(a.amount) + ' ' + a.currency,
      ratioNum: parseInt(a.ratio, 10) || 0
    })
  }

  function emptyFilters() {
    return { startDate: '', endDate: '', ship: '', creator: '' }
  }

  function findById(id) {
    for (var i = 0; i < view.list.length; i++) {
      if (view.list[i].id === id) return view.list[i]
    }
    return null
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n
  }

  /* ---------------------------------------------- 渲染 */

  function rowHTML(a) {
    return (
      '<li class="order-card">' +
        '<button type="button" class="oc-main" data-id="' + dom.esc(a.id) + '"' +
          ' aria-label="查看订单 ' + dom.esc(a.no) + ' 的详情">' +
          '<span class="oc-top">' +
            '<span class="oc-no">' + dom.esc(a.no) + '</span>' +
            '<span class="pill" data-tone="' + a.statusTone + '">' + dom.esc(a.orderStatus) + '</span>' +
          '</span>' +
          '<span class="oc-mid">' +
            '<span class="oc-buyer-wrap">' +
              '<span class="oc-buyer">' + dom.esc(a.buyer) + '</span>' +
              '<span class="oc-product">' + dom.esc(a.product) + '</span>' +
            '</span>' +
            '<span class="oc-amount num" data-amount>' + dom.esc(a.amountText) + '</span>' +
          '</span>' +
          '<span class="oc-meta">' +
            '<span class="oc-meta-item">合同 ' + dom.esc(a.contract) + '</span>' +
            '<span class="oc-meta-item num">' + dom.esc(a.time) + '</span>' +
          '</span>' +
          '<span class="oc-bottom">' +
            '<span class="pill" data-tone="' + a.shipTone + '">' + dom.esc(a.shipStatus) + '</span>' +
            '<span class="oc-ratio">' +
              '<span class="oc-ratio-track" aria-hidden="true">' +
                '<span class="oc-ratio-bar" style="--ratio:' + a.ratioNum + '%"></span>' +
              '</span>' +
              '<span class="oc-ratio-text">收款关联 ' + dom.esc(a.ratio) + '</span>' +
            '</span>' +
          '</span>' +
        '</button>' +
      '</li>'
    )
  }

  function render() {
    var listEl = dom.qs('#om-list', view.root)
    dom.renderList(listEl, view.rows, rowHTML)
    dom.toggle(listEl, view.rows.length > 0)
    dom.toggle(dom.qs('#om-empty', view.root), view.rows.length === 0)
    dom.qs('#om-count', view.root).textContent = '共 ' + view.rows.length + ' 条订单'
  }

  function refreshCounts() {
    var c = { all: view.list.length, pending: 0, partial: 0, linked: 0 }
    view.list.forEach(function (a) {
      if (a.orderStatus === '待关联') c.pending += 1
      else if (a.orderStatus === '部分关联') c.partial += 1
      else if (a.orderStatus === '全部关联') c.linked += 1
    })
    Object.keys(c).forEach(function (k) {
      var el = dom.qs('[data-count="' + k + '"]', view.root)
      if (el) el.textContent = String(c[k])
    })
  }

  /* ---------------------------------------------- 过滤 */

  function getFiltered() {
    var f = view.filters
    var kw = view.searchText.trim().toLowerCase()
    var s = f.startDate ? f.startDate + ' 00:00:00' : ''
    var e = f.endDate ? f.endDate + ' 23:59:59' : ''
    var creator = f.creator.trim().toLowerCase()

    return view.list.filter(function (a) {
      if (kw && (a.no + ' ' + a.contract + ' ' + a.buyer + ' ' + a.product).toLowerCase().indexOf(kw) === -1) return false
      if (view.statusSeg && a.orderStatus !== view.statusSeg) return false
      if (f.ship && a.shipStatus !== f.ship) return false
      if (s && a.time < s) return false
      if (e && a.time > e) return false
      if (creator && a.creator.toLowerCase().indexOf(creator) === -1) return false
      return true
    })
  }

  function syncFilterBadge() {
    var f = view.filters
    var n = [f.startDate, f.endDate, f.ship, f.creator.trim()].filter(function (v) { return !!v }).length
    var badge = dom.qs('#om-filter-badge', view.root)
    var btn = dom.qs('#om-filter', view.root)
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

  function filterBody() {
    return (
      '<div class="field">' +
        '<label class="field-label" for="om-f-start">创建时间</label>' +
        '<div class="date-row">' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="om-f-start" aria-label="开始日期">' +
          '</div>' +
          '<span class="date-sep" aria-hidden="true">至</span>' +
          '<div class="date-pick">' +
            '<input type="date" class="date-box" id="om-f-end" aria-label="结束日期">' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="om-ship-label">发货状态</span>' +
        '<div class="seg" role="tablist" aria-labelledby="om-ship-label">' +
          ['', '未发货', '发货'].map(function (s) {
            return '<button type="button" class="seg-item" role="tab" data-ship="' + s + '"' +
              ' aria-selected="false">' + (s || '全部') + '</button>'
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="om-f-creator">创建人</label>' +
        '<input type="text" class="field-input" id="om-f-creator" placeholder="按创建人邮箱搜索">' +
      '</div>'
    )
  }

  function syncShip(root, ship) {
    dom.qsa('[data-ship]', root).forEach(function (el) {
      el.setAttribute('aria-selected', el.getAttribute('data-ship') === ship ? 'true' : 'false')
    })
  }

  function syncFilterForm(root, draft) {
    dom.qs('#om-f-start', root).value = draft.startDate
    dom.qs('#om-f-end', root).value = draft.endDate
    dom.qs('#om-f-creator', root).value = draft.creator
    syncShip(root, draft.ship)
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

        dom.on(root, 'change', '#om-f-start', function (e, el) { draft.startDate = el.value })
        dom.on(root, 'change', '#om-f-end', function (e, el) { draft.endDate = el.value })
        dom.on(root, 'input', '#om-f-creator', function (e, el) { draft.creator = el.value })

        dom.on(root, 'click', '[data-ship]', function (e, el) {
          draft.ship = el.getAttribute('data-ship')
          syncShip(root, draft.ship)
        })

        // 重置：连已生效的筛选一起清掉，与小程序一致
        dom.on(root, 'click', '[data-reset]', function () {
          draft = emptyFilters()
          view.filters = emptyFilters()
          syncFilterForm(root, draft)
          applyFilters()
          PP.ui.toast('筛选已重置')
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
      detailRow('订单编号', dom.esc(a.no), 'num') +
      detailRow('合同号', dom.esc(a.contract)) +
      detailRow('创建时间', dom.esc(a.time)) +
      detailRow('买方名称', dom.esc(a.buyer)) +
      detailRow('商品名称', dom.esc(a.product)) +
      detailRow('订单总额', dom.esc(a.amountText), 'num om-strong') +
      detailRow('创建人', dom.esc(a.creator)) +
      detailRow('收款关联比例', dom.esc(a.ratio), 'num om-strong') +
      detailRow('订单状态', '<span class="pill" data-tone="' + a.statusTone + '">' +
        dom.esc(a.orderStatus) + '</span>') +
      detailRow('发货状态', '<span class="pill" data-tone="' + a.shipTone + '">' +
        dom.esc(a.shipStatus) + '</span>') +
      '</div>'
  }

  function copyOrder(a) {
    var text = [
      '订单编号: ' + a.no,
      '合同号: ' + a.contract,
      '创建时间: ' + a.time,
      '买方名称: ' + a.buyer,
      '商品名称: ' + a.product,
      '订单总额: ' + a.amountText,
      '创建人: ' + a.creator,
      '收款关联比例: ' + a.ratio,
      '订单状态: ' + a.orderStatus,
      '发货状态: ' + a.shipStatus
    ].join('\n')

    dom.copy(text).then(function () {
      PP.ui.toast('订单信息已复制', { icon: 'success' })
    }).catch(function () {
      PP.ui.toast('复制失败，请手动选择文本复制')
    })
  }

  function openDetail(a) {
    var sheet = PP.ui.sheet({
      title: '订单详情',
      body: detailBody(a),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-copy>复制信息</button>' +
          '<button type="button" class="btn btn--primary" data-edit>编辑订单</button>' +
        '</div>',
      onMount: function (root) {
        dom.on(root, 'click', '[data-copy]', function () { copyOrder(a) })
        dom.on(root, 'click', '[data-edit]', function () {
          sheet.close()
          openForm('edit', a)
        })
      }
    })
  }

  /* ---------------------------------------------- 创建 / 编辑弹层 */

  function formBody(form) {
    return (
      '<div class="field">' +
        '<label class="field-label" for="om-f-buyer">买方名称</label>' +
        '<input type="text" class="field-input" id="om-f-buyer" placeholder="请输入买方名称"' +
          ' value="' + dom.esc(form.buyer) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="om-f-product">商品名称</label>' +
        '<input type="text" class="field-input" id="om-f-product" placeholder="请输入商品名称"' +
          ' value="' + dom.esc(form.product) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="om-f-amount">订单总额</label>' +
        '<input type="text" inputmode="decimal" class="field-input num" id="om-f-amount"' +
          ' placeholder="0.00" value="' + dom.esc(form.amount) + '">' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label" id="om-ccy-label">订单币种</span>' +
        '<div class="seg" role="tablist" aria-labelledby="om-ccy-label">' +
          ['USD', 'CNH', 'EUR'].map(function (c) {
            return '<button type="button" class="seg-item" role="tab" data-ccy="' + c + '"' +
              ' aria-selected="' + (form.currency === c ? 'true' : 'false') + '">' + c + '</button>'
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="om-f-contract">合同号</label>' +
        '<input type="text" class="field-input" id="om-f-contract"' +
          ' placeholder="选填，留空自动生成" value="' + dom.esc(form.contract) + '">' +
      '</div>'
    )
  }

  function submitForm(sheet, mode, order, form) {
    var buyer = form.buyer.trim()
    var amount = parseFloat(form.amount)

    if (!buyer) {
      PP.ui.toast('请填写买方名称')
      return
    }
    if (!amount || amount <= 0) {
      PP.ui.toast('请填写正确的订单总额')
      return
    }

    if (mode === 'edit') {
      view.list = view.list.map(function (a) {
        if (a.id !== order.id) return a
        return decorate(Object.assign({}, a, {
          buyer: buyer,
          product: form.product.trim() || a.product,
          amount: amount,
          currency: form.currency,
          contract: form.contract.trim() || a.contract
        }))
      })
      sheet.close()
      refreshCounts()
      applyFilters()
      PP.ui.toast('订单已保存', { icon: 'success' })
      return
    }

    // 新建：待关联 / 未发货 / 关联比例 0%（对齐源页面提交创建的默认值）
    var seq = view.list.length + 1
    var now = new Date()
    var created = decorate({
      id: 'new-' + seq + '-' + now.getTime(),
      no: String(now.getTime()),
      contract: form.contract.trim() || 'NEW' + seq,
      time: PP.format.isoDate(now) + ' ' +
        pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      buyer: buyer,
      product: form.product.trim() || '-',
      amount: amount,
      currency: form.currency,
      orderStatus: '待关联',
      shipStatus: '未发货',
      creator: '11022921@qq.com',
      ratio: '0%'
    })

    view.list = [created].concat(view.list)
    sheet.close()
    refreshCounts()
    applyFilters()
    PP.ui.toast('订单创建成功', { icon: 'success' })
  }

  function openForm(mode, order) {
    var form = mode === 'edit'
      ? {
        buyer: order.buyer,
        product: order.product,
        amount: String(order.amount),
        currency: order.currency,
        contract: order.contract
      }
      : { buyer: '', product: '', amount: '', currency: 'USD', contract: '' }

    var sheet = PP.ui.sheet({
      title: mode === 'edit' ? '编辑订单' : '创建订单',
      body: formBody(form),
      footer:
        '<div class="sheet-footer">' +
          '<button type="button" class="btn btn--ghost" data-close>取消</button>' +
          '<button type="button" class="btn btn--primary" data-submit>' +
            (mode === 'edit' ? '保存' : '提交创建') +
          '</button>' +
        '</div>',
      onMount: function (root) {
        dom.on(root, 'input', '#om-f-buyer', function (e, el) { form.buyer = el.value })
        dom.on(root, 'input', '#om-f-product', function (e, el) { form.product = el.value })
        dom.on(root, 'input', '#om-f-amount', function (e, el) { form.amount = el.value })
        dom.on(root, 'input', '#om-f-contract', function (e, el) { form.contract = el.value })

        dom.on(root, 'click', '[data-ccy]', function (e, el) {
          form.currency = el.getAttribute('data-ccy')
          dom.qsa('[data-ccy]', root).forEach(function (btn) {
            btn.setAttribute('aria-selected', btn === el ? 'true' : 'false')
          })
        })

        dom.on(root, 'click', '[data-submit]', function () {
          submitForm(sheet, mode, order, form)
        })
      }
    })
  }

  /* ---------------------------------------------- 导出列表 */

  function exportOrders() {
    if (!view.rows.length) {
      PP.ui.toast('没有可导出的订单')
      return
    }

    var header = ['序号', '订单编号', '合同号', '创建时间', '买方名称', '商品名称', '订单总额',
      '订单币种', '订单状态', '发货状态', '创建人', '收款关联比例']
    var rows = view.rows.map(function (a, i) {
      return [
        i + 1, a.no, a.contract, a.time, a.buyer, a.product,
        PP.format.fmtNum(a.amount), a.currency, a.orderStatus, a.shipStatus, a.creator, a.ratio
      ]
    })
    var tsv = [header].concat(rows).map(function (r) { return r.join('\t') }).join('\n')

    dom.copy(tsv).then(function () {
      PP.ui.toast('已复制到剪贴板，可粘贴到表格', { icon: 'success' })
    }).catch(function () {
      PP.ui.toast('复制失败，请手动选择文本复制')
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('order-management', {
    mount: function (root, ctx) {
      view = {
        root: root,
        // 每次挂载都从常量复制一份，编辑 / 新建不污染演示数据
        list: ORDERS.map(decorate),
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
        dom.on(root, 'input', '#om-search', function (e, el) {
          view.searchText = el.value
          dom.toggle(dom.qs('#om-clear', root), !!el.value)
          applyFilters()
        }),
        dom.on(root, 'click', '#om-clear', function () {
          var input = dom.qs('#om-search', root)
          input.value = ''
          view.searchText = ''
          dom.toggle(dom.qs('#om-clear', root), false)
          applyFilters()
          input.focus()
        }),

        dom.on(root, 'click', '#om-filter', openFilter),
        dom.on(root, 'click', '#om-export', exportOrders),
        dom.on(root, 'click', '#om-create', function () { openForm('create', null) }),

        // 卡片点击 = 查看详情（列表重渲染后依然有效）
        dom.on(root, 'click', '.oc-main', function (e, el) {
          var a = findById(el.getAttribute('data-id'))
          if (a) openDetail(a)
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
