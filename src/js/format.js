/* ============================================================
   format.js · 数值 / 日期格式化
   ------------------------------------------------------------
   金额一律走千分位 + 固定小数位，并用等宽数字字体渲染，
   这样列表里上下相邻的金额小数点能对齐。
   ============================================================ */
(function (PP) {
  'use strict'

  /**
   * 千分位 + 固定小数位
   *   fmtNum(1723225.51)     → '1,723,225.51'
   *   fmtNum(890, 0)         → '890'
   */
  function fmtNum(value, digits) {
    var d = typeof digits === 'number' ? digits : 2
    var parts = Number(value || 0).toFixed(d).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return parts.join('.')
  }

  /** 带币种符号：withSymbol('¥', 890) → '¥ 890.00' */
  function withSymbol(symbol, value, digits) {
    return (symbol ? symbol + ' ' : '') + fmtNum(value, digits)
  }

  /** 带正负号的涨跌幅：growth(2.4) → '+2.4%' */
  function growth(value, digits) {
    var d = typeof digits === 'number' ? digits : 2
    var n = Number(value || 0)
    return (n >= 0 ? '+' : '') + n.toFixed(d) + '%'
  }

  /** 涨跌方向：'up' | 'down' | 'flat'（国内惯例：涨红跌绿） */
  function trend(value) {
    var n = Number(value || 0)
    if (n > 0) return 'up'
    if (n < 0) return 'down'
    return 'flat'
  }

  /** YYYY-MM-DD */
  function isoDate(date) {
    var d = date ? new Date(date) : new Date()
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-')
  }

  /** YYYY-MM-DD HH:mm */
  function isoDateTime(date) {
    var d = date ? new Date(date) : new Date()
    return isoDate(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0')
  }

  /** 手机号 / 账号脱敏：6222****1234 */
  function maskAccount(value, head, tail) {
    var s = String(value || '')
    var h = head === undefined ? 4 : head
    var t = tail === undefined ? 4 : tail
    if (s.length <= h + t) return s
    return s.slice(0, h) + '****' + s.slice(-t)
  }

  PP.format = {
    fmtNum: fmtNum,
    withSymbol: withSymbol,
    growth: growth,
    trend: trend,
    isoDate: isoDate,
    isoDateTime: isoDateTime,
    maskAccount: maskAccount
  }
})((window.PP = window.PP || {}))
