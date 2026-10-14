# PPTransfer H5 · 前端开发约定

> 本文档是 H5 工程的编码规范。新增或修改页面必须遵守。
> 参考实现：`src/pages/index.html` + `src/styles/pages/index.css` + `src/js/pages/index.js`，
> 不确定怎么写时先看它。

---

## 一、文件与加载

每个页面由三个文件组成，文件名与路由名严格一致：

```
src/pages/<name>.html          片段：只含页面内容，不含 <html>/<body>
src/styles/pages/<name>.css    页面特有样式（通用样式一律放 components.css）
src/js/pages/<name>.js         页面控制器
```

并在 `src/index.html` 里登记一行 `<link>` 和一行 `<script>`（按字母序插入，保持清单整洁）。

加载顺序由 `src/index.html` 固定：`dom → format → store → ui → chart → routes → router → 页面脚本 → app.js`。
**页面脚本执行时 `PP.definePage` 必须已存在**——它定义在 `routes.js`，不要移走。

---

## 二、页面注册

```js
PP.definePage('trade-collection', {
  mount: function (root, ctx) { ... },  // 片段已注入 root 之后调用
  show:  function (root) { ... },       // 从其他页面返回时
  hide:  function (root) { ... },       // 被其他页覆盖时（可选）
  unmount: function (root) { ... },     // 出栈销毁（可选）
  onParams: function (el, params) { ... } // 带意图进入本页时（可选，show 之前调用）
})
```

`onParams` 只在调用方显式传了 params 时触发（如 `data-go="trade-collection" data-view="fund"`），
用于让 tab 页落位到指定视图；hash 直达与 tabBar 点击不传 params，不会触发。

`ctx` 提供：

| 成员 | 说明 |
|---|---|
| `ctx.name` / `ctx.route` | 当前页面名与路由元信息 |
| `ctx.go(name)` | 跳转页面（tab 页自动等价于 switchTab） |
| `ctx.back()` | 返回上一页 |
| `ctx.setTitle(t)` | 改导航栏标题 |
| `ctx.onCleanup(fn)` | **注册清理函数**。定时器、事件解绑、图表销毁全部在这里做，否则二次进入会重复执行 |

页面可变状态放在**模块作用域闭包变量**里（见 `index.js` 的 `view`），
不要挂到 `this` 上 —— mount 是普通函数调用，没有可靠的 this 语义。

### 声明式跳转（优先用这个）

页面里跳转不需要写 JS，直接在 HTML 上声明，由 `app.js` 的全局委托统一处理：

```html
<button data-go="wallet">我的资产</button>
<button data-go="trade-collection" data-view="fund">在途资金详情</button>  <!-- 进入 tab 页并指定视图 -->
<button data-go="rmb-exchange-withdraw" data-replace>结汇提现</button>     <!-- 平级页互跳：替换栈顶，不入栈 -->
<button data-back>返回</button>
<button data-demo="收款账户管理待接入">…</button>   <!-- 演示占位提示 -->
```

仅当跳转前需要判断/传参时才在 JS 里调 `ctx.go()` / `PP.router.go()`。

**`data-replace` 用在模块内的 tab 上**：同一模块下的平级页面（如人民币结汇的
「结汇提现 / 结汇账户」）互跳时，如果次次入栈，返回键要按很多下才能出去。
带上 `data-replace` 后由 `PP.router.replace()` 处理：目标已在栈中就回退到它，
否则顶掉栈顶再入栈，栈深度不增长，返回键始终落在模块首页。
模块首页（如 `rmb-exchange`）进子页仍用普通 `data-go`——那一步要入栈，返回才有落点。

---

## 三、HTML 片段规范

1. **语义化标签**：区块用 `<section>`，列表用 `<ul>/<li>`，可点的一律 `<button type="button">`，
   纯展示图标 `<svg aria-hidden="true">`。禁止用 `<div>` 扮演按钮。
2. **静态文案直接写在 HTML 里**；列表型数据（≥4 条、同构）由 JS 渲染，数据放在页面 JS 顶部的常量里。
3. **可变的文本节点**加 `id` 或 `data-*` 钩子，JS 只改文本/属性，不重建结构。
4. **金额**：`<span class="num" data-amount>…</span>` —— `data-amount` 受全局脱敏开关控制（见 index.css）。
5. **图标**：`<svg aria-hidden="true"><use href="#i-name"/></svg>`，sprite 见 `src/assets/icons.svg`（30 个 symbol）。
   配色交给外层的 `color`，不要在 symbol 里写死颜色。
6. **弹层不要手写 mask/sheet 结构**，用 `PP.ui.sheet()`，页面里只写触发按钮。
7. 片段里**不要**写 `<style>` 或 `<script>`。

