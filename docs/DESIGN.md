# AIWeb CopyFix 技术方案

## 1. 核心机制：copy 事件拦截

Content script 中监听 `copy` 事件，在浏览器默认序列化之前接管剪贴板：

```js
document.addEventListener("copy", (event) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const fixed = rewrite(selection);
  event.clipboardData.setData("text/plain", fixed);
  event.preventDefault();
});
```

要点：

- `preventDefault()` 必须调用，否则默认行为仍会执行；
- 只处理 `isCollapsed === false` 的选区，避免干扰按钮自身的单点复制；
- 站点自带的 Copy 按钮（`navigator.clipboard.writeText`）不经过 copy 事件，不受影响。

## 2. 选区解析

从 `Selection` 还原参与复制的 DOM 子树：

1. 用 `range.commonAncestorContainer` 找到公共祖先；
2. 用 TreeWalker 收集选区内所有元素节点，判断节点是否「完整落在选区内」（`range.intersectsNode` + 边界比较）;
3. 对部分覆盖的文本节点按 `range` 切片，保留首尾截断语义。

## 3. 代码块识别

优先使用各站点的确定性特征，回退到启发式：

### 确定性特征（站点适配器）

| 站点 | 特征 |
| --- | --- |
| 站点 | 特征 |
| --- | --- |
| DeepSeek | 容器 `div.md-code-block`，banner 与内层 `pre` 平级；代码体 `pre > span.token*`（无 `<code>`）✅ |
| Gemini | 容器 `<code-block>` 自定义元素，头部 `.code-block-decoration` 含大写语言名与图标按钮；代码体 `pre > code[data-test-id="code-content"]` ✅ |
| Kimi | 容器 `div.segment-code`，头部 `header.segment-code-header` 含 `.segment-code-lang` 语言名 + 复制按钮；代码体 `pre.language-x > code.language-x`；表格使用 `align`，数学为无 `annotation` 的 `katex-wrapper`，列表存在异常结构 ✅ |
| GLM | 容器 `div.code-no-artifacts`，头部 `.top > p.language` 文本即语言名；代码体 `pre.hljs > code`；表格使用 `style`，数学为 `eqn` + `katex-display`，列表可能拆成两个 `ol`，并有 `hr` ✅ |
| 通义 Qwen | 容器 `div.qw-md-code`，sticky 头部 span 文本即语言名 + copy/moon/up 按钮；代码体 `pre > code`；表格对齐写在 `style`，数学有 `annotation`，**行号是真实文本节点** → 适配器声明 `ignoreSelector: ".linenumber"` 剔除 ✅ |
| ChatGPT | 外层 `pre.overflow-visible` 包裹整张卡片（含复制/运行按钮），真实代码在嵌套的 `pre.cm-content > code`（CodeMirror）；具备 `data-start/data-end`、`markdown-new-styling`、SmoothedMarkdown 和头部 Python/Bash 语言名；块级数学是 `span[role="math"][data-math-source]`，行内数学未渲染为 KaTeX 是已知现象 ✅ |
| Claude | 暂无实测快照；早期推测 `pre > code` + `data-language` 属性，待用户提供快照后核实 |

适配器优先通过工厂函数创建（见 `util.makeSiteAdapter`），只需声明容器选择器与代码元素选择器：

```js
registry.util.makeSiteAdapter({
  id: "gemini",
  match: (location) => location.hostname === "gemini.google.com",
  blockSelector: "code-block",
  codeSelector: 'code[data-test-id="code-content"]',
});
```

工厂生成的完整接口（与下方约定一致）：
| Claude | `pre > code`，`data-language` 属性 |
| Gemini | `code-block` 自定义元素，语言在 header 内 |

### 实测 DOM 结构

以下结构来自对各站点真实页面的抓取分析；自动化测试使用 `test/fixtures/` 下按此结构构造的最小合成夹具。

DeepSeek（`deepseek.html`）：

