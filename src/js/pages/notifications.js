/* ============================================================
   pages/notifications.js · 消息通知中心
   ------------------------------------------------------------
   职责：渲染分类与通知列表、按分类筛选、标记已读、消息详情弹层。
   列表数据放在文件顶部常量里，由 PP.dom 渲染；事件统一用 dom.on 委托。

   打开即已读：进入页面即把全局未读数清零（PP.store.set），
   首页横幅的角标因此同步消失；列表内每条消息仍保留自己的已读状态，
   由「打开详情」或「全部已读」逐条翻转 —— 两者口径不同，不要合并。

   状态放在模块作用域闭包变量里（同 index.js），不挂到 this。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 消息（演示数据，字段与消息接口同名；icon 为 sprite symbol 名） */
  var ALL = [
    {
      id: 'n1', category: 'trade', categoryLabel: '交易通知', read: false,
      icon: 'i-swap', tone: 'blue',
      title: '结汇提现已受理',
      summary: '流水号 EXC20260702103012，金额 120,000.00 CNH 已进入审核',
      time: '2026-07-02 10:32',
      content: '您的结汇提现申请已受理，流水号 EXC20260702103012，申请金额 120,000.00 CNH，手续费 120.00 CNH，预计到账 119,880.00 CNH。我们将在 1 个工作日内完成审核，审核结果会通过站内消息与邮件通知您。'
    },
    {
      id: 'n2', category: 'audit', categoryLabel: '审核通知', read: false,
      icon: 'i-check-circle', tone: 'success',
      title: 'KYC/KYB 周期验证待提交',
      summary: '还剩 3 天截止，请尽快补充营业执照与法人证件',
      time: '2026-07-01 09:05',
      content: '贵司的 KYC/KYB 周期性验证将于 3 天后到期。为避免影响收付款权限，请尽快在「系统管理 - 实名认证信息」中提交最新营业执照、法人身份证件及公司章程扫描件。'
    },
    {
      id: 'n3', category: 'system', categoryLabel: '系统通知', read: true,
      icon: 'i-clock', tone: 'warning',
      title: '银行假期日历已更新',
      summary: '2026 年 7 月新增 2 个跨境清算节假日',
      time: '2026-06-30 18:20',
      content: '银行假期日历已同步最新数据：2026 年 7 月新增 2 个跨境清算节假日，涉及 USD 与 EUR 清算通道。假期期间发起的汇款将顺延至下一工作日处理，请合理安排资金计划。'
    },
    {
      id: 'n4', category: 'trade', categoryLabel: '交易通知', read: true,
      icon: 'i-globe', tone: 'info',
      title: '一笔在途资金已到账',
      summary: '付款人 GLOBAL TRADING INC，金额 $ 860.10',
      time: '2026-06-30 15:02',
      content: '您有一笔在途资金已由收款行确认到账：付款人 GLOBAL TRADING INC，金额 $ 860.10，付款行 DEUTDEFFXXX，附言 INVOICE0630 PAYMENT。资金已计入贵司 USD 账户余额。'
    },
    {
      id: 'n5', category: 'audit', categoryLabel: '审核通知', read: true,
      icon: 'i-shield', tone: 'success',
      title: '提现账户信息初审通过',
      summary: '招商银行 · 6225 **** 8888 待法人授权',
      time: '2026-06-28 11:40',
      content: '您提交的企业提现银行账户（招商银行 · 6225 **** 8888）已通过初审，当前状态为「待法人授权」。请通知企业法人完成授权确认，授权通过后该账户即可用于结汇提现。'
    }
  ]

  /** 分类筛选项 */
  var CATEGORIES = [
    { key: 'all', label: '全部' },
    { key: 'trade', label: '交易' },
    { key: 'audit', label: '审核' },
    { key: 'system', label: '系统' }
  ]

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 取数 */

  function listOf() {
    return view.all.filter(function (n) {
      return view.category === 'all' || n.category === view.category
    })
  }

  function unreadOf(list) {
    return list.filter(function (n) { return !n.read }).length
  }

  function itemOf(id) {
    for (var i = 0; i < view.all.length; i++) {
      if (view.all[i].id === id) return view.all[i]
    }
    return null
  }

  /* ---------------------------------------------- 渲染片段 */

  function renderCategories(root) {
    PP.dom.renderList(PP.dom.qs('#note-categories', root), CATEGORIES, function (c) {
      return (
        '<button type="button" class="seg-item" role="tab"' +
        ' aria-selected="' + (c.key === view.category ? 'true' : 'false') + '"' +
        ' data-cat="' + c.key + '">' + PP.dom.esc(c.label) + '</button>'
      )
    })
  }

  function noteHTML(n) {
    var esc = PP.dom.esc
    return (
      '<li>' +
      '<button type="button" class="note" data-id="' + esc(n.id) + '">' +
      '<span class="tile" data-tone="' + n.tone + '">' +
      '<svg aria-hidden="true"><use href="#' + n.icon + '"/></svg></span>' +
      '<span class="note-body">' +
      '<span class="note-line1">' +
      '<span class="note-title" data-unread="' + (n.read ? 'false' : 'true') + '">' +
      esc(n.title) + '</span>' +
      (n.read ? '' : '<span class="note-dot" aria-hidden="true"></span>') +
      '</span>' +
      '<span class="note-summary">' + esc(n.summary) + '</span>' +
      '<span class="note-time">' + esc(n.time) + '</span>' +
      '</span>' +
      '</button>' +
      '</li>'
    )
  }

  function renderList(root) {
    var list = listOf()
    PP.dom.renderList(PP.dom.qs('#note-list', root), list, noteHTML)
    PP.dom.toggle(PP.dom.qs('#note-list-card', root), list.length > 0)
    PP.dom.toggle(PP.dom.qs('#note-empty', root), list.length === 0)

    var sub = PP.dom.qs('#note-sub', root)
    if (sub) sub.textContent = '未读 ' + unreadOf(view.all) + ' 条 · 共 ' + view.all.length + ' 条'
  }

  /* ---------------------------------------------- 详情弹层 */

  function openDetail(id) {
    var n = itemOf(id)
    if (!n) return

    // 打开详情即标记已读
    if (!n.read) {
      n.read = true
      renderList(view.root)
    }

    var body =
      '<div class="note-sheet">' +
      '<span class="tile" data-tone="' + n.tone + '">' +
      '<svg aria-hidden="true"><use href="#' + n.icon + '"/></svg></span>' +
      '<h3 class="note-detail-title">' + PP.dom.esc(n.title) + '</h3>' +
      '<p class="note-detail-time">' +
      PP.dom.esc(n.time + ' · ' + n.categoryLabel) + '</p>' +
      '<p class="note-detail-content">' + PP.dom.esc(n.content) + '</p>' +
      '</div>'

    if (view.sheet) view.sheet.close()
    view.sheet = PP.ui.sheet({
      title: '消息详情',
      body: body,
      footer: '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--primary" data-close>标记已读并关闭</button>' +
        '</div>'
    })
  }

  function readAll() {
    view.all.forEach(function (n) { n.read = true })
    renderList(view.root)
    PP.ui.toast('已全部标记为已读')
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('notifications', {
    mount: function (root, ctx) {
      var dom = PP.dom

      view = {
        root: root,
        category: 'all',
        // 克隆一份，页面内的已读翻转不污染上面的常量，重新进入仍是初始态
        all: ALL.map(function (n) { return Object.assign({}, n) }),
        sheet: null
      }

      // 打开即已读：清掉首页横幅的角标（首页已订阅 store，无需在这里处理）
      PP.store.set({ unread: 0 })

      renderCategories(root)
      renderList(root)

      dom.on(root, 'click', '[data-cat]', function (e, el) {
        var key = el.getAttribute('data-cat')
        if (key === view.category) return
        view.category = key
        renderCategories(root)
        renderList(root)
      })

      dom.on(root, 'click', '[data-id]', function (e, el) {
        openDetail(el.getAttribute('data-id'))
      })

      dom.on(root, 'click', '#note-readall', readAll)

      ctx.onCleanup(function () {
        // 页面出栈时若弹层还开着，一并收掉，避免遮罩留在界面上
        if (view && view.sheet) view.sheet.close()
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
