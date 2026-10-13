/* ============================================================
   ui.js · 反馈与弹层
   ------------------------------------------------------------
   把 toast / modal / sheet / picker 统一收口在此。
   页面不再各自拼遮罩与弹层骨架，保证一致的动效、遮罩与关闭行为。
   弹层支持堆叠（sheet 里再开 modal），按栈后进先出关闭。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom
  var layers = [] // 弹层栈，栈顶响应 Esc

  /* ---------------------------------------------------- Toast */

  var toastTimer = null

  /**
   * 轻提示
   *   toast('已复制')                  → 纯文字
   *   toast('提交成功', {icon:'success'})
   *   toast('处理中', {icon:'loading', duration:0})  → 常驻，需手动 hide
   */
  function toast(message, opts) {
    var o = opts || {}
    var layer = dom.qs('#toast-layer')
    if (!layer) return { hide: function () {} }

    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    dom.setHTML(layer, '')
    layer.style.display = 'flex'

    var icon = ''
    if (o.icon === 'success') {
      icon = '<svg aria-hidden="true"><use href="#i-check-circle"/></svg>'
    } else if (o.icon === 'loading') {
      icon = '<div class="spinner" role="status"></div>'
    }

    var node = document.createElement('div')
    node.className = 'toast'
    node.setAttribute('role', o.icon === 'loading' ? 'status' : 'alert')
    dom.setHTML(node, dom.raw(icon + '<span>' + dom.esc(message) + '</span>'))
    layer.appendChild(node)

    var duration = o.duration === undefined ? 1800 : o.duration
    if (duration > 0) {
      toastTimer = setTimeout(function () { hideToast(node) }, duration)
    }

    function hideToast(target) {
      var el = target || node
      if (!el || !el.parentNode) return
      el.classList.add('is-out')
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el)
        if (!layer.children.length) layer.style.display = 'none'
      }, 200)
    }

    return { hide: hideToast }
  }

  /* ---------------------------------------------------- 弹层基座 */

  /**
   * 打开一个弹层。
   *   title    标题（可选）
   *   body     弹层内容，接受 PP.html 字面量或 HTML 字符串
   *   align    'bottom'（默认，动作面板样式）| 'center'（对话框样式）
   *   footer   底部按钮区 HTML
   *   onMount  内容挂载后回调，参数 (root, api)，用于绑定事件
   *   onClose  关闭后回调
   * 返回 { close, root }
   */
  function openSheet(opts) {
    var o = opts || {}
    var layerRoot = dom.qs('#layer-root')

    var mask = document.createElement('div')
    mask.className = 'mask'
    mask.setAttribute('data-align', o.align === 'center' ? 'center' : 'bottom')

    var inner = document.createElement('div')
    inner.className = 'mask-inner'
    mask.appendChild(inner)

    var sheet = document.createElement('div')
    sheet.className = 'sheet'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    if (o.title) sheet.setAttribute('aria-label', o.title)
    inner.appendChild(sheet)

    var head = ''
    if (o.title) {
      head =
        '<div class="sheet-head">' +
        '<h2 class="sheet-title">' + dom.esc(o.title) + '</h2>' +
        '<button type="button" class="sheet-close" data-close>关闭</button>' +
        '</div>'
    }
    dom.setHTML(sheet, dom.raw(head + (o.body || '') + (o.footer || '')))

    var closed = false
    function close(result) {
      if (closed) return
      closed = true
      var i = layers.indexOf(entry)
      if (i >= 0) layers.splice(i, 1)
      mask.remove()
      document.removeEventListener('keydown', onKey)
      if (o.onClose) o.onClose(result)
    }

    function onKey(e) {
      if (e.key === 'Escape' && layers[layers.length - 1] === entry) {
        e.preventDefault()
        close()
      }
    }

    // 点关闭按钮或点遮罩空白处关闭；点弹层内部不关
    mask.addEventListener('click', function (e) {
      if (e.target === mask || e.target.closest('[data-close]')) close()
    })
    document.addEventListener('keydown', onKey)

    layerRoot.appendChild(mask)

    var entry = {
      close: close,
      root: sheet,
      set: function (markup) { dom.setHTML(sheet, markup) }
    }
    layers.push(entry)

    if (o.onMount) o.onMount(sheet, entry)

    // 焦点移入弹层，键盘用户不会停留在被遮住的页面上
    var focusTarget = sheet.querySelector('[autofocus], input, button')
    if (focusTarget) focusTarget.focus({ preventScroll: true })

    return entry
  }

  /* ---------------------------------------------------- 确认框 */

  /**
   * 确认对话框（替代 wx.showModal）
   * 返回 Promise<boolean> —— 确认 true / 取消 false
   */
  function confirmDialog(opts) {
    var o = typeof opts === 'string' ? { content: opts } : (opts || {})
    return new Promise(function (resolve) {
      var settled = false
      function done(v) {
        if (settled) return
        settled = true
        resolve(v)
      }
      var footer =
        '<div class="sheet-footer">' +
        (o.showCancel === false ? '' :
          '<button type="button" class="btn btn--ghost" data-cancel>' +
          dom.esc(o.cancelText || '取消') + '</button>') +
        '<button type="button" class="btn btn--primary" data-ok>' +
        dom.esc(o.confirmText || '确定') + '</button>' +
        '</div>'

      var api = openSheet({
        title: o.title || '',
        align: 'center',
        body: '<p class="muted" style="font-size:var(--text-base);line-height:var(--leading-normal)">' +
          dom.esc(o.content || '') + '</p>',
        footer: footer,
        onMount: function (root, sheet) {
          root.addEventListener('click', function (e) {
            if (e.target.closest('[data-ok]')) { done(true); sheet.close() }
            if (e.target.closest('[data-cancel]')) { done(false); sheet.close() }
          })
        },
        onClose: function () { done(false) }
      })
      return api
    })
  }

  /* ---------------------------------------------------- 选择器 */

  /**
   * 单选列表弹层（替代 picker mode=selector）
   *   options: [{ value, title, sub, valueText }]
   * 返回 Promise<value|null>
   */
  function picker(opts) {
    var o = opts || {}
    var options = o.options || []
    return new Promise(function (resolve) {
      var settled = false
      function done(v) {
        if (settled) return
        settled = true
        resolve(v)
      }

      var body = '<div class="stack-2">' + options.map(function (item) {
        var selected = String(item.value) === String(o.value)
        return (
          '<div class="option-row" role="option" data-value="' + dom.esc(item.value) + '"' +
          ' aria-selected="' + (selected ? 'true' : 'false') + '">' +
          '<div class="option-body">' +
          '<span class="option-title">' + dom.esc(item.title) + '</span>' +
          (item.sub ? '<span class="option-sub">' + dom.esc(item.sub) + '</span>' : '') +
          '</div>' +
          (item.valueText ? '<span class="option-value">' + dom.esc(item.valueText) + '</span>' : '') +
          (selected ? '<svg class="option-check" aria-hidden="true"><use href="#i-check"/></svg>' : '') +
          '</div>'
        )
      }).join('') + '</div>'

      var sheet = openSheet({
        title: o.title || '请选择',
        body: body,
        onMount: function (root) {
          root.addEventListener('click', function (e) {
            var row = e.target.closest('.option-row')
            if (!row) return
            done(row.getAttribute('data-value'))
            sheet.close()
          })
        },
        onClose: function () { done(null) }
      })
    })
  }

  /**
   * 带搜索的单选弹层（账户、银行这类需要检索的长列表）
   *   items: [{ value, title, sub }]，检索范围是 title + sub
   *   value 当前值 / placeholder 搜索框占位 / emptyText 无结果文案
   * 返回 Promise<value|null>
   */
  function searchPicker(opts) {
    var o = opts || {}
    var items = o.items || []
    return new Promise(function (resolve) {
      var settled = false
      function done(v) {
        if (settled) return
        settled = true
        resolve(v)
      }

      function rowHTML(item) {
        var active = String(item.value) === String(o.value)
        return (
          '<button type="button" class="picker-item' + (active ? ' is-active' : '') + '"' +
          ' data-value="' + dom.esc(item.value) + '"' +
          ' aria-pressed="' + (active ? 'true' : 'false') + '">' +
          '<span class="picker-body">' +
          '<span class="picker-title">' + dom.esc(item.title) + '</span>' +
          (item.sub ? '<span class="picker-sub">' + dom.esc(item.sub) + '</span>' : '') +
          '</span>' +
          '<svg class="picker-check" aria-hidden="true"><use href="#i-check"/></svg>' +
          '</button>'
        )
      }

      var body =
        '<div class="picker-search-wrap">' +
        '<input class="field-input picker-search" id="picker-search" type="search" autofocus' +
        ' autocomplete="off" placeholder="' + dom.esc(o.placeholder || '搜索') + '">' +
        '</div>' +
        '<div class="picker-list" id="picker-list"></div>'

      var sheet = openSheet({
        title: o.title || '请选择',
        body: body,
        onMount: function (root) {
          var search = dom.qs('#picker-search', root)
          var list = dom.qs('#picker-list', root)

          function render() {
            var kw = (search.value || '').trim().toLowerCase()
            var rows = items.filter(function (it) {
              return !kw || (it.title + ' ' + (it.sub || '')).toLowerCase().indexOf(kw) >= 0
            })
            list.innerHTML = rows.length
              ? rows.map(rowHTML).join('')
              : '<p class="picker-empty">' + dom.esc(o.emptyText || '没有匹配的结果') + '</p>'
          }

          dom.on(root, 'input', '#picker-search', render)
          dom.on(root, 'click', '.picker-item', function (e, el) {
            done(el.getAttribute('data-value'))
            sheet.close()
          })
          render()
        },
        onClose: function () { done(null) }
      })
    })
  }

  /** 动作面板：options 为 [{ label, tone }]，返回被选项的 index 或 null */
  function actionSheet(opts) {
    var o = opts || {}
    var options = o.options || []
    return new Promise(function (resolve) {
      var settled = false
      function done(v) {
        if (settled) return
        settled = true
        resolve(v)
      }
      var body = '<div class="stack-2">' + options.map(function (item, i) {
        return '<button type="button" class="btn btn--block ' +
          (item.tone === 'danger' ? 'btn--soft' : 'btn--ghost') +
          '" data-index="' + i + '"' +
          (item.tone === 'danger' ? ' style="color:var(--color-danger)"' : '') + '>' +
          dom.esc(item.label) + '</button>'
      }).join('') + '</div>' +
        '<div class="sheet-footer"><button type="button" class="btn btn--ghost" data-close>取消</button></div>'

      var sheet = openSheet({
        title: o.title || '',
        body: body,
        onMount: function (root) {
          root.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-index]')
            if (!btn) return
            done(Number(btn.getAttribute('data-index')))
            sheet.close()
          })
        },
        onClose: function () { done(null) }
      })
    })
  }

  /* ---------------------------------------------------- 分页 */

  /** 页码序列：≤7 页全列，否则首末两页 + 当前页邻域，中间用省略号占位 */
  function pageSeq(page, pages) {
    var nums = []
    if (pages <= 7) {
      for (var i = 1; i <= pages; i++) nums.push(i)
      return nums
    }
    var candidates = [1, page - 1, page, page + 1, pages]
    candidates.forEach(function (n) {
      if (n >= 1 && n <= pages && nums.indexOf(n) < 0) nums.push(n)
    })
    nums.sort(function (a, b) { return a - b })

    var out = []
    nums.forEach(function (n, i) {
      if (i > 0 && n - nums[i - 1] > 1) out.push('...')
      out.push(n)
    })
    return out
  }

  function pagerNavBtn(kind, label, disabled) {
    // 两个方向分开写整串：图标引用要能被 tools/verify.py 静态扫到
    var chevron = kind === 'prev'
      ? '<use href="#i-chevron-left"/>'
      : '<use href="#i-chevron-right"/>'
    return (
      '<button type="button" class="pager-btn pager-nav" data-pg="' + kind + '"' +
      (disabled ? ' disabled' : '') + ' aria-label="' + label + '">' +
      '<svg aria-hidden="true">' + chevron + '</svg>' +
      '</button>'
    )
  }

  /**
   * 分页控件（客户端分页：列表数据已在内存，翻页只是换一段切片）
   *   el        挂载容器；每次调用重写其内容
   *   total     筛选后的总条数
   *   page      当前页（1 起，越界自动收敛到 [1, pages]）
   *   pageSize  每页条数
   *   label     容器 aria-label（如「收款记录分页」）
   *   onGo(n)   翻页回调
   *
   * 返回 { page, pages, total } —— 调用方用它同步自己保存的页码，
   * 免得筛选后只剩一页、页码却还停在第 2 页上。
   * 总页数 ≤ 1 时清空容器并加 hidden，单页列表不出现多余的翻页控件。
   *
   * 点击用容器级 onclick 覆盖绑定：列表每次重渲染都会重调本函数，
   * 覆盖式赋值天然不会累积监听（用 addEventListener 会）。
   */
  function pager(opts) {
    var o = opts || {}
    var el = o.el
    var total = Math.max(0, Number(o.total) || 0)
    var pageSize = Math.max(1, Number(o.pageSize) || 10)
    var pages = Math.max(1, Math.ceil(total / pageSize))
    var page = Math.min(Math.max(1, Number(o.page) || 1), pages)
    var result = { page: page, pages: pages, total: total }

    if (!el) return result

    el.setAttribute('role', 'navigation')
    el.setAttribute('aria-label', o.label || '分页')

    if (pages <= 1) {
      dom.setHTML(el, '')
      el.hidden = true
      el.onclick = null
      return result
    }
    el.hidden = false

    var start = (page - 1) * pageSize + 1
    var end = Math.min(total, page * pageSize)

    dom.setHTML(el, dom.raw(
      '<div class="pager-nav">' +
        pagerNavBtn('prev', '上一页', page <= 1) +
        pageSeq(page, pages).map(function (n) {
          if (n === '...') return '<span class="pager-gap" aria-hidden="true">…</span>'
          return (
            '<button type="button" class="pager-btn" data-pg="' + n + '"' +
            (n === page ? ' aria-current="page"' : '') +
            ' aria-label="第 ' + n + ' 页">' + n + '</button>'
          )
        }).join('') +
        pagerNavBtn('next', '下一页', page >= pages) +
      '</div>' +
      '<p class="pager-info">第 ' + start + '–' + end + ' 条 / 共 ' + total + ' 条</p>'
    ))

    el.onclick = function (e) {
      var btn = e.target.closest('[data-pg]')
      if (!btn || !el.contains(btn) || btn.disabled) return
      var v = btn.getAttribute('data-pg')
      var next = v === 'prev' ? page - 1 : v === 'next' ? page + 1 : Number(v)
      if (!(next >= 1) || next > pages || next === page) return
      if (o.onGo) o.onGo(next)
    }

    return result
  }

  PP.ui = {
    toast: toast,
    sheet: openSheet,
    confirm: confirmDialog,
    picker: picker,
    searchPicker: searchPicker,
    actions: actionSheet,
    pager: pager
  }
})((window.PP = window.PP || {}))
