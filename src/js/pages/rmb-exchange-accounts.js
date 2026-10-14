/* ============================================================
   pages/rmb-exchange-accounts.js · 人民币结汇账户
   ------------------------------------------------------------
   人民币结汇模块 tab 二的控制器，职责与 desktop 版
   pages/rmb_exchange_accounts.html 对齐：
     · 状态统计条（点击即筛选）
     · 搜索框（账户名称 / 银行账号 / 别名）+ 筛选弹层（账户所属 / 账户类型）
     · 账户卡片列表 + 修改别名 / 修改资料 / 删除三个操作
     · 每页 5 条分页

   本页只做「管理」，新增入口固定指向 add-rmb-exchange-account 向导 ——
   账户信息的采集规则（支行号、个人账户返显、供应商材料等）只在那一处，
   两页各写一套必然对不上。

   可变数据是 view.list（ACCOUNTS 的副本）：页面内的改、删都只动副本，
   切走再回来仍是初始演示数据，演示与回归测试都可重复。

   desktop 版把「账户所属 / 账户类型 / 状态」做成三个下拉、名称与账号做成两个
   文本输入，移动端做了三处收口（都为了少占一屏）：
     · 两个文本输入 → 一个搜索框，名称 / 账号 / 别名一起检索
     · 状态 → 提为点击即筛的统计条（与收款页、换汇记录页一致）
     · 所属 / 类型 → 收进筛选弹层，命中数挂在筛选按钮的红点上
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 每页条数（与收款页、换汇记录页保持一致） */
  var PAGE_SIZE = 5

  /** 状态枚举 → 徽章文案与色调（对应 desktop 版 statusBadge 的配色分支） */
  var STATUS = {
    ok: { label: '正常', tone: 'success' },
    disabled: { label: '禁用', tone: 'neutral' }
  }

  /** 账户所属 / 账户类型：值存枚举，文案由这里给 */
  var OWNERS = [
    { value: 'company', label: '本公司' },
    { value: 'supplier', label: '供货商' }
  ]
  var TYPES = [
    { value: 'enterprise', label: '企业账户' },
    { value: 'personal', label: '个人账户' }
  ]

  /**
   * 结汇账户（演示数据）
   * 前 5 条取自 desktop 版 pages/rmb_exchange_accounts.html 的 accountsData，
   * 后 5 条为补足两页分页效果所加。desktop 里 owner / type / status 直接存
   * 中文，这里改存枚举 key + 上面两张表，渲染代码不再出现「值即文案」。
   */
  var ACCOUNTS = [
    { id: 'a1', owner: 'company', type: 'enterprise', name: '杭州安达科技', bank: '中国银行总行', account: '01301527', bindTime: '2026-01-30 15:27:38', status: 'ok', alias: '' },
    { id: 'a2', owner: 'supplier', type: 'personal', name: '罗炬', bank: '农业银行', account: '6228482312311111112', bindTime: '2026-01-29 17:36:55', status: 'ok', alias: '结汇收款人-对私-非同名1' },
    { id: 'a3', owner: 'company', type: 'enterprise', name: '上海茂雪信息技术', bank: '工商银行', account: '95588510000000123', bindTime: '2026-03-15 10:20:12', status: 'ok', alias: '' },
    { id: 'a4', owner: 'supplier', type: 'personal', name: '张三', bank: '建设银行', account: '62170010000000456', bindTime: '2026-03-20 09:15:45', status: 'disabled', alias: '常用收款人' },
    { id: 'a5', owner: 'company', type: 'enterprise', name: '北京达飞科技', bank: '招商银行', account: '755900000000789', bindTime: '2026-03-25 14:30:00', status: 'ok', alias: '' },
    { id: 'a6', owner: 'company', type: 'enterprise', name: '深圳市极光贸易有限公司', bank: '招商银行深圳前海支行', account: '755912345678901', bindTime: '2026-04-02 11:08:20', status: 'ok', alias: '主结算账户' },
    { id: 'a7', owner: 'company', type: 'personal', name: '顾人', bank: '交通银行', account: '6222620910001234567', bindTime: '2026-04-11 09:42:07', status: 'ok', alias: '' },
    { id: 'a8', owner: 'supplier', type: 'enterprise', name: '东莞市恒达五金有限公司', bank: '建设银行东莞分行', account: '4422001234567890', bindTime: '2026-04-18 16:05:33', status: 'disabled', alias: '备用供应商' },
    { id: 'a9', owner: 'supplier', type: 'personal', name: '李四', bank: '中国银行', account: '6216610200123456789', bindTime: '2026-04-23 10:31:14', status: 'ok', alias: '供应商-李四' },
    { id: 'a10', owner: 'supplier', type: 'personal', name: '王五', bank: '工商银行', account: '6222020200123456789', bindTime: '2026-04-29 14:57:49', status: 'ok', alias: '' }
  ]

  /** 当前实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 数据 */

  function labelOf(dict, value) {
    var hit = ''
    dict.forEach(function (item) { if (item.value === value) hit = item.label })
    return hit || value
  }

  function statusOf(key) {
    return STATUS[key] || STATUS.ok
  }

  /** 长卡号按 4 位分组展示，如 6228 4823 1231 1111 112 */
  function group4(s) {
    return String(s).replace(/(\d{4})(?=\d)/g, '$1 ')
  }

  /** 补上展示用派生字段，渲染函数里不再现算 */
  function decorate(a) {
    var st = statusOf(a.status)
    return Object.assign({}, a, {
      ownerLabel: labelOf(OWNERS, a.owner),
      typeLabel: labelOf(TYPES, a.type),
      statusLabel: st.label,
      statusTone: st.tone,
      accountText: group4(a.account),
      aliasText: a.alias || '未设置'
    })
  }

  function emptyFilters() {
    return { owner: '', type: '' }
  }

  /* ---------------------------------------------- 统计与筛选 */

  /** 状态统计条上的数量：按全量算，不随筛选变化 */
  function renderCounts() {
    var c = { all: view.list.length, ok: 0, disabled: 0 }
    view.list.forEach(function (a) {
      if (c[a.status] !== undefined) c[a.status] += 1
    })
    Object.keys(c).forEach(function (k) {
      var el = dom.qs('[data-count="' + k + '"]', view.root)
      if (el) el.textContent = String(c[k])
    })
  }

  function getFiltered() {
    var f = view.filters
    var kw = (view.keyword || '').toLowerCase()
    return view.list.filter(function (a) {
      if (view.status && a.status !== view.status) return false
      if (f.owner && a.owner !== f.owner) return false
      if (f.type && a.type !== f.type) return false
      if (kw) {
        var hay = (a.name + ' ' + a.account + ' ' + a.alias).toLowerCase()
        if (hay.indexOf(kw) < 0) return false
      }
      return true
    })
  }

  function countActiveFilters() {
    var f = view.filters
    var n = 0
    if (f.owner) n += 1
    if (f.type) n += 1
    return n
  }

  function syncFilterBadge() {
    var n = countActiveFilters()
    var badge = dom.qs('#acct-filter-badge', view.root)
    var btn = dom.qs('#acct-filter', view.root)
    badge.textContent = String(n)
    badge.hidden = n <= 0
    btn.setAttribute('data-active', n > 0 ? 'true' : 'false')
    btn.setAttribute('aria-label', n > 0 ? '筛选，已生效 ' + n + ' 项条件' : '筛选')
  }

  function syncSearchClear() {
    var clear = dom.qs('#acct-clear', view.root)
    if (clear) clear.hidden = !view.keyword
  }

  function applyFilters() {
    view.rows = getFiltered()
    // 条件一变结果集就不是刚才那批了，页码必须回到第 1 页
    view.page = 1
    syncFilterBadge()
    syncSearchClear()
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

  /** 翻页后回到顶部。滚动容器是 #app-body，不是 .page 自身 */
  function scrollViewTop() {
    var body = dom.qs('#app-body')
    if (!body) return
    if (body.scrollTo) body.scrollTo({ top: 0, behavior: 'smooth' })
    else body.scrollTop = 0
  }

  function fieldHTML(label, value, extra) {
    return (
      '<div class="acct-field">' +
      '<span class="acct-label">' + dom.esc(label) + '</span>' +
      '<span class="acct-value' + (extra ? ' ' + extra : '') + '">' + dom.esc(value) + '</span>' +
      '</div>'
    )
  }

  function rowHTML(a) {
    var esc = dom.esc
    return (
      '<li class="acct-item">' +
        '<div class="acct-top">' +
          '<span class="acct-name">' + esc(a.name) + '</span>' +
          '<span class="pill" data-tone="' + a.statusTone + '">' + esc(a.statusLabel) + '</span>' +
        '</div>' +
        '<p class="acct-sub">' + esc(a.ownerLabel) + ' · ' + esc(a.typeLabel) + '</p>' +
        '<div class="acct-grid">' +
          fieldHTML('开户银行', a.bank) +
          fieldHTML('银行账号', a.accountText, 'num') +
          fieldHTML('别名/昵称', a.aliasText, a.alias ? '' : 'is-empty') +
          fieldHTML('绑定时间', a.bindTime, 'num') +
        '</div>' +
        '<div class="acct-ops">' +
          '<button type="button" class="acct-op" data-act="alias" data-id="' + esc(a.id) + '">修改别名</button>' +
          '<button type="button" class="acct-op" data-act="edit" data-id="' + esc(a.id) + '">修改</button>' +
          '<button type="button" class="acct-op acct-op--danger" data-act="delete" data-id="' + esc(a.id) + '">删除</button>' +
        '</div>' +
      '</li>'
    )
  }

  function render() {
    // 筛选或删除后条数变少时先把越界页码收回来，否则会渲染出一个空页
    if (view.page > pageCount(view.rows.length)) view.page = pageCount(view.rows.length)

    var listEl = dom.qs('#acct-list', view.root)
    var rows = pageSlice(view.rows, view.page)
    dom.renderList(listEl, rows, rowHTML)
    dom.toggle(listEl, rows.length > 0)
    dom.toggle(dom.qs('#acct-empty', view.root), view.rows.length === 0)
    // 计数是筛选后的总数，不受当前页影响
    dom.qs('#acct-count', view.root).textContent = '共 ' + view.rows.length + ' 个结汇账户'

    var p = PP.ui.pager({
      el: dom.qs('#acct-pager', view.root),
      total: view.rows.length,
      page: view.page,
      pageSize: PAGE_SIZE,
      label: '结汇账户分页',
      onGo: function (page) {
        view.page = page
        render()
        scrollViewTop()
      }
    })
    view.page = p.page
  }

  /* ---------------------------------------------- 筛选与修改共用的表单片段 */

  /** 选项表 → picker 选项（首位固定「全部」，对应空值） */
  function pickerOptions(dict) {
    return [{ value: '', title: '全部' }].concat(dict.map(function (d) {
      return { value: d.value, title: d.label }
    }))
  }

  /** 伪选择框回填：空值回到占位态（浅色） */
  function syncPick(root, id, text) {
    var el = dom.qs('#' + id + '-v', root)
    if (!el) return
    el.textContent = text || '全部'
    if (text) el.classList.remove('is-placeholder')
    else el.classList.add('is-placeholder')
  }

  /** 筛选 / 修改弹层里的伪选择框（点击由调用方挂 PP.ui.picker） */
  function selectFieldHTML(id, label, labelId) {
    return (
      '<div class="field">' +
      '<span class="field-label" id="' + labelId + '">' + dom.esc(label) + '</span>' +
      '<button type="button" class="select-field" id="' + id + '" aria-labelledby="' + labelId + '">' +
      '<span class="select-value is-placeholder" id="' + id + '-v">全部</span>' +
      '<svg class="select-caret" aria-hidden="true"><use href="#i-chevron-down"/></svg>' +
      '</button>' +
      '</div>'
    )
  }

  /* ---------------------------------------------- 筛选弹层 */

  function openFilter() {
    // 草稿：弹层内随便改，点「查询」才写回 filters
    var draft = Object.assign({}, view.filters)

    PP.ui.sheet({
      title: '筛选条件',
      body:
        selectFieldHTML('acct-f-owner', '账户所属', 'acct-f-owner-label') +
        selectFieldHTML('acct-f-type', '账户类型', 'acct-f-type-label'),
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-reset>重置</button>' +
        '<button type="button" class="btn btn--primary" data-apply>查询</button>' +
        '</div>',
      onMount: function (root, api) {
        syncPick(root, 'acct-f-owner', labelOf(OWNERS, draft.owner))
        syncPick(root, 'acct-f-type', labelOf(TYPES, draft.type))

        var pick = function (id, key, dict, title) {
          dom.on(root, 'click', '#' + id, function () {
            PP.ui.picker({
              title: title,
              value: draft[key],
              options: pickerOptions(dict)
            }).then(function (picked) {
              if (picked === null || !view) return
              draft[key] = picked
              syncPick(root, id, labelOf(dict, picked))
            })
          })
        }
        pick('acct-f-owner', 'owner', OWNERS, '账户所属')
        pick('acct-f-type', 'type', TYPES, '账户类型')

        dom.on(root, 'click', '[data-reset]', function () {
          draft = emptyFilters()
          syncPick(root, 'acct-f-owner', '')
          syncPick(root, 'acct-f-type', '')
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

  /* ---------------------------------------------- 修改别名 */

  function openAlias(acc) {
    PP.ui.sheet({
      title: '修改别名',
      body:
        '<div class="field">' +
        '<label class="field-label" for="acct-alias-input">账户别名</label>' +
        '<input class="field-input" id="acct-alias-input" type="text" autocomplete="off"' +
        ' maxlength="20" placeholder="便于在提现账户列表里识别" value="' + dom.esc(acc.alias) + '">' +
        '</div>',
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-cancel>取消</button>' +
        '<button type="button" class="btn btn--primary" data-save>保存</button>' +
        '</div>',
      onMount: function (root, api) {
        dom.on(root, 'click', '[data-cancel]', function () { api.close() })
        dom.on(root, 'click', '[data-save]', function () {
          if (!view) return
          var input = dom.qs('#acct-alias-input', root)
          var v = (input ? input.value : '').trim()
          acc.alias = v
          acc.aliasText = v || '未设置'
          applyFilters()
          api.close()
          PP.ui.toast(v ? '别名已更新' : '已清除别名', { icon: 'success' })
        })
      }
    })
  }

  /* ---------------------------------------------- 修改资料 */

  function openEdit(acc) {
    var draft = {
      owner: acc.owner,
      type: acc.type,
      name: acc.name,
      bank: acc.bank,
      account: acc.account,
      alias: acc.alias
    }

    PP.ui.sheet({
      title: '修改账户',
      body:
        selectFieldHTML('acct-edit-owner', '账户所属', 'acct-edit-owner-label') +
        selectFieldHTML('acct-edit-type', '账户类型', 'acct-edit-type-label') +
        '<div class="field">' +
        '<label class="field-label" for="acct-edit-name">账户名称</label>' +
        '<input class="field-input" id="acct-edit-name" type="text" autocomplete="off">' +
        '</div>' +
        '<div class="field">' +
        '<label class="field-label" for="acct-edit-bank">银行名称</label>' +
        '<input class="field-input" id="acct-edit-bank" type="text" autocomplete="off">' +
        '</div>' +
        '<div class="field">' +
        '<label class="field-label" for="acct-edit-account">银行账号</label>' +
        '<input class="field-input num" id="acct-edit-account" type="text" inputmode="numeric" autocomplete="off">' +
        '</div>' +
        '<div class="field">' +
        '<label class="field-label" for="acct-edit-alias">别名/昵称</label>' +
        '<input class="field-input" id="acct-edit-alias" type="text" autocomplete="off"' +
        ' maxlength="20" placeholder="选填">' +
        '</div>',
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-cancel>取消</button>' +
        '<button type="button" class="btn btn--primary" data-save>保存</button>' +
        '</div>',
      onMount: function (root, api) {
        syncPick(root, 'acct-edit-owner', labelOf(OWNERS, draft.owner))
        syncPick(root, 'acct-edit-type', labelOf(TYPES, draft.type))
        dom.qs('#acct-edit-name', root).value = draft.name
        dom.qs('#acct-edit-bank', root).value = draft.bank
        dom.qs('#acct-edit-account', root).value = draft.account
        dom.qs('#acct-edit-alias', root).value = draft.alias

        var pick = function (id, key, dict, title) {
          dom.on(root, 'click', '#' + id, function () {
            PP.ui.picker({
              title: title,
              value: draft[key],
              options: pickerOptions(dict)
            }).then(function (picked) {
              if (picked === null || !view) return
              draft[key] = picked
              syncPick(root, id, labelOf(dict, picked))
            })
          })
        }
        pick('acct-edit-owner', 'owner', OWNERS, '账户所属')
        pick('acct-edit-type', 'type', TYPES, '账户类型')

        dom.on(root, 'input', '#acct-edit-name', function (e, el) { draft.name = el.value })
        dom.on(root, 'input', '#acct-edit-bank', function (e, el) { draft.bank = el.value })
        dom.on(root, 'input', '#acct-edit-account', function (e, el) { draft.account = el.value })
        dom.on(root, 'input', '#acct-edit-alias', function (e, el) { draft.alias = el.value })

        dom.on(root, 'click', '[data-cancel]', function () { api.close() })
        dom.on(root, 'click', '[data-save]', function () {
          if (!view) return
          var name = (draft.name || '').trim()
          if (!name) {
            PP.ui.toast('请填写账户名称')
            return
          }
          acc.owner = draft.owner
          acc.ownerLabel = labelOf(OWNERS, draft.owner)
          acc.type = draft.type
          acc.typeLabel = labelOf(TYPES, draft.type)
          acc.name = name
          // 银行 / 账号留空视为不改动，避免误清空
          acc.bank = (draft.bank || '').trim() || acc.bank
          acc.account = (draft.account || '').trim() || acc.account
          acc.accountText = group4(acc.account)
          acc.alias = (draft.alias || '').trim()
          acc.aliasText = acc.alias || '未设置'
          applyFilters()
          api.close()
          PP.ui.toast('账户信息已保存', { icon: 'success' })
        })
      }
    })
  }

  /* ---------------------------------------------- 删除 */

  function openDelete(acc) {
    PP.ui.confirm({
      title: '确认删除账户？',
      content: '删除后该账户将无法用于人民币结汇，操作不可恢复。',
      confirmText: '确认删除'
    }).then(function (ok) {
      if (!ok || !view) return
      view.list = view.list.filter(function (a) { return a.id !== acc.id })
      renderCounts()
      applyFilters()
      PP.ui.toast('账户已删除', { icon: 'success' })
    })
  }

  function findAcc(id) {
    return view.list.filter(function (a) { return a.id === id })[0]
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('rmb-exchange-accounts', {
    mount: function (root, ctx) {
      // 按绑定时间倒序：最近绑定的排在最前，序号随之重排
      var sorted = ACCOUNTS.slice().sort(function (a, b) {
        if (a.bindTime === b.bindTime) return 0
        return a.bindTime < b.bindTime ? 1 : -1
      })

      view = {
        root: root,
        ctx: ctx,
        list: sorted.map(decorate),
        rows: [],
        page: 1,
        status: '',
        keyword: '',
        filters: emptyFilters()
      }

      var offs = [
        // 状态统计：点击即筛选
        dom.on(root, 'click', '[data-acct-status]', function (e, el) {
          var key = el.getAttribute('data-acct-status')
          if (key === view.status) return
          view.status = key
          dom.qsa('[data-acct-status]', root).forEach(function (btn) {
            btn.setAttribute('aria-pressed', btn.getAttribute('data-acct-status') === key ? 'true' : 'false')
          })
          applyFilters()
        }),

        // 搜索：名称 / 账号 / 别名，输入即筛
        dom.on(root, 'input', '#acct-search', function (e, el) {
          view.keyword = (el.value || '').trim()
          applyFilters()
        }),
        dom.on(root, 'click', '#acct-clear', function () {
          var input = dom.qs('#acct-search', root)
          if (input) input.value = ''
          view.keyword = ''
          applyFilters()
        }),

        dom.on(root, 'click', '#acct-filter', openFilter),

        // 卡片操作（列表重渲染后依然有效）
        dom.on(root, 'click', '.acct-op', function (e, el) {
          var acc = findAcc(el.getAttribute('data-id'))
          if (!acc) return
          var act = el.getAttribute('data-act')
          if (act === 'alias') openAlias(acc)
          else if (act === 'edit') openEdit(acc)
          else if (act === 'delete') openDelete(acc)
        })
      ]

      renderCounts()
      applyFilters()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