```html
<div class="md-code-block md-code-block-light">
  <div class="md-code-block-banner-wrap">
    <div class="md-code-block-banner md-code-block-banner-lite">
      <span>d813de27">python</span>
      <!-- 复制 / 下载按钮 -->
    </div>
  </div>
  <pre><span><span class="token keyword">print</span>…</span></pre>
</div>
```

关键点：banner 在 `pre` 之外。若只以 `pre` 为块容器，选中「说明文字 + 代码块」时 `python复制下载` 会混入正文——因此 DeepSeek 适配器以 `.md-code-block` 为块容器，`getCodeElement` 取内层 `pre`。

ChatGPT（`chatgpt.html`）：

```html
<pre class="overflow-visible! px-0!" data-start data-end>
  <!-- Copy 按钮（aria-label="复制"，仅图标无文本） -->
  <div id="code-block-viewer" class="cm-editor">
    <div class="cm-scroller">
      <pre class="cm-content"><code><span>收到。</span></code></pre>
    </div>
  </div>
</pre>
```

关键点：`data-start/data-end` 标记代码范围，页面使用 `markdown-new-styling`、SmoothedMarkdown；嵌套双 `pre` 的 CodeMirror 结构中，外层卡片还提供复制/运行按钮和已有语言名。序列化前按「最外层保留」去重候选块，再经 ChatGPT 适配器下钻到真实代码体，避免重复输出。数学通过 `role="math"` 与 `data-math-source` 表示；行内 `$..$` 未渲染为 KaTeX 是已知现象。

GPT 测试内容与其它站点使用同一组 Markdown 语义：标题、富文本引用、表格、嵌套列表、分隔线、行内与块级数学，以及 Python/Bash 两张代码卡片。夹具仅模拟 DOM 形状，不保存原始 715KB 快照。

Gemini（`Gemini.html`）：

```html
<code-block>
  <div class="code-block-decoration header-formatted">
    <span>Python</span>   <!-- 首字母大写；langFromNodes 会 lowercase -->
    <div class="buttons"><!-- 下载 / Copy 图标按钮 --></div>
  </div>
  <pre>
    <code role="text" data-test-id="code-content" class="code-container formatted">
      <span class="hljs-keyword">def</span> …   <!-- highlight.js -->
    </code>
  </pre>
</code-block>
```

关键点：容器为 `<code-block>` 自定义元素（Angular），头部与 `pre` 平级——同 DeepSeek 的泄漏模式。语言名首字母大写（`Python`），提取时统一 lowercase 后再匹配 token 规则。

Kimi（`Kimi.html`）：

```html
<h3>Python</h3>   <!-- 正文标题，属于内容，保留 -->
<div class="segment-code">
  <div class="sticky-release">…<header class="segment-code-header">
    <span class="segment-code-lang">Python</span> 复制按钮…
  </header>…</div>
  <div class="syntax-highlighter light segment-code-content">
    <pre class="language-python"><code class="language-python">…token…</code></pre>
  </div>
</div>
```

GLM（`GLM.html`）：

```html
<div class="code-no-artifacts">
  <div class="top-outer"><div class="top">
    <p class="language">c</p>   <!-- 文本即语言名 -->
    <div class="copy-button"><SVG/>复制</div>
  </div></div>
  <div class="markdown-body md-code …">
    <div class="language language-c" lang="c">
      <pre class="hljs"><code>…hljs token…</code><span aria-hidden="true" class="line-numbers-rows"><span/></span></pre>
    </div>
  </div>
</div>
```

通义 Qwen（`Qwen.html`）：

```html
<div class="… rounded-12 bg-capsule qw-md-code">
  <div class="h-[36px] sticky top-0 …">
    <span class="font-medium mr-auto …">python</span>   <!-- 文本即语言名 -->
    copy/moon/up 图标按钮 ×3
  </div>
  <div class="codeHighlighterWrapper-_O3AS8">
    <pre class="sc-bRKDuR jCSJQZ"><code>
      <span><span class="linenumber react-syntax-highlighter-line-number">1</span><span class="token">print</span>…</span>
    </code></pre>
  </div>
</div>
```

