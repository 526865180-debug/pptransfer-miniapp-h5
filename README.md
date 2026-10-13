# PPTransfer 商户端 · 移动 H5

PPTransfer 跨境收款商户端的移动 H5 应用。**原生前端工程，不依赖任何框架、构建器和外部资源**，
`src/` 是多文件源码，`tools/bundle.py` 把它合并成一份自包含的 `index.html`（约 387 KB）。

> 在线访问：https://526865180-debug.github.io/pptransfer-miniapp-h5/

---

## 与旧版「小程序转换器」的区别

v1 用一个转换器把小程序 WXML/WXSS/JS 翻译成 H5，产物里带着模板运行时、指令解析器和 `wx.*` shim。
v2 放弃了这条路 —— **H5 现在是一个独立的原生工程**：

| | v1 转换器 | v2 现工程 |
|---|---|---|
| 源码形态 | 小程序 WXML/WXSS/JS | 语义化 HTML / CSS / 原生 JS |
| 依赖 | 转换器 + 模板运行时 + wx shim | 无（浏览器原生能力） |
| 图标 | 53 张彩色 PNG（base64 内嵌） | 30 个 SVG symbol（currentColor，共 9.4 KB） |
| 尺寸基准 | rpx → rem 运行时换算 | 375px 基准的 px + 设计令牌 |
| 产物体积 | ~501 KB | ~387 KB |
| 可维护性 | 改 UI 必须懂两套语法 | 直接写 HTML/CSS/JS |

旧实现归档在 `legacy/converter/`，仅为追溯保留，不再维护。

---

## 目录结构

```
index.html                 打包产物（单文件，GitHub Pages 入口）—— 请勿手改
src/
├── index.html             应用入口：登记全部 CSS / JS，定义应用外壳
├── assets/icons.svg       图标 sprite（30 个 symbol，全部 currentColor）
├── styles/
│   ├── tokens.css         设计令牌：原始层（色阶/尺度）+ 语义层（--text-primary 等）
│   ├── base.css           重置与排版
│   ├── components.css     通用组件库（卡片/按钮/表单/列表/弹层/统计条…）
│   ├── shell.css          应用外壳（导航栏/tabBar/页面过渡/启动遮罩）
│   └── pages/<name>.css   各页特有样式（已加 .page[data-page] 作用域前缀）
├── pages/<name>.html      页面片段（只含内容，不含 <html>/<body>）
└── js/
    ├── dom.js             查询 / 事件委托 / 安全插值 / 列表渲染
    ├── format.js          金额与日期格式化（千分位、涨跌、脱敏账号）
    ├── store.js           全局状态（用户信息 / 未读数 / 金额可见性）
    ├── ui.js              反馈与弹层统一收口（toast / sheet / confirm / picker / searchPicker / actions / pager）
    ├── chart.js           原生 Canvas 折线图（平滑曲线 + 渐变面积 + 当前价标注）
    ├── routes.js          14 页路由表（唯一真源）
    ├── router.js          hash 路由 + 页面栈（switchTab / navigateTo / back 语义）
    ├── app.js             启动引导 + 声明式交互委托
    └── pages/<name>.js    页面控制器（PP.definePage 注册）
tools/
├── bundle.py              打包：src/ → 单文件 index.html
├── verify.py              静态校验：自包含性 / 片段齐全 / 图标命中 / 小程序痕迹 / 标签与括号配对
├── render_check.js        渲染验证：无头 Chrome 逐页截图 + 控制台零报错（零依赖，CDP 直连）
├── interact_check.js      交互冒烟：脱敏开关 / tab 切换 / 返回 / 表单校验 / 弹层 / 未读清零
└── scope_pages_css.py     页面 CSS 作用域前缀工具
CONVENTIONS.md             前端开发约定（新增/修改页面必读）
legacy/converter/          v1 转换器归档（不再维护）
```

---

## 快速开始

### 直接看产物

打开根目录 `index.html` 即可，无需服务器 —— 所有样式、脚本、图标、页面片段都已内联。
手机浏览器、微信内置浏览器均可直接渲染。

### 开发

```bash
cd src
python3 -m http.server 8080     # 页面片段用 fetch 加载，必须走 http，不能双击文件
# 打开 http://localhost:8080/index.html
```

改完源码重新打包：

```bash
python3 tools/bundle.py         # src/ → ./index.html
```

### 验证（提交前建议全跑一遍）

```bash
python3 tools/verify.py                          # 静态校验，6 项
node tools/render_check.js                       # 产物 13 页渲染 + 截图 → tools/.render-out/
node tools/render_check.js http://localhost:8080/index.html   # 同上，但验证开发态
node tools/interact_check.js                     # 交互冒烟，78 项断言
```

