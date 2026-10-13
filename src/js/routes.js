/* ============================================================
   routes.js · 路由表
   ------------------------------------------------------------
   13 个页面的唯一真源：导航栏标题、tabBar 归属、片段文件名。
   router 与 tabBar 都从这里读，避免两处各写一份对不上。
   ============================================================ */
(function (PP) {
  'use strict'

  /* ---------- 页面注册表 ----------
     必须先于页面脚本可用：每个页面的 JS 都会调 definePage。 */
  PP.pages = PP.pages || {}
  PP.definePage = function (name, def) {
    PP.pages[name] = def
  }

  PP.ROUTES = [
    /* ---------- tabBar 四页 ---------- */
    { name: 'index', title: 'PPTransfer 商户端', tab: { text: '首页', icon: 'i-home' } },
    { name: 'trade-collection', title: '外贸收款管理', tab: { text: '收款', icon: 'i-banknote' } },
    { name: 'in-transit-funds', title: '在途资金', tab: { text: '在途资金', icon: 'i-clock' } },
    { name: 'rights-center', title: '权益中心', tab: { text: '权益中心', icon: 'i-crown' } },

    /* ---------- 二级页 ---------- */
    { name: 'order-management', title: '订单管理' },
    { name: 'exchange', title: '换汇中心' },
    { name: 'international-remittance', title: '国际汇款' },
    { name: 'rmb-exchange', title: '人民币结汇' },
    { name: 'rmb-exchange-withdraw', title: '结汇提现' },
    { name: 'rmb-exchange-records', title: '结汇记录' },
    { name: 'wallet', title: '我的资产' },
    { name: 'collection', title: '外贸收款账户' },
    { name: 'notifications', title: '消息通知' }
  ]

  /** name → route 的快查表 */
  PP.routeOf = function (name) {
    for (var i = 0; i < PP.ROUTES.length; i++) {
      if (PP.ROUTES[i].name === name) return PP.ROUTES[i]
    }
    return null
  }

  /** tabBar 页顺序 */
  PP.TAB_ROUTES = PP.ROUTES.filter(function (r) { return !!r.tab })
})((window.PP = window.PP || {}))
