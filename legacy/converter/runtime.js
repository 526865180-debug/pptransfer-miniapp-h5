/* ============================================================
   PPTransfer H5 Runtime
   在浏览器中还原小程序（WXML / WXSS / JS）为可交互 H5 应用

   构建期注入：
     window.__H5_IMG__     图片名 -> dataURI
     window.__H5_PAGES__   页面元信息（标题 / 是否 tab / tab 图标）
     window.__H5_MODULES__ 被 require 的 js 模块（chart.js / format.js）
     window.__H5_REGISTER__(name, factory)  注册页面 JS
   ============================================================ */
(function (window, document) {

  var IMG = window.__H5_IMG__ || {}
  var PAGES_META = window.__H5_PAGES__ || []
  var MODULE_DEFS = window.__H5_MODULES__ || {}

  /* ============================================================
     0. 工具
     ============================================================ */
  function warn() {
    if (window.console && console.warn) console.warn.apply(console, arguments)
  }

  function deepClone(v) {
    if (Array.isArray(v)) return v.map(deepClone)
    if (v && typeof v === 'object') {
      var o = {}
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deepClone(v[k])
      return o
    }
    return v
  }

  // 1rem === 10rpx（构建期已把 rpx 换算为 rem）
  function setRootSize() {
    var w = Math.min(document.documentElement.clientWidth || 375, 430)
    document.documentElement.style.fontSize = (w / 75) + 'px'
  }

  /* ============================================================
     1. 迷你模块系统（兼容 require/module.exports 写法）
     ============================================================ */
  var MODULE_CACHE = {}

  function requireShim(path) {
    var key = String(path).replace(/^.*[\\\/]/, '')
    if (key === 'echarts.js') return ECHARTS
    if (MODULE_CACHE[key]) return MODULE_CACHE[key].exports
    var factory = MODULE_DEFS[key]
    if (!factory) { warn('[h5] 模块缺失:', path); return {} }
    var mod = { exports: {} }
    MODULE_CACHE[key] = mod
    factory(requireShim, mod, mod.exports, getApp, Page, WX)
    return mod.exports
  }

  /* ============================================================
     2. App / Page 注册
     ============================================================ */
  var APP = null
  function App(cfg) {
    APP = cfg
    if (typeof cfg.onLaunch === 'function') {
      try { cfg.onLaunch.call(cfg) } catch (e) { warn('[h5] onLaunch 异常', e) }
    }
  }
  function getApp() { return APP }

  var PAGE_DEFS = {}
  var REGISTER_NAME = ''
  function Page(cfg) { PAGE_DEFS[REGISTER_NAME] = cfg }

  window.__H5_REGISTER__ = function (name, factory) {
    REGISTER_NAME = name
    try {
      factory(requireShim, { exports: {} }, {}, getApp, Page, WX)
    } catch (e) {
      warn('[h5] 页面 ' + name + ' 脚本执行异常', e)
    }
  }

  /* ============================================================
     3. 表达式求值 / 插值
     ============================================================ */
  var EXPR_CACHE = {}

  function compileExpr(expr) {
    var fn = EXPR_CACHE[expr]
    if (!fn) {
      try {
        // 小程序模板表达式是 JS 子集，直接交给 JS 求值
        fn = new Function('$s', 'with($s){try{return (' + expr + ')}catch(e){return undefined}}')
      } catch (e) {
        fn = function () { return undefined }
      }
      EXPR_CACHE[expr] = fn
    }
    return fn
  }

  function evalExpr(expr, scope) {
    try { return compileExpr(expr)(scope) } catch (e) { return undefined }
  }

  var SINGLE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/

  function interpolate(str, scope) {
    var single = SINGLE_RE.exec(str)
    if (single) return evalExpr(single[1], scope)
    return str.replace(/\{\{([\s\S]+?)\}\}/g, function (_, e) {
      var v = evalExpr(e, scope)
      return v === null || v === undefined ? '' : String(v)
    })
  }

  /* ============================================================
     4. 图片路径映射（/images/x.png -> dataURI）
     ============================================================ */
  function mapImgSrc(node) {
    var src = node.getAttribute('src') || ''
    var m = /\/images\/([^\/?#]+\.(?:png|jpe?g|gif|svg))$/i.exec(src)
    if (!m) return
    var key = m[1]
    if (IMG[key]) node.setAttribute('src', IMG[key])
    else warn('[h5] 图片缺失:', src)
  }

  /* ============================================================
     5. 模板渲染引擎
     ============================================================ */
  var SKIP_ATTR = /^(data-wx-|data-on-|data-hover-class$|data-h5)/

  function isElement(n) { return n && n.nodeType === 1 }

  function processNode(node, scope) {
    if (node.nodeType === 3) {
      var t = node.nodeValue
      if (t.indexOf('{{') >= 0) node.nodeValue = String(interpolate(t, scope) || '')
      return
    }
    if (!isElement(node)) return

    // --- wx:for ---
    if (node.hasAttribute('data-wx-for')) {
      var list = evalExpr(node.getAttribute('data-wx-for'), scope)
      var itemName = node.getAttribute('data-wx-for-item') || 'item'
      var indexName = node.getAttribute('data-wx-for-index') || 'index'
      var parent = node.parentNode
      if (!parent) return
      if (list && typeof list.length === 'number' && list.length) {
        for (var i = 0; i < list.length; i++) {
          var clone = node.cloneNode(true)
          clone.removeAttribute('data-wx-for')
          clone.removeAttribute('data-wx-for-item')
          clone.removeAttribute('data-wx-for-index')
          clone.removeAttribute('data-wx-key')
          var sub = Object.create(scope)
          sub[itemName] = list[i]
          sub[indexName] = i
          parent.insertBefore(clone, node)
          processNode(clone, sub)
        }
      }
      parent.removeChild(node)
      return
    }

    // --- 属性 ---
    processAttrs(node, scope)

    // --- 子节点 ---
    processChildren(node, scope)
  }

  // 处理一层子节点，专职解决 wx:if / wx:elif / wx:else 的条件组
  function processChildren(parent, scope) {
    var children = Array.prototype.slice.call(parent.childNodes)
    var i = 0
    while (i < children.length) {
      var node = children[i]
      if (isElement(node) && node.hasAttribute('data-wx-if')) {
        var group = [node]
        var j = i + 1
        while (j < children.length) {
          var nx = children[j]
          if (isElement(nx) && (nx.hasAttribute('data-wx-elif') || nx.hasAttribute('data-wx-else'))) {
            group.push(nx); j++
          } else break
        }
        var chosen = null
        for (var k = 0; k < group.length; k++) {
          var n = group[k]
          var cond
          if (k === 0) cond = !!evalExpr(n.getAttribute('data-wx-if'), scope)
          else if (n.hasAttribute('data-wx-elif')) cond = !!evalExpr(n.getAttribute('data-wx-elif'), scope)
          else cond = true
          if (cond) { chosen = n; break }
        }
        for (var g = 0; g < group.length; g++) {
          if (group[g] !== chosen && group[g].parentNode === parent) parent.removeChild(group[g])
        }
        if (chosen) {
          chosen.removeAttribute('data-wx-if')
          chosen.removeAttribute('data-wx-elif')
          chosen.removeAttribute('data-wx-else')
          processNode(chosen, scope)
        }
        i = j
      } else {
        processNode(node, scope)
        i++
      }
    }
  }

  function processAttrs(node, scope) {
    // class / style 允许混插值
    var cls = node.getAttribute('class')
    if (cls && cls.indexOf('{{') >= 0) node.setAttribute('class', String(interpolate(cls, scope) || '').replace(/\s+/g, ' ').trim())

    var style = node.getAttribute('style')
    if (style && style.indexOf('{{') >= 0) node.setAttribute('style', String(interpolate(style, scope) || ''))

    var attrs = Array.prototype.slice.call(node.attributes)
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name
      if (SKIP_ATTR.test(name) || name === 'class' || name === 'style') continue
      var val = attrs[i].value
      if (val.indexOf('{{') < 0) continue
      var out = interpolate(val, scope)
      if (out === null || out === undefined || out === false) {
        // 小程序里值为 false 的属性等价于不存在
        if (out === false) node.removeAttribute(name)
        else node.setAttribute(name, '')
      } else {
        node.setAttribute(name, String(out))
      }
    }

    if (node.tagName === 'IMG') mapImgSrc(node)

    // 动态下拉（picker mode=selector 的替代）：按 range 数据生成 option
    if (node.hasAttribute('data-h5-options')) {
      var opts = evalExpr(node.getAttribute('data-h5-options'), scope) || []
      node.innerHTML = ''
      for (var oi = 0; oi < opts.length; oi++) {
        var op = document.createElement('option')
        op.value = String(oi)
        op.textContent = String(opts[oi])
        node.appendChild(op)
      }
    }

    // 输入类控件：把 data 值同步到控件（跳过正在输入的控件，避免打断录入）
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
      var self = document.activeElement
      if (node !== self) node.value = node.hasAttribute('value') ? node.getAttribute('value') : node.value
    }
    if (node.tagName === 'SELECT') {
      var v = node.getAttribute('value')
      if (v !== null) node.value = v
    }
  }

  /* ============================================================
     6. 页面实例
     ============================================================ */
  var CURRENT_PAGE = null

  function setByPath(obj, path, value) {
    var keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    var cur = obj
    for (var i = 0; i < keys.length - 1; i++) {
      var k = keys[i]
      if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {}
      cur = cur[k]
    }
    cur[keys[keys.length - 1]] = value
  }

  function createPageInstance(name) {
    var def = PAGE_DEFS[name]
    if (!def) { warn('[h5] 页面未注册:', name); def = { data: {} } }

    var inst = Object.create(def)
    inst.__name = name
    inst.data = deepClone(def.data || {})

    var body = document.querySelector('#pg-' + name + ' .h5-body')
    inst.__body = body

    inst.setData = function (patch, cb) {
      if (patch) {
        for (var k in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue
          if (k.indexOf('.') > 0 || k.indexOf('[') > 0) setByPath(inst.data, k, patch[k])
          else inst.data[k] = patch[k]
        }
      }
      if (inst.__rendered) renderPage(inst)
      if (typeof cb === 'function') { try { cb.call(inst) } catch (e) { warn(e) } }
    }

    inst.selectComponent = function (sel) {
      return makeComponentHandle(inst, sel)
    }
    inst.createSelectorQuery = function () { return makeSelectorQuery(inst) }

    return inst
  }

  function renderPage(page) {
    var body = page.__body
    if (!body) return

    var prevScroll = body.scrollTop
    var prevHScroll = []
    var hs = body.querySelectorAll('.h5-scroll-x')
    for (var h = 0; h < hs.length; h++) prevHScroll.push(hs[h].scrollLeft)
    var focusSnap = captureFocus(body)

    // 整页重渲染会销毁 canvas（位图与实例随之丢失），先抢救再归位
    var savedCharts = []
    var hosts = body.querySelectorAll('.h5-chart-host')
    for (var ci = 0; ci < hosts.length; ci++) {
      if (hosts[ci].firstChild) savedCharts.push({ id: hosts[ci].id, node: hosts[ci].firstChild })
    }

    var tpl = document.getElementById('tpl-' + page.__name)
    var frag
    if (tpl) frag = tpl.content.cloneNode(true)
    else frag = document.createDocumentFragment()

    var holder = document.createElement('div')
    holder.appendChild(frag)
    try {
      processChildren(holder, page.data)
    } catch (e) {
      warn('[h5] 渲染 ' + page.__name + ' 出错', e)
    }

    body.innerHTML = ''
    while (holder.firstChild) body.appendChild(holder.firstChild)

    // 把图表画布放回重建后的容器
    for (var cj = 0; cj < savedCharts.length; cj++) {
      var sel = '.h5-chart-host' + (savedCharts[cj].id ? '#' + savedCharts[cj].id : '')
      var target = body.querySelector(sel)
      if (target && !target.firstChild) target.appendChild(savedCharts[cj].node)
    }

    body.scrollTop = prevScroll
    var hs2 = body.querySelectorAll('.h5-scroll-x')
    for (var h2 = 0; h2 < hs2.length && h2 < prevHScroll.length; h2++) {
      hs2[h2].scrollLeft = prevHScroll[h2]
    }
    restoreFocus(body, focusSnap)
  }

  /* ---------- 焦点保持（整页重渲染后恢复输入状态） ---------- */
  function nodePath(node, root) {
    var path = []
    var n = node
    while (n && n !== root) {
      var p = n.parentNode
      if (!p) return null
      path.unshift(Array.prototype.indexOf.call(p.childNodes, n))
      n = p
    }
    return n === root ? path : null
  }

  function captureFocus(root) {
    var ae = document.activeElement
    if (!ae || !root.contains(ae)) return null
    var path = nodePath(ae, root)
    if (!path) return null
    var snap = { path: path }
    try { if (typeof ae.selectionStart === 'number') { snap.start = ae.selectionStart; snap.end = ae.selectionEnd } } catch (e) {}
    return snap
  }

  function restoreFocus(root, snap) {
    if (!snap) return
    var n = root
    for (var i = 0; i < snap.path.length; i++) {
      n = n.childNodes[snap.path[i]]
      if (!n) return
    }
    if (typeof n.focus !== 'function') return
    try {
      n.focus()
      if (typeof snap.start === 'number' && typeof n.setSelectionRange === 'function') {
        n.setSelectionRange(snap.start, snap.end)
      }
    } catch (e) {}
  }

  /* ============================================================
     7. 事件分发（委托到页面容器，重渲染后无需重新绑定）
     ============================================================ */
  var EVT_MAP = { tap: 'click', input: 'input', change: 'change', focus: 'focus', blur: 'blur', confirm: 'confirm' }

  function datasetOf(el) {
    var ds = {}
    if (!el || !el.dataset) return ds
    for (var k in el.dataset) if (Object.prototype.hasOwnProperty.call(el.dataset, k)) ds[k] = el.dataset[k]
    return ds
  }

  function trigger(fnName, page, evtEl, rawEvent, detail) {
    var handler = page[fnName]
    if (typeof handler !== 'function') {
      warn('[h5] 方法未定义: ' + fnName + '()')
      return
    }
    var ev = {
      type: rawEvent.type,
      timeStamp: rawEvent.timeStamp,
      target: { dataset: datasetOf(rawEvent.target), id: rawEvent.target.id || '' },
      currentTarget: { dataset: datasetOf(evtEl), id: evtEl.id || '' },
      detail: detail || {}
    }
    try { handler.call(page, ev) } catch (e) { warn('[h5] ' + fnName + '() 抛出异常', e) }
  }

  function dispatch(rawEvent, type, page) {
    var container = page.__body
    var handlers = []
    var el = rawEvent.target
    while (el && el !== container && el.nodeType === 1) {
      var fn = el.getAttribute('data-on-' + type)
      var cfn = el.getAttribute('data-on-' + type + '-catch')
      if (fn) handlers.push({ el: el, fn: fn, stop: false })
      if (cfn) { handlers.push({ el: el, fn: cfn, stop: true }); break }
      el = el.parentElement
    }
    if (!handlers.length) return

    var detail = {}
    if (type === 'input') detail = { value: rawEvent.target.value, cursor: rawEvent.target.value.length }
    else if (type === 'change') {
      detail = { value: rawEvent.target.type === 'checkbox' ? rawEvent.target.checked : rawEvent.target.value }
    }
    // 内层 -> 外层，遇 catch 停止冒泡
    for (var i = 0; i < handlers.length; i++) {
      trigger(handlers[i].fn, page, handlers[i].el, rawEvent, detail)
      if (handlers[i].stop) break
    }
  }

  function bindEvents(page) {
    var body = page.__body
    if (!body || body.__bound) return
    body.__bound = true
    Object.keys(EVT_MAP).forEach(function (type) {
      var domType = EVT_MAP[type]
      if (domType === 'confirm') {
        body.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') dispatch(e, 'confirm', page)
        }, false)
      } else {
        body.addEventListener(domType, function (e) {
          if (e.target && e.target.nodeType !== 1) return
          dispatch(e, type, page)
        }, false)
      }
    })
  }

  /* ============================================================
     8. wx.* API 实现
     ============================================================ */
  function showToast(opt) {
    var el = document.getElementById('h5-toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'h5-toast'
      document.body.appendChild(el)
    }
    var icon = opt.icon
    var html = ''
    if (icon === 'success') html += '<div class="h5-toast-ico ok">✓</div>'
    if (icon === 'error') html += '<div class="h5-toast-ico err">✕</div>'
    html += '<div class="h5-toast-text">' + escapeHtml(opt.title || '') + '</div>'
    el.innerHTML = html
    el.classList.add('show')
    clearTimeout(el.__t)
    el.__t = setTimeout(function () { el.classList.remove('show') }, opt.duration || 1600)
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function showModal(opt) {
    var wrap = document.createElement('div')
    wrap.className = 'h5-modal-mask'
    var showCancel = opt.showCancel !== false
    wrap.innerHTML =
      '<div class="h5-modal">' +
        '<div class="h5-modal-title">' + escapeHtml(opt.title || '提示') + '</div>' +
        (opt.content ? '<div class="h5-modal-body">' + escapeHtml(opt.content) + '</div>' : '') +
        '<div class="h5-modal-foot">' +
          (showCancel ? '<div class="h5-modal-btn" data-act="cancel">' + escapeHtml(opt.cancelText || '取消') + '</div>' : '') +
          '<div class="h5-modal-btn primary" data-act="confirm">' + escapeHtml(opt.confirmText || '确定') + '</div>' +
        '</div>' +
      '</div>'
    document.body.appendChild(wrap)
    requestAnimationFrame(function () { wrap.classList.add('show') })

    function done(ok) {
      wrap.classList.remove('show')
      setTimeout(function () { wrap.parentNode && wrap.parentNode.removeChild(wrap) }, 200)
      if (ok) { opt.success && opt.success({ confirm: true, cancel: false }) }
      else { opt.fail && opt.fail({ confirm: false, cancel: true }); opt.complete && opt.complete({}) }
    }
    wrap.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act')
      if (act === 'confirm') done(true)
      else if (act === 'cancel' || e.target === wrap) done(false)
    })
  }

  function copyText(text) {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(ta)
    ta.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
    if (!ok && navigator.clipboard) {
      try { navigator.clipboard.writeText(text) } catch (e) {}
    }
    return true
  }

  function makeSelectorQuery(inst) {
    var ops = []
    var api = {
      in: function () { return api },
      select: function (sel) { ops.push({ sel: sel, all: false }); return api },
      selectAll: function (sel) { ops.push({ sel: sel, all: true }); return api },
      selectViewport: function () { ops.push({ viewport: true }); return api },
      boundingClientRect: function (cb) { api.__cb = cb; return api },
      scrollOffset: function (cb) { api.__cb = cb; return api },
      fields: function () { return api },
      exec: function (cb) {
        var body = inst.__body
        var res = ops.map(function (op) {
          if (op.viewport) return { scrollTop: body.scrollTop, scrollLeft: body.scrollLeft }
          var els = op.all ? Array.prototype.slice.call(body.querySelectorAll(op.sel)) : [body.querySelector(op.sel)]
          var out = els.map(function (el) {
            if (!el) return null
            var r = el.getBoundingClientRect()
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, id: el.id }
          })
          return op.all ? out : out[0]
        })
        if (typeof cb === 'function') cb(res)
        if (typeof api.__cb === 'function') api.__cb(res)
      }
    }
    return api
  }

  // selectComponent('#x').init(cb) —— 为图表容器创建 canvas 并回调
  function makeComponentHandle(inst, sel) {
    return {
      init: function (cb) {
        var host = inst.__body.querySelector(sel)
        if (!host) { warn('[h5] 组件容器未找到:', sel); return }
        var box = host.closest('.chart-box') || host.parentElement
        var w = Math.max(box.clientWidth || 300, 40)
        var h = Math.max(box.clientHeight || 150, 40)
        var canvas = document.createElement('canvas')
        canvas.className = 'h5-chart-canvas'
        host.innerHTML = ''
        host.appendChild(canvas)
        var dpr = window.devicePixelRatio || 1
        try { cb(canvas, w, h, dpr) } catch (e) { warn('[h5] 图表初始化异常', e) }
      },
      setChart: function () {}
    }
  }

  var WX = {
    showToast: function (o) { showToast(o || {}) },
    hideToast: function () {},
    showLoading: function (o) { showToast({ title: (o && o.title) || '加载中', duration: 1200 }) },
    hideLoading: function () {},
    showModal: function (o) { showModal(o || {}) },
    setClipboardData: function (o) {
      copyText((o && o.data) || '')
      o && o.success && o.success({})
      o && o.complete && o.complete({})
    },
    getClipboardData: function (o) { o && o.success && o.success({ data: '' }) },
    vibrateShort: function (o) {
      try { navigator.vibrate && navigator.vibrate(12) } catch (e) {}
      o && o.success && o.success({})
    },
    vibrateLong: function (o) { try { navigator.vibrate && navigator.vibrate(30) } catch (e) {} o && o.success && o.success({}) },
    pageScrollTo: function (o) {
      var body = CURRENT_PAGE && CURRENT_PAGE.__body
      if (body) body.scrollTop = (o && o.scrollTop) || 0
      o && o.success && o.success({})
    },
    createSelectorQuery: function () { return makeSelectorQuery(CURRENT_PAGE) },
    chooseMessageFile: function (o) {
      var input = document.createElement('input')
      input.type = 'file'
      input.accept = '.csv,.xls,.xlsx,.txt,.json'
      input.onchange = function () {
        var f = input.files && input.files[0]
        if (!f) { o && o.fail && o.fail({}); return }
        o && o.success && o.success({ tempFiles: [{ name: f.name, size: f.size, path: f.name }] })
      }
      input.click()
    },
    chooseImage: function (o) { o && o.fail && o.fail({}) },
    getSystemInfoSync: function () {
      return {
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
        pixelRatio: window.devicePixelRatio || 1,
        platform: 'devtools'
      }
    },
    nextTick: function (cb) { setTimeout(cb, 0) },
    setNavigationBarTitle: function (o) {},
    stopPullDownRefresh: function () {}
  }

  /* ============================================================
     9. 迷你 ECharts（仅实现汇率折线图所需的绘制）
     ============================================================ */
  function MiniChart(canvas, width, height, dpr) {
    this.canvas = canvas
    this.w = width
    this.h = height
    this.dpr = dpr || window.devicePixelRatio || 1
    canvas.width = Math.round(width * this.dpr)
    canvas.height = Math.round(height * this.dpr)
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    this.ctx = canvas.getContext('2d')
  }

  MiniChart.prototype.resize = function (w, h) {
    this.w = w; this.h = h
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.draw()
  }

  MiniChart.prototype.setOption = function (option) {
    this.option = option
    this.draw()
  }

  MiniChart.prototype.draw = function () {
    var o = this.option
    if (!o || !this.ctx) return
    var ctx = this.ctx
    var dpr = this.dpr
    var W = this.w, H = this.h

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    var series = o.series && o.series[0]
    if (!series) return
    var rates = series.data || []
    var dates = (o.xAxis && o.xAxis.data) || []
    if (!rates.length) return

    var yLabelFont = 10
    var padL = 36, padR = 8, padT = 14, padB = 16
    var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB
    if (x1 <= x0 || y1 <= y0) return

    var min = Math.min.apply(null, rates)
    var max = Math.max.apply(null, rates)
    var span = max - min || Math.abs(max) * 0.01 || 1
    min -= span * 0.18
    max += span * 0.18

    var n = rates.length
    function px(i) { return x0 + (n === 1 ? (x1 - x0) / 2 : (x1 - x0) * i / (n - 1)) }
    function py(v) { return y1 - (v - min) / (max - min) * (y1 - y0) }

    var pts = rates.map(function (v, i) { return { x: px(i), y: py(v) } })

    // --- y 轴网格 + 标签 ---
    var splitN = (o.yAxis && o.yAxis.splitNumber) || 3
    var yFmt = (o.yAxis && o.yAxis.axisLabel && o.yAxis.axisLabel.formatter) || function (v) { return String(v) }
    ctx.save()
    ctx.font = yLabelFont + 'px -apple-system, "PingFang SC", sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (var s = 0; s <= splitN; s++) {
      var vv = min + (max - min) * s / splitN
      var yy = py(vv)
      if (yy < y0 - 1 || yy > y1 + 1) continue
      ctx.beginPath()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = '#f1f5f9'
      ctx.lineWidth = 1
      ctx.moveTo(x0, Math.round(yy) + 0.5)
      ctx.lineTo(x1, Math.round(yy) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(String(yFmt(vv)), x0 - 5, yy)
    }
    ctx.restore()

    // --- x 轴标签 ---
    var interval = (o.xAxis && o.xAxis.axisLabel && o.xAxis.axisLabel.interval) || 0
    var step = interval + 1
    ctx.save()
    ctx.font = yLabelFont + 'px -apple-system, "PingFang SC", sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    var lastRight = -999
    for (var i = 0; i < n; i += step) {
      var label = String(dates[i] === undefined ? '' : dates[i])
      if (!label) continue
      var tw = ctx.measureText(label).width
      var cx = px(i)
      if (cx - tw / 2 < lastRight + 4) continue
      if (cx - tw / 2 < x0 - 2 || cx + tw / 2 > x1 + 2) continue
      ctx.fillText(label, cx, y1 + 4)
      lastRight = cx + tw / 2
    }
    ctx.restore()

    // --- 面积渐变 ---
    var areaColor = series.areaStyle && series.areaStyle.color
    var grad = ctx.createLinearGradient(0, y0, 0, y1)
    if (areaColor && areaColor.colorStops) {
      areaColor.colorStops.forEach(function (st) { grad.addColorStop(st.offset, st.color) })
    } else {
      grad.addColorStop(0, 'rgba(37,99,235,0.18)')
      grad.addColorStop(1, 'rgba(37,99,235,0.01)')
    }
    ctx.save()
    ctx.beginPath()
    traceSmooth(ctx, pts, series.smooth !== false)
    ctx.lineTo(pts[pts.length - 1].x, y1)
    ctx.lineTo(pts[0].x, y1)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // --- 折线 ---
    var lineColor = (series.lineStyle && series.lineStyle.color) || '#2563eb'
    var lineWidth = (series.lineStyle && series.lineStyle.width) || 2
    ctx.save()
    ctx.beginPath()
    traceSmooth(ctx, pts, series.smooth !== false)
    ctx.strokeStyle = lineColor
    ctx.lineWidth = lineWidth
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()

    // --- 当前价标注线 ---
    var ml = series.markLine
    if (ml && ml.data && ml.data.length) {
      var mv = ml.data[0].yAxis
      var my = py(mv)
      if (my >= y0 && my <= y1) {
        var lc = (ml.lineStyle && ml.lineStyle.color) || '#f59e0b'
        ctx.save()
        ctx.beginPath()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = lc
        ctx.lineWidth = (ml.lineStyle && ml.lineStyle.width) || 1
        ctx.moveTo(x0, Math.round(my) + 0.5)
        ctx.lineTo(x1, Math.round(my) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])

        var labelText = String(mv.toFixed(4))
        ctx.font = 'bold 10px -apple-system, "PingFang SC", sans-serif'
        var lw = ctx.measureText(labelText).width + 8
        var lx = x1 - lw
        var ly = my - 14
        if (ly < y0) ly = my + 3
        ctx.fillStyle = 'rgba(255, 251, 235, 0.95)'
        roundRect(ctx, lx, ly, lw, 14, 4)
        ctx.fill()
        ctx.fillStyle = (ml.label && ml.label.color) || '#d97706'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(labelText, lx + lw / 2, ly + 7.5)
        ctx.restore()
      }
    }
  }

  function traceSmooth(ctx, pts, smooth) {
    if (!pts.length) return
    ctx.moveTo(pts[0].x, pts[0].y)
    if (!smooth || pts.length < 3) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      return
    }
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[j - 1] || pts[j]
      var p1 = pts[j]
      var p2 = pts[j + 1]
      var p3 = pts[j + 2] || p2
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      )
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  var CHART_INSTANCES = []

  var ECHARTS = {
    init: function (canvas, theme, opt) {
      var chart = new MiniChart(canvas, (opt && opt.width) || canvas.clientWidth, (opt && opt.height) || canvas.clientHeight, (opt && opt.devicePixelRatio) || 1)
      chart.__host = canvas.parentElement
      CHART_INSTANCES.push(chart)
      return chart
    },
    dispose: function (chart) {},
    graphic: {}
  }

  /* ============================================================
     10. 路由与页面栈
     ============================================================ */
  var stack = []        // [{ name, inst }]
  var metaByName = {}

  PAGES_META.forEach(function (m) { metaByName[m.name] = m })

  function pageNameFromUrl(url) {
    var m = /\/pages\/([^\/?#]+)\//.exec(url || '')
    if (m) return m[1]
    var m2 = /([^\/?#]+)$/.exec(String(url || '').replace(/\/$/, ''))
    return m2 ? m2[1] : ''
  }

  function showPageEl(name, visible) {
    var el = document.getElementById('pg-' + name)
    if (el) el.classList.toggle('on', !!visible)
  }

  function lifecycle(inst, hook) {
    var fn = inst[hook]
    if (typeof fn === 'function') {
      try { fn.call(inst) } catch (e) { warn('[h5] ' + hook + ' 异常 (' + inst.__name + ')', e) }
    }
  }

  function mount(name) {
    var inst = createPageInstance(name)
    bindEvents(inst)
    showPageEl(name, true)

    // 清理同页残留（同一页可能被多次 push）
    var body = inst.__body
    if (body) body.innerHTML = ''

    CURRENT_PAGE = inst
    lifecycle(inst, 'onLoad')
    renderPage(inst)
    inst.__rendered = true
    lifecycle(inst, 'onReady')
    lifecycle(inst, 'onShow')
    syncNav(inst)
    syncTabbar(inst)
    return inst
  }

  function unmount(entry) {
    showPageEl(entry.name, false)
    lifecycle(entry.inst, 'onHide')
    lifecycle(entry.inst, 'onUnload')
  }

  function syncNav(inst) {
    var meta = metaByName[inst.__name] || {}
    var el = document.getElementById('pg-' + inst.__name)
    if (!el) return
    var titleEl = el.querySelector('.h5-nav-title')
    if (titleEl) titleEl.textContent = meta.title || ''
    var nav = el.querySelector('.h5-nav')
    if (nav) nav.classList.toggle('no-back', !!meta.isTab)
  }

  function syncTabbar(inst) {
    var meta = metaByName[inst.__name] || {}
    var bar = document.getElementById('h5-tabbar')
    if (!bar) return
    if (!meta.isTab) {
      bar.classList.remove('on')
      return
    }
    bar.classList.add('on')
    Array.prototype.forEach.call(bar.querySelectorAll('.h5-tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-name') === inst.__name)
    })
  }

  function writeHash(name) {
    var h = '#/' + name
    if (location.hash !== h) {
      try { history.replaceState(null, '', h) } catch (e) { location.hash = h }
    }
  }

  function pushPage(name, replace) {
    if (!PAGE_DEFS[name]) { warn('[h5] 页面不存在:', name); return }
    var prev = stack[stack.length - 1]
    if (prev && !replace) { lifecycle(prev.inst, 'onHide'); showPageEl(prev.name, false) }
    if (prev && replace) { unmount(prev); stack.pop() }

    var inst = mount(name)
    stack.push({ name: name, inst: inst })
    writeHash(name)
    var body = inst.__body
    if (body) body.scrollTop = 0
  }

  function switchTabPage(name) {
    while (stack.length) {
      var e = stack.pop()
      if (e.name !== name) unmount(e)
      else { stack.push(e); break }
    }
    if (!stack.length || stack[stack.length - 1].name !== name) {
      var inst = mount(name)
      stack = [{ name: name, inst: inst }]
    } else {
      var cur = stack[stack.length - 1]
      showPageEl(name, true)
      CURRENT_PAGE = cur.inst
      lifecycle(cur.inst, 'onShow')
      renderPage(cur.inst)
      syncNav(cur.inst)
      syncTabbar(cur.inst)
    }
    writeHash(name)
  }

  function goBack(delta) {
    delta = delta || 1
    var first = stack[0]
    for (var i = 0; i < delta && stack.length > 1; i++) {
      unmount(stack.pop())
    }
    var cur = stack[stack.length - 1]
    if (!cur) { pushPage(PAGES_META[0] ? PAGES_META[0].name : 'index'); return }
    showPageEl(cur.name, true)
    CURRENT_PAGE = cur.inst
    // 同一页面可能被多次实例化而共用同一容器，返回时需按该实例的数据重绘
    if (!cur.inst.__master) renderPage(cur.inst)
    lifecycle(cur.inst, 'onShow')
    syncNav(cur.inst)
    syncTabbar(cur.inst)
    writeHash(cur.name)
  }

  WX.navigateTo = function (o) { pushPage(pageNameFromUrl(o.url)); o && o.success && o.success({}) }
  WX.redirectTo = function (o) { pushPage(pageNameFromUrl(o.url), true); o && o.success && o.success({}) }
  WX.switchTab = function (o) { switchTabPage(pageNameFromUrl(o.url)); o && o.success && o.success({}) }
  WX.navigateBack = function (o) { goBack(o && o.delta); o && o.success && o.success({}) }
  WX.reLaunch = function (o) {
    while (stack.length) unmount(stack.pop())
    pushPage(pageNameFromUrl(o.url))
  }

  /* ============================================================
     11. 页面外壳（导航栏 + tabBar 由构建期写好，这里只接线）
     ============================================================ */
  function buildTabbar() {
    var bar = document.getElementById('h5-tabbar')
    if (!bar) return
    bar.innerHTML = ''
    PAGES_META.filter(function (m) { return m.isTab }).forEach(function (m) {
      var t = document.createElement('div')
      t.className = 'h5-tab'
      t.setAttribute('data-name', m.name)
      t.innerHTML = '<img src="' + (IMG[m.tabIcon] || '') + '" alt=""/><span>' + escapeHtml(m.tabText || m.title) + '</span>'
      t.addEventListener('click', function () { switchTabPage(m.name) })
      bar.appendChild(t)
    })
  }

  function buildPages() {
    var host = document.getElementById('h5-pages')
    if (!host) return
    host.innerHTML = ''
    PAGES_META.forEach(function (m) {
      var sec = document.createElement('section')
      sec.className = 'pg'
      sec.id = 'pg-' + m.name
      sec.setAttribute('data-name', m.name)
      var nav =
        '<header class="h5-nav' + (m.isTab ? ' no-back' : '') + '">' +
          '<div class="h5-nav-back" data-back="1">‹</div>' +
          '<div class="h5-nav-title">' + escapeHtml(m.title || '') + '</div>' +
        '</header>'
      sec.innerHTML = nav + '<div class="h5-body"></div>'
      sec.querySelector('.h5-nav-back').addEventListener('click', function () { goBack(1) })
      host.appendChild(sec)
    })
  }

  function onResize() {
    setRootSize()
    CHART_INSTANCES.forEach(function (c) {
      var canvas = c.canvas
      if (!canvas || !document.body.contains(canvas)) return
      var box = canvas.closest('.chart-box') || canvas.parentElement
      if (!box) return
      var w = Math.max(box.clientWidth, 40)
      var h = Math.max(box.clientHeight, 40)
      if (Math.abs(w - c.w) > 0.5 || Math.abs(h - c.h) > 0.5) c.resize(w, h)
    })
  }

  function boot() {
    setRootSize()

    buildPages()
    buildTabbar()

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 200) })

    // 起始页：hash 优先；其余情况先落到首页
    var start = (location.hash || '').replace(/^#\/?/, '')
    var startMeta = metaByName[start]
    if (!startMeta) start = PAGES_META[0] ? PAGES_META[0].name : 'index'
    if (start === (PAGES_META[0] && PAGES_META[0].name)) startMeta = metaByName[start]

    if (startMeta && startMeta.isTab) {
      switchTabPage(start)
    } else {
      var home = PAGES_META[0] ? PAGES_META[0].name : 'index'
      pushPage(home)
      if (start !== home) pushPage(start)
      return finishBoot()
    }
    finishBoot()
  }

  function finishBoot() {
    var cur = stack[stack.length - 1]
    if (cur) cur.inst.__master = true
    document.body.classList.add('h5-ready')
  }

  window.addEventListener('hashchange', function () {
    var name = (location.hash || '').replace(/^#\/?/, '')
    if (!name || !metaByName[name]) return
    var cur = stack[stack.length - 1]
    if (cur && cur.name === name) return
    if (metaByName[name].isTab) switchTabPage(name)
    else pushPage(name)
  })

  // 所有注入脚本执行完毕后再启动（页面 JS 需要先完成 Page() 注册）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0) })
  } else {
    setTimeout(boot, 0)
  }

  // 调试出口 + 供构建期注入的 app.js 使用
  window.__H5_BOOTSTRAP__ = { App: App, getApp: getApp, WX: WX }
  window.__H5__ = { getStack: function () { return stack }, WX: WX, PAGE_DEFS: PAGE_DEFS }

})(window, document)
