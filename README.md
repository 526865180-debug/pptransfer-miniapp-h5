# PPTransfer 商户端 · H5 单文件版

把 PPTransfer 微信小程序（`cross-border-merchant-ui-01` → 原生重写版）转换成一份**自带运行时、零外部依赖的单文件 H5 应用**。

产物就是根目录的 **`index.html`（约 500 KB）**：53 张图标全部以 base64 内嵌，双击即可在浏览器打开，也可以直接丢给任何人预览。

> 在线访问：https://526865180-debug.github.io/pptransfer-miniapp-h5/

---

## 为什么是「转换器」而不是手抄

小程序源码约 9000 行（WXML + WXSS + JS），逐页手写 H5 既慢又必然与小程序失同步。这里换了个思路：

```
pptransfer-miniapp/            h5/
├── app.json          ──┐      ├── build.py     ← 构建脚本（WXML/WXSS/JS → 单文件）
├── app.wxss            ├──→   ├── runtime.js   ← 浏览器运行时（模板渲染 + wx.* 模拟）
├── pages/**/*.wxml     │      ├── shell.css    ← 外壳样式（导航栏 / tabBar / toast / modal）
├── pages/**/*.wxss     │      └── verify_h5.js ← 产物校验（jsdom 真实执行）
├── pages/**/*.js     ──┘              │
└── images/*.png                       ▼
                              index.html（单文件产物）
```

**小程序改动后重跑一次 `build.py`，H5 自动跟上。** 两套产物不会失同步。

---

## 快速开始

### 1. 直接看

双击 `index.html`，或在手机上用系统浏览器（Safari / Chrome）打开。

> 注意：微信 / QQ 内置浏览器打开本地 HTML 文件时，部分客户端会强制走「文件预览」而不渲染页面。要发给别人看，建议用上方的 Pages 在线链接。

### 2. 重新构建

需要一份小程序源码在旁边（本仓库不包含）。默认约定 `h5/` 与 `pptransfer-miniapp/` 同级：

```bash
python3 h5/build.py --miniapp ../pptransfer-miniapp --out index.html
```

只依赖 Python 3 标准库，无需安装任何三方包。

### 3. 校验产物

```bash
npm install          # 只装 jsdom（devDependency）
node h5/verify_h5.js index.html
```

校验项（46 条断言）：13 页逐页渲染、表达式插值、条件与列表渲染、图片内嵌、事件绑定 ↔ 方法存在性、路由（tab 切换 / navigateTo / navigateBack）、setData 响应式、弹层开闭、图表实例在数据更新后存活等。

---

## 页面清单（13 页）

| 路由 | 页面 | 底部 tab |
|---|---|---|
| `index` | 商户首页 | 首页 |
| `trade-collection` | 外贸收款管理（收款流水） | 收款 |
| `in-transit-funds` | 在途资金 | 在途资金 |
| `rights-center` | 权益中心 | 权益中心 |
| `order-management` | 订单管理 | — |
| `exchange` | 换汇中心 | — |
| `international-remittance` | 国际汇款 | — |
| `rmb-exchange` | 人民币结汇 | — |
| `rmb-exchange-withdraw` | 结汇提现 | — |
| `rmb-exchange-records` | 结汇记录 | — |
| `wallet` | 我的资产 | — |
| `collection` | 外贸收款账户（无入口，保留页） | — |
| `notifications` | 消息通知（经首页「通知」入口进入） | — |

首页为**整屏单页布局**：企业横幅 / 资产 Hero / 快捷四宫格 / 汇率走势四段压进一屏，不产生滚动；汇率走势卡吸收剩余高度，图表带 `min-height` 兜底与 `max-height` 防拉伸。

---

## 转换规则

### WXML → HTML

| 小程序 | H5 |
|---|---|
| `view` / `text` / `image` | `div` / `span` / `img` |
| `block` | `h5-block`（`display: contents`，不引入额外盒子） |
| `scroll-view` | `div` + `.h5-scroll-x`（横向滑动） |
| `picker`（date） | 视觉层 + 透明覆盖的原生 `input[type=date]` |
| `picker`（selector） | 视觉层 + 透明覆盖的原生 `select`，选项由 `range` 动态填充 |
| `ec-canvas` | `canvas` + 轻量 Canvas 折线图（不引入 ECharts，避免单文件体积膨胀） |
| `wx:if / elif / else` | `data-wx-if` / `data-wx-elif` / `data-wx-else` |
| `wx:for` + `key` / `for-item` | `data-wx-for` 等，由运行时求值 |
| `bindtap` / `catchtap` / `bindinput` | `data-on-tap` / `data-on-tap-catch` / `data-on-input` |
| `hover-class` | `data-hover-class` |
| `{{ }}` 表达式 | 运行时求值（含三元、比较、成员访问；支持属性值里出现 `>`） |

### WXSS → CSS

- `Nrpx` → `(N × 0.1)rem`，运行时按视口宽度设定 root 字号（**1rem === 10rpx**，等价于小程序 750rpx 基准）
- 各页样式统一加 `#pg-<name>` 作用域前缀 —— 各页 `.page` 内边距本来就互不相同，不加前缀必然互相覆盖
- `page {` 选择器 → `body {`（注意源码里 `page` 前有注释，锚点需容错）
- `100vh` → `100%`（页面高度由外壳滚动容器决定）
- 裸标签选择器（`view` / `image` / `ec-canvas` …）同步改名

### JS

页面 JS **原样保留**，包进 `__H5_REGISTER__` 并注入 `require` / `getApp` / `Page` / `wx`。

小程序侧只用到 10 个 `wx.*` API，运行时全部提供了 shim：

`showToast` · `navigateTo` · `navigateBack` · `redirectTo` · `switchTab` · `setClipboardData` · `vibrateShort` · `pageScrollTo` · `showModal` · `chooseMessageFile`

---

## 设计系统

与小程序同源，收敛在 `.hero` / `.card` / `.section` / `.stat-*` / `.chip` / `.tile` 等组件类与一整套 CSS 变量（`--c-primary-50`、`--r-inner`、`--sh-card`、`--sp-3` …）。

小程序端「ops 平台不做移动端适配」的决策不适用于本产物 —— 这里是纯移动端 UI。

配色遵循国内金融场景惯例：**涨为红 `#dc2626`、跌为绿 `#16a34a`**。

---

## 已知限制

- **数据为静态演示数据**：所有接口调用尚未接入，`wx.request` 无 shim。
- **未做小程序登录态**：无 `wx.login` / 用户信息授权链路。
- **图表为轻量手绘**：只保留折线 + 当前价标注，未还原 ECharts 的完整交互（tooltip / 缩放等）。
- **`collection` 页无入口**：小程序侧已由 `trade-collection` 取代，此处保留页面本身以备参考。
- 外层壳为浏览器模拟（模拟导航栏 + 底部 tabBar），不是小程序原生导航。

---

## 相关仓库

- [`cross-border-merchant-ui-01`](https://github.com/526865180-debug/cross-border-merchant-ui-01) —— 上游 Web 项目（桌面端 + `shell_h5` H5 体系），小程序与产物均由它派生。
