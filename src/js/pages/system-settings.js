/* ============================================================
   pages/system-settings.js · 系统管理（账号设置）
   ------------------------------------------------------------
   对齐 desktop 版 pages/account_settings.html 的三组设置：
     账号信息（手机号 / 邮箱）、安全设置（登录密码 / 交易密码 /
     交易二次校验 / 付款交易审批）、通知偏好（到账 / 入账 / 付款提醒）。

   两类交互：
     · 修改类（手机号 / 邮箱 / 两个密码）→ PP.ui.sheet 底部弹层，
       表单校验把错误写在弹层内（不打断输入），成功后回写行值；
     · 开关类 → 直接翻转 aria-checked，toast 反馈。
   开关与联系方式都存在模块级 SETTINGS 里：tab 切走时页面实例会被销毁，
   状态留在模块作用域才能在回来时保持一致（演示语义，接后端时改为读接口）。

   验证码倒计时用 setInterval，弹层关闭或页面卸载时必须清掉，
   否则离开页面后定时器还在跑（这里通过 onClose + ctx.onCleanup 双保险）。
   ============================================================ */
(function (PP) {
  'use strict'

  var dom = PP.dom

  /** 演示数据：接入后端后由接口回填 */
  var SETTINGS = {
    phone: '+86 17301643654',
    email: '1950130401@qq.com',
    toggles: {
      verify: true,
      approval: false,
      arrival: true,
      settled: true,
      payment: true
    }
  }

  /** 开关键 → 中文名（toast 文案与 aria-label 共用） */
  var TOGGLE_NAMES = {
    verify: '交易二次校验',
    approval: '付款交易审批',
    arrival: '到账提醒',
    settled: '入账提醒',
    payment: '付款提醒'
  }

  var SECONDS = 60 // 验证码重发间隔

  /** 当前打开的弹层（页面卸载时统一关闭，关闭动作会顺带清掉倒计时） */
  var currentSheet = null

  /* ---------------------------------------------- 校验与掩码 */

  function digitsOf(v) {
    return String(v || '').replace(/\D/g, '')
  }

  /** 11 位境内手机号（与 desktop 版同一套规则） */
  function validPhone(v) {
    return /^1[3-9]\d{9}$/.test(digitsOf(v).slice(-11))
  }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
  }

  /** +86 173****3654 */
  function maskPhone(v) {
    var n = digitsOf(v).slice(-11)
    if (n.length !== 11) return v
    return '+86 ' + n.slice(0, 3) + '****' + n.slice(-4)
  }

  /** 195****401@qq.com */
  function maskEmail(v) {
    var s = String(v || '')
    var at = s.indexOf('@')
    if (at < 0) return s
    var local = s.slice(0, at)
    var head = local.slice(0, 3)
    var tail = local.length > 6 ? local.slice(-3) : ''
    return head + '****' + tail + s.slice(at)
  }

  /* ---------------------------------------------- 行值与开关 */

  function syncRows(root) {
    var phone = dom.qs('#sys-phone-value', root)
    var email = dom.qs('#sys-email-value', root)
    if (phone) phone.textContent = SETTINGS.phone
    if (email) email.textContent = SETTINGS.email

    dom.qsa('.switch', root).forEach(function (el) {
      var key = el.getAttribute('data-toggle')
      var on = !!SETTINGS.toggles[key]
      el.setAttribute('aria-checked', on ? 'true' : 'false')
    })
  }

  function flipSwitch(el) {
    var key = el.getAttribute('data-toggle')
    var on = el.getAttribute('aria-checked') !== 'true'
    el.setAttribute('aria-checked', on ? 'true' : 'false')
    if (key) SETTINGS.toggles[key] = on
    PP.ui.toast((TOGGLE_NAMES[key] || '设置') + (on ? '已开启' : '已关闭'))
  }

  /* ---------------------------------------------- 弹层：验证码按钮 */

  /** 60 秒倒计时；返回清理函数，供弹层 onClose 调用 */
  function startCountdown(btn) {
    var left = SECONDS
    var label = btn.textContent
    btn.disabled = true
    btn.textContent = left + ' 秒后重发'
    var timer = setInterval(function () {
      left--
      if (left <= 0) {
        clearInterval(timer)
        btn.disabled = false
        btn.textContent = label
        return
      }
      btn.textContent = left + ' 秒后重发'
    }, 1000)
    return function () { clearInterval(timer) }
  }

  /* ---------------------------------------------- 弹层：手机号 / 邮箱 */

  function openContact(kind, root) {
    var isPhone = kind === 'phone'
    var cfg = isPhone ? {
      title: '修改手机号',
      current: '当前：' + maskPhone(SETTINGS.phone),
      label: '新手机号',
      placeholder: '请输入 11 位手机号',
      type: 'tel',
      maxlength: 11,
      codeLabel: '短信验证码',
      codePlaceholder: '6 位验证码',
      sendLabel: '获取验证码',
      sentToast: '验证码已发送',
      invalid: '手机号格式不正确'
    } : {
      title: '修改邮箱',
      current: '当前：' + maskEmail(SETTINGS.email),
      label: '新邮箱地址',
      placeholder: '请输入邮箱地址',
      type: 'email',
      maxlength: 64,
      codeLabel: '邮箱验证码',
      codePlaceholder: '6 位验证码',
      sendLabel: '获取验证码',
      sentToast: '验证码已发送至邮箱',
      invalid: '邮箱格式不正确'
    }

    var body =
      '<p class="sys-current">' + dom.esc(cfg.current) + '</p>' +
      '<div class="field">' +
        '<label class="field-label" for="sys-contact-input">' + dom.esc(cfg.label) + '</label>' +
        '<input class="field-input" id="sys-contact-input" type="' + cfg.type + '"' +
        ' maxlength="' + cfg.maxlength + '" autocomplete="off"' +
        ' placeholder="' + dom.esc(cfg.placeholder) + '">' +
      '</div>' +
      '<div class="field sys-field-last">' +
        '<label class="field-label" for="sys-contact-code">' + dom.esc(cfg.codeLabel) + '</label>' +
        '<div class="sys-code-row">' +
          '<input class="field-input" id="sys-contact-code" type="tel" maxlength="6"' +
          ' inputmode="numeric" autocomplete="one-time-code" placeholder="' + dom.esc(cfg.codePlaceholder) + '">' +
          '<button type="button" class="btn btn--soft sys-code-btn" data-act="send">' +
            dom.esc(cfg.sendLabel) + '</button>' +
        '</div>' +
      '</div>' +
      '<p class="field-error" id="sys-contact-error" role="alert" hidden></p>'

    var stopTimer = null

    currentSheet = PP.ui.sheet({
      title: cfg.title,
      body: body,
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn--primary" data-act="save">确认修改</button>' +
        '</div>',
      onMount: function (root2, api) {
        var input = dom.qs('#sys-contact-input', root2)
        var code = dom.qs('#sys-contact-code', root2)
        var err = dom.qs('#sys-contact-error', root2)
        var send = dom.qs('[data-act="send"]', root2)

        function fail(msg, el) {
          err.textContent = msg
          err.hidden = false
          if (el) {
            el.setAttribute('aria-invalid', 'true')
            el.focus({ preventScroll: true })
          }
        }

        function clearError() {
          err.hidden = true
          err.textContent = ''
          input.removeAttribute('aria-invalid')
          code.removeAttribute('aria-invalid')
        }

        dom.on(root2, 'input', '#sys-contact-input', clearError)
        dom.on(root2, 'input', '#sys-contact-code', clearError)

        dom.on(root2, 'click', '[data-act="send"]', function () {
          var v = input.value.trim()
          if (!v) return fail('请先输入' + (isPhone ? '新手机号' : '邮箱地址'), input)
          if (isPhone ? !validPhone(v) : !validEmail(v)) return fail(cfg.invalid, input)

          PP.ui.toast(cfg.sentToast)
          if (stopTimer) stopTimer()
          stopTimer = startCountdown(send)
        })

        dom.on(root2, 'click', '[data-act="save"]', function () {
          var v = input.value.trim()
          var c = digitsOf(code.value)

          if (!v) return fail('请输入' + (isPhone ? '新手机号' : '新邮箱地址'), input)
          if (isPhone ? !validPhone(v) : !validEmail(v)) return fail(cfg.invalid, input)
          if (c.length !== 6) return fail('请输入 6 位' + (isPhone ? '短信' : '邮箱') + '验证码', code)
          if (isPhone && v.replace(/\D/g, '').slice(-11) === digitsOf(SETTINGS.phone).slice(-11)) {
            return fail('新手机号不能与当前手机号相同', input)
          }
          if (!isPhone && v.toLowerCase() === String(SETTINGS.email).toLowerCase()) {
            return fail('新邮箱不能与当前邮箱相同', input)
          }

          if (isPhone) SETTINGS.phone = '+86 ' + digitsOf(v).slice(-11)
          else SETTINGS.email = v
          syncRows(root)
          api.close()
          PP.ui.toast((isPhone ? '手机号' : '邮箱') + '修改成功', { icon: 'success' })
        })
      },
      onClose: function () {
        if (stopTimer) stopTimer()
        stopTimer = null
      }
    })
  }

  /* ---------------------------------------------- 弹层：密码 */

  /** 强度打分：长度 2 档 + 大小写 + 数字 + 符号，映射 4 级 */
  function strengthOf(v) {
    var score = 0
    if (v.length >= 6) score++
    if (v.length >= 10) score++
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++
    if (/\d/.test(v)) score++
    if (/[^A-Za-z0-9]/.test(v)) score++
    if (score <= 1) return 1
    if (score === 2) return 2
    if (score === 3) return 3
    return 4
  }

  var STRENGTH_TEXT = {
    1: '弱 · 建议增加长度和复杂度',
    2: '一般 · 还可以更强',
    3: '良好',
    4: '强 · 密码很安全'
  }

  function openPassword(kind) {
    var isLogin = kind === 'login'

    var body =
      '<div class="field">' +
        '<label class="field-label" for="sys-pwd-old">当前密码</label>' +
        '<input class="field-input" id="sys-pwd-old" type="password" autocomplete="current-password"' +
        ' placeholder="请输入当前密码">' +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="sys-pwd-new">新密码</label>' +
        '<input class="field-input" id="sys-pwd-new" type="password" autocomplete="new-password"' +
        ' placeholder="至少 6 位，建议字母 + 数字 + 符号">' +
        '<div class="sys-strength" id="sys-strength" data-level="0" aria-hidden="true">' +
          '<i></i><i></i><i></i><i></i>' +
        '</div>' +
        '<p class="sys-strength-text" id="sys-strength-text">建议使用字母 + 数字 + 符号组合</p>' +
      '</div>' +
      '<div class="field sys-field-last">' +
        '<label class="field-label" for="sys-pwd-confirm">确认新密码</label>' +
        '<input class="field-input" id="sys-pwd-confirm" type="password" autocomplete="new-password"' +
        ' placeholder="请再次输入新密码">' +
      '</div>' +
      '<p class="field-error" id="sys-pwd-error" role="alert" hidden></p>'

    currentSheet = PP.ui.sheet({
      title: isLogin ? '修改登录密码' : '修改交易密码',
      body: body,
      footer:
        '<div class="sheet-footer">' +
        '<button type="button" class="btn btn--ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn--primary" data-act="save">确认修改</button>' +
        '</div>',
      onMount: function (root2, api) {
        var oldPwd = dom.qs('#sys-pwd-old', root2)
        var newPwd = dom.qs('#sys-pwd-new', root2)
        var confirmPwd = dom.qs('#sys-pwd-confirm', root2)
        var bar = dom.qs('#sys-strength', root2)
        var barText = dom.qs('#sys-strength-text', root2)
        var err = dom.qs('#sys-pwd-error', root2)

        function fail(msg, el) {
          err.textContent = msg
          err.hidden = false
          if (el) {
            el.setAttribute('aria-invalid', 'true')
            el.focus({ preventScroll: true })
          }
        }

        dom.on(root2, 'input', '.field-input', function (e, el) {
          err.hidden = true
          err.textContent = ''
          el.removeAttribute('aria-invalid')
        })

        // 强度条实时联动：data-level 驱动颜色，文字同步（aria-live 会被读屏播报）
        dom.on(root2, 'input', '#sys-pwd-new', function () {
          var v = newPwd.value
          if (!v) {
            bar.setAttribute('data-level', '0')
            barText.textContent = '建议使用字母 + 数字 + 符号组合'
            barText.removeAttribute('data-level')
            return
          }
          var lv = strengthOf(v)
          bar.setAttribute('data-level', String(lv))
          barText.textContent = STRENGTH_TEXT[lv]
          barText.setAttribute('data-level', String(lv))
        })

        dom.on(root2, 'click', '[data-act="save"]', function () {
          var oldV = oldPwd.value
          var newV = newPwd.value
          var confirmV = confirmPwd.value

          if (!oldV) return fail('请输入当前密码', oldPwd)
          if (!newV) return fail('请输入新密码', newPwd)
          if (newV.length < 6) return fail('新密码至少 6 位', newPwd)
          if (newV === oldV) return fail('新密码不能与当前密码相同', newPwd)
          if (newV !== confirmV) return fail('两次输入的新密码不一致', confirmPwd)

          api.close()
          PP.ui.toast((isLogin ? '登录密码' : '交易密码') + '修改成功', { icon: 'success' })
        })
      }
    })
  }

  /* ---------------------------------------------- 页面定义 */

  PP.definePage('system-settings', {
    mount: function (root, ctx) {
      syncRows(root)

      dom.on(root, 'click', '.switch', function (e, el) { flipSwitch(el) })

      var ACTIONS = {
        phone: function () { openContact('phone', root) },
        email: function () { openContact('email', root) },
        'login-pwd': function () { openPassword('login') },
        'trade-pwd': function () { openPassword('trade') }
      }

      dom.on(root, 'click', '[data-act]', function (e, el) {
        var fn = ACTIONS[el.getAttribute('data-act')]
        if (fn) fn()
      })

      ctx.onCleanup(function () {
        // 页面被销毁时若弹层还开着，走正常关闭流程（onClose 会清掉倒计时）
        if (currentSheet) {
          currentSheet.close()
          currentSheet = null
        }
      })
    }
  })
})((window.PP = window.PP || {}))