`render_check.js` / `interact_check.js` 通过 DevTools Protocol 直连 headless Chrome
（Node 22 自带 WebSocket），不需要 puppeteer / playwright。

---

## 架构要点

- **页面注册制**：`PP.definePage(name, { mount, show, hide, unmount })`，
  可变状态放模块作用域闭包，清理走 `ctx.onCleanup(fn)`（定时器 / 事件解绑 / 图表销毁）。
- **声明式交互**：`data-go="wallet"` / `data-back` / `data-demo="文案"` 由 `app.js` 全局委托，
  13 个页面不需要各写一遍导航代码。带视图意图进入 tab 页用
  `data-go="trade-collection" data-view="fund"`（页面按 `onParams` 钩子落位）。
  ⚠ `data-go` / `data-back` 是保留属性名，页面根元素不要挪作他用
  （曾与路由的进场动画属性撞名，导致二级页点哪都返回）。
- **路由**：hash 路由 + 页面栈。tab 页 `switchTab` 清栈，二级页 `navigateTo` 入栈并显示返回键，
  `back` 出栈并恢复上一页滚动位置；支持浏览器前进/后退。
- **样式作用域**：页面 CSS 一律加 `.page[data-page='<name>']` 前缀（`tools/scope_pages_css.py` 可批量处理），
  避免同名类跨页覆盖；弹层内容挂在 `#layer-root`，相关选择器用 `#layer-root` 前缀。
- **金额脱敏**：`data-amount` + `body[data-amount-hidden]` 全站联动，首页眼睛开关只切一个状态。
- **列表分页**：`PP.ui.pager({ el, total, page, pageSize, label, onGo })` 客户端分页
  （数据在内存，翻页只换切片）。总页数 ≤1 时自动收起；页码越界自动收敛；
  容器级 `onclick` 覆盖绑定，重复渲染不会累积监听。
- **无障碍**：语义化标签、`aria-*` 状态、44px 最小命中区（小控件用 `::after` 撑大）、
  弹层焦点管理、`prefers-reduced-motion` 降级。

详细规范见 `CONVENTIONS.md`。

---

## 页面清单（13 页）

| 路由 | 页面 | 底部 tab |
|---|---|---|
| `index` | 商户首页 | 首页 |
| `trade-collection` | 外贸收款管理（页内分段切换「收款记录 / 在途资金」两个视图，列表均分页） | 收款 |
| `rights-center` | 权益中心 | 权益中心 |
| `order-management` | 订单管理 | — |
| `exchange` | 换汇中心 | — |
| `international-remittance` | 国际汇款 | — |
| `rmb-exchange` | 人民币结汇 | — |
| `rmb-exchange-withdraw` | 结汇提现 | — |
| `add-rmb-exchange-account` | 添加人民币结汇账户（三步向导） | — |
| `rmb-exchange-records` | 结汇记录 | — |
| `wallet` | 我的资产 | — |
| `collection` | 外贸收款账户（无入口，保留页） | — |
| `notifications` | 消息通知（经首页「通知」入口进入） | — |

> 原「在途资金」一级页（`in-transit-funds`）已并入 `trade-collection`：
> tabBar 从四栏收敛为三栏，首页在途资金的「详情 ›」带 `data-view="fund"` 直达该视图。

首页为**自然流布局**：图表定高 160px，矮屏退化为可滚动而不是丢内容。

---

## 设计系统

设计令牌分两层（`src/styles/tokens.css`）：
**原始层** `--blue-500` / `--slate-100` 这类色阶与尺度，**语义层** `--text-primary` / `--surface-card` / `--tone-success-bg`。
页面样式只允许引用语义层，主题调整时不用逐页改。

配色遵循国内金融场景惯例：**涨为红 `--color-up`、跌为绿 `--color-down`**，由 `data-trend` 属性驱动。

---

## 已知限制

- **数据为静态演示数据**：接口尚未接入，数据以大写常量形式放在各页面 JS 顶部，字段与后端同名，便于将来替换。
- **图表为轻量手绘**：折线 + 渐变面积 + 当前价标注，未还原 ECharts 的 tooltip / 缩放等交互。
- **`collection` 页无入口**：小程序侧已由 `trade-collection` 取代，此处保留页面本身以备参考。
- 外层壳为浏览器模拟（模拟导航栏 + 底部 tabBar），不是原生导航。

---

## 相关仓库

- [`cross-border-merchant-ui-01`](https://github.com/526865180-debug/cross-border-merchant-ui-01) —— 上游 Web 项目（桌面端 + `shell_h5` H5 体系）。
