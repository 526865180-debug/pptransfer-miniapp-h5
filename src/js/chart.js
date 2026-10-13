/* ============================================================
   chart.js · 汇率走势图（原生 Canvas）
   ------------------------------------------------------------
   替代 echarts-for-weixin / ECharts。只需要一条平滑折线 + 渐变面积
   + 虚线网格 + 当前价标注，用 Canvas 手绘比引入 400KB 的图表库划算得多。
   视觉规格与原 ECharts option 保持一致：
     折线 #2563eb / 2px、面积渐变 0.18→0.01、
     网格 #f1f5f9 虚线、当前价标注 #f59e0b 虚线 + 4 位小数
   ============================================================ */
(function (PP) {
  'use strict'

  var HOUR = 3600 * 1000
  var DAY = 24 * HOUR

  /** 币对基准价（对齐 Web 版 exchange.html 的 7.2345 量级） */
  var BASE_RATES = {
    'USD/CNH': 7.2214,
    'EUR/CNH': 7.8602,
    'GBP/CNH': 9.1743
  }

  var RANGES = {
    '24H': { points: 24, unit: HOUR, volatility: 0.006, labelInterval: 3 },
    '7D': { points: 7, unit: DAY, volatility: 0.012, labelInterval: 0 },
    '30D': { points: 30, unit: DAY, volatility: 0.02, labelInterval: 5 }
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n
  }

  /** 确定性伪随机（固定种子）—— 保证每次进入页面走势一致，不会「每次刷新都变」 */
  function seededRandom(seed) {
    var s = seed
    return function () {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
  }

  /**
   * 生成走势数据
   * @returns {{dates:string[], rates:number[], currentRate:number, change:string, changeValue:number, up:boolean}}
   */
  function buildRateSeries(pair, range) {
    var conf = RANGES[range] || RANGES['7D']
    var base = BASE_RATES[pair] || 7.2214
    var rand = seededRandom(20260401 + conf.points * 7 + Math.round(base * 100))
    var dates = []
    var rates = []
    var now = new Date()
    var rate = base - conf.volatility * 2

    for (var i = conf.points - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * conf.unit)
      dates.push(range === '24H'
        ? pad2(d.getHours()) + ':00'
        : (d.getMonth() + 1) + '/' + d.getDate())
      rate += (rand() - 0.48) * conf.volatility
      rate = Math.max(base * 0.97, Math.min(base * 1.03, rate))
      rates.push(Math.round(rate * 10000) / 10000)
    }

    var currentRate = rates[rates.length - 1]
    var first = rates[0]
    var pct = ((currentRate - first) / first) * 100
    return {
      dates: dates,
      rates: rates,
      currentRate: currentRate,
      changeValue: pct,
      change: (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%',
      up: pct >= 0
    }
  }

  var PADDING = { left: 34, right: 44, top: 14, bottom: 20 }

  /**
   * 走势图控制器
   * 生命周期：new RateChart(canvas) → render(series) →（容器尺寸变化时）resize()
   */
  function RateChart(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.series = null
    this.off = null // ResizeObserver 解绑
  }

  RateChart.prototype.render = function (series) {
    this.series = series
    this.paint()
    if (!this.off && window.ResizeObserver) {
      var self = this
      var ro = new ResizeObserver(function () { self.paint() })
      ro.observe(this.canvas)
      this.off = function () { ro.disconnect() }
    }
  }

  RateChart.prototype.destroy = function () {
    if (this.off) this.off()
    this.off = null
    this.series = null
  }

  RateChart.prototype.paint = function () {
    var s = this.series
    if (!s || !s.rates.length) return

    var canvas = this.canvas
    var ctx = this.ctx
    var dpr = window.devicePixelRatio || 1

    // 尺寸取父容器实测值，避免 canvas 撑大布局
    var w = Math.max(canvas.parentNode.clientWidth, 40)
    var h = Math.max(canvas.parentNode.clientHeight, 40)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    var plotW = w - PADDING.left - PADDING.right
    var plotH = h - PADDING.top - PADDING.bottom
    if (plotW <= 10 || plotH <= 10) return

    var rates = s.rates
    var min = Math.min.apply(null, rates)
    var max = Math.max.apply(null, rates)
    if (max === min) {
      max += 0.001
      min -= 0.001
    }
    // 上下各留 8% 余量，曲线不贴边
    var span = max - min
    min -= span * 0.08
    max += span * 0.08

    function x(i) {
      return PADDING.left + (rates.length === 1 ? plotW / 2 : (plotW * i) / (rates.length - 1))
    }
    function y(v) {
      return PADDING.top + plotH - ((v - min) / (max - min)) * plotH
    }

    ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--font-num')

    /* ---- 横向网格（3 条，虚线） ---- */
    ctx.save()
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    var split = 3
    for (var g = 0; g <= split; g++) {
      var gy = PADDING.top + (plotH * g) / split
      ctx.beginPath()
      ctx.moveTo(PADDING.left, gy)
      ctx.lineTo(PADDING.left + plotW, gy)
      ctx.stroke()
    }
    ctx.restore()

    /* ---- y 轴刻度：窄区间用 3 位小数，避免出现 7.21/7.21/7.20 重复标签 ---- */
    var decimals = (max - min) < 0.1 ? 3 : 2
    ctx.save()
    ctx.fillStyle = '#94a3b8'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (var t = 0; t <= split; t++) {
      var v = max - ((max - min) * t) / split
      ctx.fillText(v.toFixed(decimals), PADDING.left - 6, PADDING.top + (plotH * t) / split)
    }
    ctx.restore()

    /* ---- x 轴标签 ---- */
    var conf = null
    for (var k in RANGES) {
      if (RANGES[k].points === rates.length) conf = RANGES[k]
    }
    var interval = conf ? conf.labelInterval : Math.ceil(rates.length / 6)
    ctx.save()
    ctx.fillStyle = '#94a3b8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (var i2 = 0; i2 < s.dates.length; i2++) {
      if (i2 % (interval + 1) !== 0 && i2 !== s.dates.length - 1) continue
      ctx.fillText(s.dates[i2], x(i2), PADDING.top + plotH + 5)
    }
    ctx.restore()

    /* ---- 面积（品牌蓝渐变） ---- */
    var grad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + plotH)
    grad.addColorStop(0, 'rgba(37,99,235,0.18)')
    grad.addColorStop(1, 'rgba(37,99,235,0.01)')

    var pts = rates.map(function (v, i) { return { x: x(i), y: y(v) } })

    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    strokeSmooth(ctx, pts, false)
    ctx.lineTo(pts[pts.length - 1].x, PADDING.top + plotH)
    ctx.lineTo(pts[0].x, PADDING.top + plotH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    /* ---- 折线 ---- */
    ctx.beginPath()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#2563eb'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.moveTo(pts[0].x, pts[0].y)
    strokeSmooth(ctx, pts, true)
    ctx.stroke()

    /* ---- 当前价标注（琥珀色虚线 + 4 位小数） ---- */
    var cy = y(s.currentRate)
    ctx.save()
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(PADDING.left, cy)
    ctx.lineTo(PADDING.left + plotW, cy)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.fillStyle = '#d97706'
    ctx.font = 'bold 10px ' + getComputedStyle(document.body).getPropertyValue('--font-num')
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(s.currentRate.toFixed(4), PADDING.left + plotW + 3, cy)
    ctx.restore()
  }

  /**
   * 用 Catmull-Rom 转三次贝塞尔画平滑曲线。
   * 直接连线会有折角，ECharts 的 smooth 就是这个效果。
   * includeFirst=false 时假定当前点已在路径起点上。
   */
  function strokeSmooth(ctx, pts, includeFirst) {
    if (pts.length < 3) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      return
    }
    var tension = 0.22
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[j - 1] || pts[j]
      var p1 = pts[j]
      var p2 = pts[j + 1]
      var p3 = pts[j + 2] || p2
      var c1x = p1.x + (p2.x - p0.x) * tension
      var c1y = p1.y + (p2.y - p0.y) * tension
      var c2x = p2.x - (p3.x - p1.x) * tension
      var c2y = p2.y - (p3.y - p1.y) * tension
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y)
    }
  }

  PP.chart = {
    BASE_RATES: BASE_RATES,
    RANGES: RANGES,
    buildRateSeries: buildRateSeries,
    RateChart: RateChart
  }
})((window.PP = window.PP || {}))
