/* ============================================================
   dom.js · 极简 DOM 助手
   ------------------------------------------------------------
   不引入任何框架：只提供这个项目真正用得到的四件事 ——
   查询、事件委托、安全插值、列表渲染。
   （模板运行时 / 指令解析 / 虚拟 DOM 都不需要）
   ============================================================ */
(function (PP) {
  'use strict'

  /** HTML 转义 —— 所有插入模板的数据都必须过这一层 */
  function esc(value) {
    if (value === null || value === undefined) return ''
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * 带标签模板，自动转义插值。
   *   PP.html`<b>${userInput}</b>`   // 插值自动转义
   *   PP.raw(markup)                 // 需要插入可信 HTML 片段时显式声明
   */
  var RAW = {}
  function raw(markup) {
    return { [RAW]: String(markup) }
  }
  function html(strings) {
    var out = strings[0]
    for (var i = 1; i < arguments.length; i++) {
      var v = arguments[i]
      out += (v && v[RAW] !== undefined ? v[RAW] : esc(v)) + strings[i]
    }
    return { [RAW]: out }
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel)
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel))
  }

  /**
   * 事件委托 —— 在容器上挂一次监听，处理所有后代匹配元素。
   * 好处：列表重渲染后无需重新绑定，也不会遗漏动态节点。
   * 返回解绑函数。
   */
  function on(root, type, selector, handler) {
    function listener(e) {
      var target = e.target.closest(selector)
      if (target && root.contains(target)) handler(e, target)
    }
    root.addEventListener(type, listener)
    return function off() {
      root.removeEventListener(type, listener)
    }
  }

  /** 把 HTML 字面量写入容器（唯一的 innerHTML 出口，便于审查） */
  function setHTML(el, markup) {
    if (!el) return el
    el.innerHTML = markup && markup[RAW] !== undefined ? markup[RAW] : String(markup || '')
    return el
  }

  /** 列表渲染：容器 + 数据 + 行模板函数 */
  function renderList(el, items, rowFn) {
    return setHTML(el, raw(items.map(rowFn).join('')))
  }

  function toggle(el, visible) {
    if (el) el.hidden = !visible
  }

  /** 复制到剪贴板，带降级方案（非安全上下文下 navigator.clipboard 不可用） */
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        resolve()
      } catch (err) {
        reject(err)
      } finally {
        document.body.removeChild(ta)
      }
    })
  }

  /** 轻震动反馈（支持的设备上） */
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(10)
  }

  PP.dom = {
    esc: esc,
    html: html,
    raw: raw,
    qs: qs,
    qsa: qsa,
    on: on,
    setHTML: setHTML,
    renderList: renderList,
    toggle: toggle,
    copy: copy,
    haptic: haptic
  }
})((window.PP = window.PP || {}))
