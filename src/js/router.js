/* ============================================================
   router.js · hash 路由 + 页面栈
   ------------------------------------------------------------
   与小程序导航语义对齐但更简单：
     - tab 页：切换即重置栈（对应 switchTab），tabBar 常驻
     - 二级页：入栈（对应 navigateTo），导航栏出现返回键
     - 返回：出栈（对应 navigateBack），回到上一页并恢复其滚动位置

   页面片段加载：
     打包产物里片段已内联为 <template id="frag-xxx">，直接取用；
     开发态没有 template 时回退 fetch('pages/xxx.html')。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 片段基址，由入口页设置（开发态 src/ 下为 ''，打包产物为 null 表示不 fetch） */
  PP.fragBase = ''

  var stack = []        // 页面实例栈：[{ name, el, mod, scrollTop }]
  var cache = {}        // 片段 HTML 缓存
  var current = null
  var listeners = []

  function bodyEl() { return dom.qs('#app-body') }

  /* ---------------------------------------------- 片段加载 */

  function loadFragment(name) {
    if (cache[name]) return Promise.resolve(cache[name])

    var tpl = document.getElementById('frag-' + name)
    if (tpl) {
      cache[name] = tpl.innerHTML
      return Promise.resolve(cache[name])
    }

    if (PP.fragBase === null) {
      return Promise.reject(new Error('片段未内联，且已禁用 fetch：' + name))
    }

    return fetch(PP.fragBase + 'pages/' + name + '.html')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' · pages/' + name + '.html')
        return res.text()
      })
      .then(function (text) {
        cache[name] = text
        return text
      })
  }

  /* ---------------------------------------------- 页面生命周期 */

  function instantiate(name) {
    var route = PP.routeOf(name)
    var mod = PP.pages[name]
    if (!mod) throw new Error('页面未注册：' + name)

    var el = document.createElement('div')
    el.className = 'page'
    el.setAttribute('data-page', name)
    el.hidden = true

    var cleanups = []
    var ctx = {
      name: name,
      route: route,
      go: function (target, params) { return navigate(target, params) },
      back: back,
      setTitle: function (t) { if (isTop()) setBarTitle(t) },
      /** 注册清理函数：页面出栈时统一执行，避免遗留监听与定时器 */
      onCleanup: function (fn) { cleanups.push(fn) }
    }

    bodyEl().appendChild(el)

    return loadFragment(name).then(function (markup) {
      dom.setHTML(el, dom.raw(markup))
      if (mod.mount) mod.mount(el, ctx)
      return {
        name: name,
        el: el,
        mod: mod,
        ctx: ctx,
        scrollTop: 0,
        cleanup: function () {
          cleanups.forEach(function (fn) {
            try { fn() } catch (e) { console.warn('[page cleanup]', name, e) }
          })
          cleanups.length = 0
          if (mod.unmount) mod.unmount(el)
        }
      }
    })
  }

  function isTop() {
    return stack.length > 0 && stack[stack.length - 1].name === current
  }

  /* ---------------------------------------------- 导航栏与 tabBar */

  function setBarTitle(title) {
    dom.qs('#bar-title').textContent = title
    document.title = title + ' · PPTransfer H5'
  }

  function syncChrome(route) {
    var backSlot = dom.qs('#bar-start')
    var isRoot = !!route.tab
    dom.setHTML(backSlot, isRoot ? '' : dom.raw(
      '<button type="button" class="app-back" id="bar-back" aria-label="返回上一页">' +
      '<svg aria-hidden="true"><use href="#i-chevron-left"/></svg>' +
      '</button>'
    ))
    if (!isRoot) {
      var btn = dom.qs('#bar-back')
      if (btn) btn.addEventListener('click', back)
    }

    var tabbar = dom.qs('#tabbar')
    dom.qsa('.tab', tabbar).forEach(function (tab) {
      var on = tab.getAttribute('data-name') === route.name
      tab.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    tabbar.hidden = !isRoot
  }

  /* ---------------------------------------------- 显示 / 隐藏 */

  function show(inst, isBack) {
    if (current) {
      if (stack.length) stack[stack.length - 1].scrollTop = bodyEl().scrollTop
      var prev = stack[stack.length - 1]
      if (prev && prev.el && prev.name !== inst.name) prev.el.hidden = true
    }
    // 上一页可能已不在栈中（tab 切换），统一隐藏所有非当前页
    dom.qsa('.page', bodyEl()).forEach(function (p) {
      if (p !== inst.el) p.hidden = true
    })

    inst.el.hidden = false
    // 进场动画方向。注意不要叫 data-back —— 那是 app.js 全局委托里
    // 「返回上一页按钮」的声明式属性，若与页面根元素同名属性撞车，
    // 二级页上任何一次点击都会冒泡命中 .page[data-back]，整页变成点哪都返回
    inst.el.setAttribute('data-nav', isBack ? 'back' : 'fwd')
    current = inst.name

    // 重放进场动画
    inst.el.style.animation = 'none'
    void inst.el.offsetHeight
    inst.el.style.animation = ''

    bodyEl().scrollTop = inst.scrollTop || 0
    setBarTitle(inst.ctx.route.title)
    syncChrome(inst.ctx.route)

    if (inst.mod.show) inst.mod.show(inst.el)
    listeners.forEach(function (fn) { fn(inst.name, isBack) })
  }

  function teardown(inst) {
    if (inst.mod.hide) inst.mod.hide(inst.el)
    inst.cleanup()
    if (inst.el.parentNode) inst.el.parentNode.removeChild(inst.el)
  }

  /* ---------------------------------------------- 导航 */

  /** 切换到 tab 页：清空栈，页面常驻
   *  params 为可选的进入意图（如 { view: 'fund' } 直达收款页的在途视图）：
   *  页面可实现可选的 onParams(el, params) 钩子来响应，钩子在 show 之前调用，
   *  视图先切好再亮相，避免先闪默认视图。 */
  function switchTab(name, params) {
    var route = PP.routeOf(name)
    if (!route || !route.tab) return Promise.reject(new Error('不是 tab 页：' + name))

    var existing = null
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].name === name) existing = stack[i]
    }
    // 清掉除目标外的所有页面
    stack.slice().forEach(function (inst) {
      if (inst.name !== name) teardown(inst)
    })
    stack = stack.filter(function (inst) { return inst.name === name })

    function reveal(inst) {
      if (params && inst.mod.onParams) inst.mod.onParams(inst.el, params)
      if (stack.indexOf(inst) < 0) stack.push(inst)
      inst.scrollTop = inst.scrollTop || 0
      show(inst, false)
      writeHash(name)
    }

    if (existing) {
      reveal(existing)
      return Promise.resolve(existing)
    }
    return instantiate(name).then(reveal)
  }

  /** 进入二级页：入栈 */
  function navigate(name, params) {
    var route = PP.routeOf(name)
    if (!route) return Promise.reject(new Error('路由不存在：' + name))
    if (route.tab) return switchTab(name, params)

    var top = stack[stack.length - 1]
    if (top && top.name === name) return Promise.resolve(top) // 防重复进入
    if (top) top.scrollTop = bodyEl().scrollTop

    return instantiate(name).then(function (inst) {
      inst.params = params || {}
      stack.push(inst)
      inst.scrollTop = 0
      show(inst, false)
      writeHash(name)
      return inst
    })
  }

  function back() {
    if (stack.length <= 1) return
    var inst = stack.pop()
    teardown(inst)
    var prev = stack[stack.length - 1]
    show(prev, true)
    writeHash(prev.name)
  }

  var writingHash = false
  function writeHash(name) {
    var next = '#/' + name
    if (location.hash === next) return
    writingHash = true
    location.hash = next
    // hashchange 是异步的，下一帧再解除标记
    setTimeout(function () { writingHash = false }, 0)
  }

  /* ---------------------------------------------- hash 同步 */

  window.addEventListener('hashchange', function () {
    if (writingHash) return
    var name = (location.hash || '').replace(/^#\/?/, '')
    if (!name || name === current) return
    var route = PP.routeOf(name)
    if (!route) { writeHash(current); return }

    if (route.tab) {
      switchTab(name)
      return
    }
    // 浏览器前进/后退：若目标已在栈中则回退到它，否则入栈
    var idx = -1
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].name === name) idx = i
    }
    if (idx >= 0) {
      while (stack.length - 1 > idx) teardown(stack.pop())
      show(stack[stack.length - 1], true)
    } else {
      navigate(name)
    }
  })

  /* ---------------------------------------------- 启动 */

  function start(defaultTab) {
    var entry = (location.hash || '').replace(/^#\/?/, '')
    var route = entry ? PP.routeOf(entry) : null

    if (route && route.tab) return switchTab(route.name)

    // 二级页直达：先铺一个 tab 页在栈底，返回才有落点
    return switchTab(defaultTab || PP.TAB_ROUTES[0].name).then(function () {
      if (route) return navigate(route.name)
    })
  }

  PP.router = {
    start: start,
    go: navigate,
    switchTab: switchTab,
    back: back,
    current: function () { return current },
    stack: function () { return stack.slice() },
    /** 订阅页面切换事件 */
    onChange: function (fn) { listeners.push(fn) }
  }
})((window.PP = window.PP || {}))
