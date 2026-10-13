#!/usr/bin/env node
/**
 * cdp.js · 极简 Chrome DevTools Protocol 客户端（零依赖）
 *
 * Node 22 自带全局 WebSocket，所以不用 puppeteer/playwright 也能驱动
 * headless Chrome。这里只封装渲染验证用得到的那一小部分：
 *   · launchChrome()  —— 起一个 headless 实例，返回 { proc, profile, port }
 *   · getJSON()       —— 读 http://127.0.0.1:<port>/json/list
 *   · CDP             —— 命令收发 + 事件订阅 + eval/waitFor 便捷方法
 *
 * render_check.js（首屏渲染）与 interact_check.js（交互冒烟）共用它。
 */
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.handlers = new Map()
  }

  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.onerror = () => reject(new Error('无法连接 DevTools：' + url))
      ws.onopen = () => {
        const c = new CDP(ws)
        ws.onmessage = (ev) => c._dispatch(JSON.parse(ev.data))
        resolve(c)
      }
    })
  }

  _dispatch(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message + ' (' + msg.error.code + ')'))
      else resolve(msg.result)
      return
    }
    const list = this.handlers.get(msg.method)
    if (list) list.forEach((fn) => fn(msg.params))
  }

  send(method, params) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error('求值异常：' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text))
    }
    return r.result ? r.result.value : undefined
  }

  /** 轮询直到表达式为真；超时抛错并带上最后一次的实际值，方便定位 */
  async waitFor(expression, label, timeout = 10000) {
    const t0 = Date.now()
    let last = null
    while (Date.now() - t0 < timeout) {
      try { last = await this.eval(expression) } catch (e) { last = 'eval-error: ' + e.message }
      if (last) return true
      await sleep(100)
    }
    throw new Error('等待超时（' + label + '）：最后结果 ' + JSON.stringify(last))
  }
}

function launchChrome(extraArgs) {
  if (!fs.existsSync(CHROME)) {
    throw new Error('找不到 Chrome，可用 CHROME_PATH 指定：' + CHROME)
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-render-'))
  const proc = spawn(CHROME, [
    '--headless=new',
    // 受限环境（容器/沙箱）下 Chrome 自身的 setuid 沙箱起不来，会连带 GPU 进程崩溃；
    // headless 自动化场景关掉它是常规做法，不影响被测页面
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--allow-file-access-from-files',
    '--force-color-profile=srgb',
    'about:blank',
  ].concat(extraArgs || []), { stdio: 'ignore' })

  const portFile = path.join(profile, 'DevToolsActivePort')
  return (async () => {
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(portFile)) {
        const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])
        if (port) return { proc, profile, port }
      }
      await sleep(100)
    }
    proc.kill()
    throw new Error('Chrome 未在 10s 内就绪')
  })()
}

function getJSON(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let buf = ''
      res.on('data', (d) => { buf += d })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

/** 已知噪音：不算产物问题 */
const NOISE = [
  // headless 下 CDP 合成的 click 不算「用户手势」，Chrome 会拦 navigator.vibrate。
  // 真机上 haptic() 都在真实点击回调里调用，不会触发这条限制。
  /navigator\.vibrate/i,
]

function isNoise(text) {
  return NOISE.some((re) => re.test(text || ''))
}

/** 打开一个已就绪的 page target，并装上控制台错误收集器 */
async function openPage(port) {
  const targets = await getJSON(port, '/json/list')
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('没有可用的 page target')

  const cdp = await CDP.open(page.webSocketDebuggerUrl)
  const problems = []
  const push = (kind, text) => { if (!isNoise(text)) problems.push({ kind, text }) }
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      push('console.' + p.type, (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
  })
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails
    push('exception', (d.exception && (d.exception.description || d.exception.value)) || d.text)
  })
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error' || p.entry.level === 'warning') {
      push('log.' + p.entry.level, p.entry.text + ' ' + (p.entry.url || ''))
    }
  })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  return { cdp, problems }
}

module.exports = { CHROME, CDP, launchChrome, getJSON, openPage, sleep }