关键点：行号是真实文本节点，直接提取会把行号拼进每行代码——Qwen 适配器声明 `ignoreSelector: ".linenumber"`，序列化时跳过命中该选择器的文本节点。这是首个需要文本级过滤的站点，机制对所有适配器开放。

### 围栏判定

- 选区覆盖代码块**全部内容**（trim 后文本相等，容忍漏选首尾空白）→ 输出 ``` 围栏 + 语言名；
- 只选中块内片段 → 输出纯文本片段，不加围栏（配置项 `fencePartialCode`，见 `src/config.js` 与 README「配置」）。

### 候选块去重规则

选区可能同时命中嵌套的块容器（如 ChatGPT 的双 `pre`）。规则：若候选 A 包含候选 B，则丢弃 B；序列化统一从最外层块出发，由适配器的 `getCodeElement` 定位真实代码元素。

### 纯代码选区（祖先链上扫）

「AI 只回了一个代码块、用户恰好只选中它」时，选区的公共祖先在容器**内部**，向下的 `querySelectorAll` 永远找不到容器。因此候选收集是双向的：向下查后代 + 从 range 两个端点沿祖先链向上收集所有命中 `isBlock` 的元素，合并后按最外层去重。适配器的 `isBlock` 由工厂按 `blockSelector` 自动生成（通用实现为 `PRE` 标签），配置型适配器无需关心。

适配器接口约定（与实现一致）：

```js
{
  id: "deepseek",
  match: (location) => boolean,              // 域名判定
  findCodeBlocks: (root) => HTMLElement[],   // 返回 pre 容器列表
  getCodeElement: (block) => Element,        // 纯代码内容所在元素
  headerNodes: (block) => Set<Element>,      // 装饰性头部节点集合
  getLanguage: (block) => string | null      // 语言名，取不到返回 null
}
```

通用工具函数挂在 `globalThis.AICopyFix.util` 下，新适配器优先复用：

- `findPres(root)`：收集 `pre`
- `structuralHeaders(block, codeEl)`：沿 code 的祖先链收集兄弟节点 + pre 内 button/svg
- `langFromNodes(nodes)`：从头部文本中提取语言 token（含噪声词过滤）
- `langFromClass(el)` / `langFromAttr(root)`：class `language-*` 与 `data-language` 兜底

### 通用启发式

无适配器命中时：

- `pre > code[class*="language-"]` 提取语言；
- 检查 pre 的前一个兄弟节点或首个子元素是否为「短文本 + 可点击图标」模式，判定为装饰性头部并剔除。

## 4. HTML → Markdown 转换

已实现轻量手写规则（无 turndown 依赖，保持“无构建步骤”约束），按 DOM 节点类型分派：

- 标题 `h1-h6` → `#` / `<hN>`
- 引用 `blockquote` → `> ` / `<blockquote>`
- 表格 `table` → GFM `| ... |` + 对齐行 `| :--- |`（支持 `align` 与 `style:text-align` 两派）/ 保留 `<table>`
- 列表 `ul/ol/li` → `- ` / `1. ` 带 `depth*2` 空格缩进，兼容 `ol start` 与 `ul` 误带 `start`，递归处理 `li > ul/ol` 混合嵌套 / 保留 `<ul>/<ol>`
- 行内 `code`（不在 `pre` 内）→ `` ` `` / `<code>`，块级 `pre` 仍走围栏
- 链接 `a[href]` → `[text](url)` / `<a>`，空 `href` 与 `javascript:` 过滤，非文本链接丢弃
- 强调 `strong/b` → `**` / `em/i` → `*` / `s/del` → `~~`
- 分隔线 `hr` → `---` / `<hr>`
- 数学：优先 `annotation[encoding="application/x-tex"]` → `data-math-source` → `data-math` → `aria-label` → 回退 `katex-html` 可视文本（`.katex-html/.katex-mathml` 亦视为数学容器）；`katex-html` 无 `annotation` 时通过 `katexHtmlToTex` 解析 `mfrac(vlist top:-3.677em/-2.314em)`、`sqrt`、`msupsub`（基数取前一 `.mord` 兄弟）回退为 `\frac/\sqrt/^{}`；块级 `katex-display / math-display / qk-md-katext-block / eqn / [role=math][style*=block]` → `$$tex$$`，其余 `\$tex\$`；行内已含 `\$..\$` 不二次包裹；当 `searchRoot` 为 `SPAN.katex-html` 等视文本容器时，`renderRich/renderHtml` 直接判定 `isMath(root)` 并用 `closest(.katex)` 回溯取 `annotation`，避免仅选公式视文本时回落为 `ca+b`
- 噪音 `<button> <svg> [aria-hidden] [data-testid*=copy]` 等在 `renderRich/renderHtml` 入口直接丢弃

代码块仍走适配器围栏逻辑，与上述富文本在 `renderRich` 中按原 DOM 顺序共存；`cleanProse` 仅剥离 UI 词元并 `trimEnd` 保留列表缩进。

## 5. 剪贴板写回

同时写入两种格式，**均由序列化产物生成**（已实现）：

- `text/plain`：修正后的 Markdown（重建围栏、剔除装饰性头部）；
- `text/html`：由同一份 pieces 渲染——散文段落 → `<p>`，代码块 → `<pre><code class="language-x">`。

html 由序列化产物直接渲染，富文本块保留原始标签（`h1/blockquote/table/ul/ol/hr/a/strong/em/del/code`），代码块 → `<pre><code class="language-x">`，数学保留原始 KaTeX/MathML；散文清洗仅剥离 UI 词元并保留列表缩进。

文本序列化通过 `crossesBlockBoundary` 在块级边界（`DIV/P/H*/LI/BLOCKQUOTE/TR`）补 `\n`，兼容 CodeMirror「每行一个 div」的多行代码结构。

通用容器（`p/div/section/article`）按“块级分段 + 行内拼接”策略 `join("\n\n")`，对 `codeSet/table/列表/标题/引用/hr/块级数学` 强制分段，避免连续两代码块 `pre` 同父时 `join("")` 合并。

**小按钮复制**：除 `copy` 事件外，另在捕获阶段监听 `click`（`COPY_BUTTON_SELECTOR` + 文本 `复制/Copy` 回退），通过 `buttonBlock` 定位最近 `isBlock` 或 `findCodeBlocks` 容器，以 `forcedHeaderTouched=true` 调用 `buildCodePiece/markdownCode/htmlCode` 生成围栏，并经 `navigator.clipboard.write`（`ClipboardItem` 双格式）→ `writeText` → `execCommand` 三级回退写回；同时代理 `navigator.clipboard.writeText` 将站点按钮传入的裸代码替换为围栏版本。需 `permissions: ["clipboardWrite"]`。

自动化测试：`npm run test:e2e` 用 jsdom 加载 `test/fixtures/` 合成夹具（禁用页面脚本），注入扩展代码后对每站点 × 12 场景（`inner-whole/header-only/header+code/intro+block/partial-code/container-whole/whole-message` + `math:block-only/block+above/block+below/markdown-whole/partial-tail` + `parent:markdown-whole`）断言纯文本与 html 输出，报告写入 `test/report.md`；本地全量 `test/run-full.mjs`（不入库）可额外读仓库外自选目录的六份整页的 `DIV.markdown` 父容器链，覆盖单选/带上文/带下文/跨父容器等。

## 6. 测试策略

- 单元测试：适配器与启发式的 DOM fixture（jsdom）；
- 手动清单：每站点「代码块 / 混合选区 / 跨消息选区 / 嵌套列表」四类用例。
