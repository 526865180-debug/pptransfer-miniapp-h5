/* ============================================================
   pages/rmb-exchange.js · 人民币结汇
   ------------------------------------------------------------
   职责只有渲染两条同构列表：结汇入口与优势信息。
   跳转全部声明在生成的标记上，由 app.js 的全局委托处理：
     data-go="rmb-exchange-withdraw"  → 进入结汇提现
     data-demo="文案"                 → 演示占位提示
   所以本页没有任何导航代码，日后接入真实路由只改常量。

   入口按 hidden 过滤（见 visibleEntries）：企业结汇当前不上线，
   数据留在表里并打 hidden 标记，恢复时删掉该字段即可。
   ============================================================ */
(function (PP) {
  'use strict'

  /** 结汇入口（演示数据，字段与接口同名） */
  var ENTRIES = [
    {
      key: 'withdraw',
      tone: 'blue',
      icon: 'i-coin',
      title: '结汇提现',
      desc: '将外币资金结汇为人民币，提现至绑定的境内银行账户',
      coming: false,
      go: 'rmb-exchange-withdraw'
    },
    {
      key: 'corporate',
      tone: 'success',
      icon: 'i-bldg',
      title: '企业结汇',
      desc: '企业批量结汇，支持大额对公转账，合规高效',
      coming: true,
      demo: '企业结汇即将上线',
      hidden: true
    }
  ]

  /** 优势信息（演示数据）
      tone 统一取 blue：本页视觉语言收敛为「一支品牌蓝 + 中性灰」，
      三条信息靠图标形状与文案区分。沿用 success/warning 会让页面同时
      出现蓝绿橙三种互不关联的色相，打散整页色调。 */
  var INFO_CARDS = [
    {
      tone: 'blue',
      icon: 'i-clock',
      title: '到账时效',
      desc: '工作日 9:00-17:00 提交，最快 30 分钟到账'
    },
    {
      tone: 'blue',
      icon: 'i-shield',
      title: '合规保障',
      desc: '全流程合规申报，支持报关单/合同/发票等凭证上传'
    },
    {
      tone: 'blue',
      icon: 'i-chart',
      title: '汇率优势',
      desc: '实时市场汇率，大额结汇享专属优惠汇率'
    }
  ]

  /** 在当前上架范围内的入口 */
  function visibleEntries() {
    return ENTRIES.filter(function (item) { return !item.hidden })
  }

  /* ---------------------------------------------- 渲染片段 */

  function entryRow(item) {
    var esc = PP.dom.esc
    var action = item.go
      ? ' data-go="' + esc(item.go) + '"'
      : (item.demo ? ' data-demo="' + esc(item.demo) + '"' : '')

    return (
      '<button type="button" class="entry" data-entry="' + esc(item.key) + '"' + action + '>' +
      '<span class="tile entry-tile" data-tone="' + esc(item.tone) + '">' +
      '<svg aria-hidden="true"><use href="#' + esc(item.icon) + '"/></svg></span>' +
      '<span class="entry-body">' +
      '<span class="entry-title-row">' +
      '<span class="entry-title">' + esc(item.title) + '</span>' +
      (item.coming ? '<span class="entry-coming">即将上线</span>' : '') +
      '</span>' +
      '<span class="entry-desc">' + esc(item.desc) + '</span>' +
      '</span>' +
      '<svg class="entry-arrow" aria-hidden="true"><use href="#i-chevron-right"/></svg>' +
      '</button>'
    )
  }

  function infoRow(item) {
    var esc = PP.dom.esc
    return (
      '<li class="info-item">' +
      '<span class="tile info-icon" data-tone="' + esc(item.tone) + '">' +
      '<svg aria-hidden="true"><use href="#' + esc(item.icon) + '"/></svg></span>' +
      '<span class="info-body">' +
      '<span class="info-title">' + esc(item.title) + '</span>' +
      '<span class="info-desc">' + esc(item.desc) + '</span>' +
      '</span>' +
      '</li>'
    )
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('rmb-exchange', {
    mount: function (root) {
      PP.dom.renderList(PP.dom.qs('#entry-list', root), visibleEntries(), entryRow)
      PP.dom.renderList(PP.dom.qs('#info-list', root), INFO_CARDS, infoRow)
    }
  })
})((window.PP = window.PP || {}))
