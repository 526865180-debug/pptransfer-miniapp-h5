/* ============================================================
   pages/rmb-exchange-records.js · 结汇记录
   ------------------------------------------------------------
   职责：按状态分段过滤结汇记录（4 条演示数据）、回填汇总金额、
   渲染记录列表并打开详情弹层。
   演示数据放在文件顶部的大写常量里，字段名与小程序源码保持一致。

   汇总口径与小程序一致：失败记录既不计入汇出金额，也不计入手续费合计。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 结汇状态 → 徽章色调（对应小程序 statusClass 的 蓝 / 绿 / 红） */
  var STATUS_TONE = { '处理中': 'blue', '已完成': 'success', '失败': 'danger' }

  /** 结汇记录（演示数据，源 rmb-exchange-records.js 的 4 条原样迁入） */
  var RECORDS = [
    {
      id: 'r1', no: 'EXC20260702103012', time: '2026-07-02 10:30:12', type: '结汇提现',
      bankName: '招商银行 · 6225 **** 8888', accountName: '深圳市鹏程贸易有限公司',
      accountNo: '6225880012348888', accountRemark: '主结算账户',
      pay: 120000, fee: 120, out: 119880, status: '处理中', statusClass: 'blue'
    },
    {
      id: 'r2', no: 'EXC20260628154400', time: '2026-06-28 15:44:00', type: '结汇提现',
      bankName: '中国银行 · 6217 **** 3021', accountName: '深圳市鹏程贸易有限公司',
      accountNo: '6217001234563021', accountRemark: '备用账户',
      pay: 86000, fee: 86, out: 85914, status: '已完成', statusClass: 'emerald'
    },
    {
      id: 'r3', no: 'EXC20260625091833', time: '2026-06-25 09:18:33', type: '结汇提现',
      bankName: '招商银行 · 6225 **** 8888', accountName: '深圳市鹏程贸易有限公司',
      accountNo: '6225880012348888', accountRemark: '主结算账户',
      pay: 52000, fee: 52, out: 51948, status: '已完成', statusClass: 'emerald'
    },
    {
      id: 'r4', no: 'EXC20260620171205', time: '2026-06-20 17:12:05', type: '结汇提现',
      bankName: '工商银行 · 6222 **** 7745', accountName: '深圳市鹏程贸易有限公司',
      accountNo: '6222021234567745', accountRemark: '',
      pay: 30000, fee: 30, out: 29970, status: '失败', statusClass: 'red'
    }
  ]

  /** 状态分段（key 与小程序 statusTabs 一致） */
  var STATUS_KEYS = { all: '', processing: '处理中', done: '已完成', failed: '失败' }

  /** 当前页面实例的可变状态；未挂载时为 null */
  var view = null

  /* ---------------------------------------------- 数据 */

  function decorate(r) {
    return Object.assign({}, r, {
      statusTone: STATUS_TONE[r.status] || 'neutral',
      payText: PP.format.fmtNum(r.pay),
      feeText: PP.format.fmtNum(r.fee),
      outText: PP.format.fmtNum(r.out)
    })
  }

  function matchStatus(r) {
    var want = STATUS_KEYS[view.status]
    return !want || r.status === want
  }

  /* ---------------------------------------------- 渲染 */

  function rowHTML(r) {
    return (
      '<li class="rec">' +
        '<button type="button" class="rec-main" data-id="' + dom.esc(r.id) + '"' +
          ' aria-label="查看结汇记录 ' + dom.esc(r.no) + ' 的详情">' +
          '<span class="rec-head">' +
            '<span class="rec-no">' + dom.esc(r.no) + '</span>' +
            '<span class="pill" data-tone="' + r.statusTone + '">' + dom.esc(r.status) + '</span>' +
          '</span>' +
          '<span class="rec-line">' +
            '<span class="rec-label">提现账户</span>' +
            '<span class="rec-value">' + dom.esc(r.bankName) + '</span>' +
          '</span>' +
          '<span class="rec-line">' +
            '<span class="rec-label">提现时间</span>' +
            '<span class="rec-value num">' + dom.esc(r.time) + '</span>' +
          '</span>' +
          '<span class="rec-foot">' +
            '<span class="rec-amount">' +
              '<span class="rec-amount-label">付款金额</span>' +
              '<span class="rec-amount-value num" data-amount>' + dom.esc(r.payText) + ' CNH</span>' +
            '</span>' +
            '<span class="rec-amount">' +
              '<span class="rec-amount-label">汇出金额</span>' +
              '<span class="rec-amount-value num rec-amount-value--out" data-amount>' +
                dom.esc(r.outText) + ' CNH</span>' +
            '</span>' +
          '</span>' +
        '</button>' +
      '</li>'
    )
  }

  function applyFilter() {
    var rows = view.list.filter(matchStatus)
    // 失败记录不计入汇总（与小程序口径一致）
    var total = rows.reduce(function (s, r) { return s + (r.status === '失败' ? 0 : r.out) }, 0)
    var fee = rows.reduce(function (s, r) { return s + (r.status === '失败' ? 0 : r.fee) }, 0)

    var listEl = dom.qs('#rx-list', view.root)
    dom.renderList(listEl, rows, rowHTML)
    dom.toggle(dom.qs('#rx-card', view.root), rows.length > 0)
    dom.toggle(dom.qs('#rx-empty', view.root), rows.length === 0)
    dom.qs('#rx-count', view.root).textContent = '共 ' + rows.length + ' 条记录'
    dom.qs('#rx-total', view.root).textContent = PP.format.fmtNum(total) + ' CNH'
    dom.qs('#rx-fee', view.root).textContent = PP.format.fmtNum(fee) + ' CNH'

    view.rows = rows
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
      detailRow('交易流水号', dom.esc(r.no), 'num') +
      detailRow('时间', dom.esc(r.time)) +
      detailRow('类型', dom.esc(r.type)) +
      detailRow('提现账户', dom.esc(r.bankName)) +
      detailRow('账号名称', dom.esc(r.accountName)) +
      detailRow('账号', dom.esc(r.accountNo), 'num') +
      detailRow('提现账号备注', dom.esc(r.accountRemark)) +
      detailRow('付款金额', dom.esc(r.payText) + ' CNH', 'num') +
      detailRow('手续费', dom.esc(r.feeText) + ' CNH', 'num') +
      detailRow('汇出金额', dom.esc(r.outText) + ' CNH', 'num rx-strong') +
      detailRow('状态', dom.esc(r.status))
    )
  }

  function openDetail(r) {
    PP.ui.sheet({
      title: '结汇记录详情',
      body: detailBody(r)
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('rmb-exchange-records', {
    mount: function (root, ctx) {
      view = {
        root: root,
        list: RECORDS.map(decorate),
        rows: [],
        status: 'all'
      }

      var offs = [
        dom.on(root, 'click', '[data-key]', function (e, el) {
          var key = el.getAttribute('data-key')
          if (key === view.status) return
          view.status = key
          dom.qsa('[data-key]', root).forEach(function (btn) {
            btn.setAttribute('aria-selected', btn.getAttribute('data-key') === key ? 'true' : 'false')
          })
          applyFilter()
        }),

        dom.on(root, 'click', '.rec-main', function (e, el) {
          var id = el.getAttribute('data-id')
          var row = view.rows.filter(function (r) { return r.id === id })[0]
          if (row) openDetail(row)
        })
      ]

      applyFilter()

      ctx.onCleanup(function () {
        offs.forEach(function (off) { off() })
        view = null
      })
    }
  })
})((window.PP = window.PP || {}))