---

## 四、CSS 规范

1. **尺寸基准 375px**（原 750rpx 设计稿 ÷2）。一律用 `px` + `tokens.css` 的变量，禁止 rpx / rem / vw。
2. **只引用语义层 token**（`--text-primary`、`--tone-success-bg`…），不出现硬编码色值；
   确需原始色阶时用 `--blue-600` 这类原始层变量并加注释说明。
3. 页面根选择器写 `.page[data-page='<name>']`（路由器给片段根元素自带该属性），天然作用域隔离。
   **顶层选择器必须带这个前缀**，否则同名类会跨页互相覆盖（`tools/scope_pages_css.py` 可批量补）。
   例外：弹层内容挂在 `#layer-root` 而不是 `.page` 内，这类选择器用 `#layer-root` 前缀。
4. **色调一律 `data-tone` 属性**（blue / success / warning / orange / danger / info / violet / neutral），
   禁止 `.pill.blue` 这类裸类名。
5. 可点元素必须带 **active 反馈**（`:active` 变色或 `opacity:.6`）；
   视觉尺寸小于 44px 的控件用 `::after { inset: -Npx }` 撑大命中区域（见 `.hero-eye`）。
6. 横向滚动列表：`display:flex; overflow-x:auto; scrollbar-width:none` + `.foo::-webkit-scrollbar{display:none}`。
7. 文本截断用 `.truncate`，两列网格用 `.filter-grid`，等宽用 `data-num`。

### 涨跌配色（国内金融惯例）

涨 = 红 `--color-up`，跌 = 绿 `--color-down`，平 = `--text-quaternary`。
由 `PP.format.trend(v)` 得 `'up'|'down'|'flat'`，写成 `data-trend` 属性驱动，不要在 JS 里切类名。

---

## 五、JS 规范

1. **IIFE + `PP` 命名空间**，顶层 `'use strict'`，不引入模块系统（打包器按顺序拼接）。
2. 数据插值必须过 `PP.dom.esc()`；拼接 HTML 用 `PP.dom.raw()` 包裹后交给 `setHTML/renderList`。
3. 事件优先用 `dom.on(root, type, selector, handler)` 委托，返回值（解绑函数）交给 `ctx.onCleanup`。
4. 用户反馈：轻提示 `PP.ui.toast('已复制', {icon:'success'})`、确认 `PP.ui.confirm({content}) → Promise<boolean>`、
   单选 `PP.ui.picker({title, options, value}) → Promise<value>`、动作面板 `PP.ui.actions({options}) → Promise<index|null>`。
   不要 `alert()`，不要自己写遮罩。
   列表分页用 `PP.ui.pager({el, total, page, pageSize, label, onGo})`，不要手写翻页控件；
   筛选条件变化后把页码拨回 1，翻页只切数据切片、不重新过滤。
5. 金额格式化只用 `PP.format`（`fmtNum / withSymbol / growth / trend / isoDate / maskAccount`）。
6. 图表用 `PP.chart.RateChart` + `PP.chart.buildRateSeries`，页面卸载时 `chart.destroy()`。
7. 演示数据在文件顶部用大写常量声明并注明「演示数据」，与接口字段同名，便于将来替换。

---

## 六、可访问性基线

- 所有交互控件可被键盘到达；弹层打开后焦点移入、`Esc` 关闭（`PP.ui` 已内置）。
- 图标按钮必须 `aria-label`；装饰性图标必须 `aria-hidden="true"`。
- 切换类控件用 `aria-pressed` / `aria-selected` 表达状态，而不是只换样式。
- 列表容器加 `role="list"` 或语义化 `<ul>`；图表用 `role="img"` + 动态 `aria-label` 描述结论。
- 对比度不低于 4.5:1（`--text-quaternary` 只用于 ≥12px 的辅助文字）。

---

## 七、不要做

- 不要引入任何依赖（框架、CSS 库、图标库、构建插件）。
- 不要从 `pptransfer-miniapp/` 读任何东西 —— H5 已是独立工程。
- 不要写 `wx.*`、`{{ }}`、`data-wx-*`、`hover-class` 等小程序痕迹。
- 不要新增全局样式覆盖其他页面的选择器。
- **不要把 `data-go` / `data-back` 挪作他用**：它们是 `app.js` 全局委托的保留属性，
  页面根元素上出现 `data-back` 会让二级页任何一次点击都冒泡命中、触发返回
  （路由器的进场动画钩子因此叫 `data-nav`，不叫 `data-back`）。
- 弹层不要手写 mask/sheet 结构，统一走 `PP.ui`；弹层内元素挂在 `#layer-root` 下。
