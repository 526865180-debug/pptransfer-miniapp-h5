/* ============================================================
   store.js · 全局状态
   ------------------------------------------------------------
   只放真正跨页面共享的状态。页面私有数据一律留在页面模块内部，
   避免 store 变成什么都往里塞的杂物间。
   当前仅有四类：当前用户、商户信息、未读数、金额脱敏开关。
   ============================================================ */
(function (PP) {
  'use strict'

  var state = {
    /** 当前登录用户（演示数据，待接登录态） */
    user: {
      name: '顾人',
      role: '超级管理员'
    },
    /** 未读消息数，消息通知页「打开即已读」会清零 */
    unread: 6,
    /** 金额脱敏开关，首页眼睛图标控制；由 body[data-amount-hidden] 驱动全站 */
    amountVisible: true
  }

  var listeners = []

  function get(key) {
    return key === undefined ? state : state[key]
  }

  /** 浅合并写状态并通知订阅者 */
  function set(patch) {
    var changed = false
    Object.keys(patch).forEach(function (k) {
      if (state[k] !== patch[k]) {
        state[k] = patch[k]
        changed = true
      }
    })
    if (changed) listeners.forEach(function (fn) { fn(state) })
    return state
  }

  /** 订阅全局变化，返回退订函数（页面卸载时调用，防止内存泄漏） */
  function subscribe(fn) {
    listeners.push(fn)
    return function unsubscribe() {
      var i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  }

  PP.store = {
    get: get,
    set: set,
    subscribe: subscribe
  }
})((window.PP = window.PP || {}))
