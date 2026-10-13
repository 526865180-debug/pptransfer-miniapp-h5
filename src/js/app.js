/* ============================================================
   app.js · 启动引导
   ------------------------------------------------------------
   职责只有四件：加载图标 sprite → 生成 tabBar → 启动路由 → 揭幕。
   页面注册用 PP.definePage，各页面的 JS 在路由启动前完成注册。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /* 页面注册表已由 routes.js 提供（PP.definePage），此处仅做引导 */

  /* ---------------------------------------------- 图标 sprite */

  /**
   * 把 SVG sprite 注入文档。
   * 打包产物里 sprite 已经内联，此处直接返回；
   * 开发态从 assets/icons.svg 取回后注入 —— 两条路径对外表现一致，
   * 页面里统一写 <svg><use href="#i-xxx"/></svg> 即可。
   */
  function loadSprite() {
    if (document.getElementById('pp-sprite')) return Promise.resolve()
    if (PP.fragBase === null) return Promise.resolve() // 产物态且未内联，不应发生
    return fetch(PP.fragBase + 'assets/icons.svg')
      .then(function (r) { return r.text() })
      .then(function (text) {
        var holder = document.createElement('div')
        holder.id = 'pp-sprite'
        holder.setAttribute('aria-hidden', 'true')
        holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
        holder.innerHTML = text
        document.body.insertBefore(holder, document.body.firstChild)
      })
      .catch(function (e) {
        console.warn('[sprite] 加载失败，图标将不可见', e)
      })
  }

  /* ---------------------------------------------- tabBar */

  function buildTabbar() {
    var tabbar = dom.qs('#tabbar')
    dom.setHTML(tabbar, dom.raw(PP.TAB_ROUTES.map(function (r) {
      return (
        '<button type="button" class="tab" role="tab" aria-selected="false" data-name="' + r.name + '">' +
        '<svg aria-hidden="true"><use href="#' + r.tab.icon + '"/></svg>' +
        '<span class="tab-label">' + dom.esc(r.tab.text) + '</span>' +
        '</button>'
      )
    }).join('')))

    tabbar.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab')
      if (tab) PP.router.switchTab(tab.getAttribute('data-name'))
    })
  }

  /* ---------------------------------------------- 全局动作委托 */

  /**
   * 声明式交互：页面里只写属性，不用绑事件。
   *   data-go="wallet"         → 跳转页面（tab 页自动走 switchTab）
   *   data-back                → 返回上一页
   *   data-demo="文案"          → 演示环境占位提示
   * 13 个页面因此不需要各写一遍导航代码。
   *
   * ⚠ data-back / data-go 是保留属性名，页面根元素不能用它们做别的钩子
   *   （历史上曾与路由的进场动画方向属性撞名，导致二级页点哪都返回）。
   */
  function bindGlobalActions() {
    document.addEventListener('click', function (e) {
      var target = e.target
      if (!target || !target.closest) return

      var go = target.closest('[data-go]')
      if (go) {
        PP.router.go(go.getAttribute('data-go'))
        return
      }
      if (target.closest('[data-back]')) {
        PP.router.back()
        return
      }
      var demo = target.closest('[data-demo]')
      if (demo) {
        PP.ui.toast(demo.getAttribute('data-demo') || '演示环境，该操作未接入')
      }
    })
  }

  /* ---------------------------------------------- 启动 */

  function boot() {
    buildTabbar()
    bindGlobalActions()

    loadSprite()
      .then(function () { return PP.router.start('index') })
      .then(function () {
        var app = dom.qs('#app')
        app.classList.add('is-ready')
        var boot = dom.qs('#boot')
        if (boot) {
          boot.classList.add('is-off')
          setTimeout(function () { if (boot.parentNode) boot.parentNode.removeChild(boot) }, 250)
        }
      })
      .catch(function (err) {
        console.error('[boot] 启动失败', err)
        var boot = dom.qs('#boot')
        if (boot) {
          boot.innerHTML =
            '<div style="text-align:center;padding:24px">' +
            '<p style="color:#dc2626;font-weight:600;margin-bottom:8px">页面加载失败</p>' +
            '<p style="font-size:12px;line-height:1.6">' +
            dom.esc(err && err.message ? err.message : String(err)) +
            '<br>开发态请通过本地服务器打开（见 README）</p>' +
            '</div>'
        }
      })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})((window.PP = window.PP || {}))
