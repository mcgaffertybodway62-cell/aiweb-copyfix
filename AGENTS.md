# AGENTS.md — AI 协作约定

本文件供 AI 编码代理（及新协作者）快速了解项目约束与工作流。

## 项目一句话

浏览器扩展：拦截 AI 聊天页面的复制行为，把选区重写为结构正确的 Markdown（纯文本）+ 净化后的 HTML 双格式写回剪贴板。

## 硬性约定

1. **无构建步骤**：`src/` 即最终产物，全部为经典脚本（非 ES module），跨文件通过 `globalThis.AIWEB_COPYFIX_CONFIG`（用户配置）与 `globalThis.AICopyFix`（注册表与工具函数）命名空间通信。
2. **manifest 的 `js` 数组顺序敏感**：`content/config.js` → `content/index.js` → 各适配器。config 提供配置必须最先；index 定义注册表必须先于适配器。
3. **用户可调项一律放 `src/config.js`**，不得散落在逻辑代码里；新增配置项需同步 README 的「配置」表格。
4. **不加注释**：代码内不写注释，设计意图一律写入 `docs/DESIGN.md`。
5. **文档分工**：
   - `README.md` —— 面向用户：是什么、怎么装、怎么配、支持哪些站点
   - `docs/DESIGN.md` —— 面向开发者：需求与实现方式
6. **仅在用户明确要求时提交 git**。

## 新增站点适配器五步清单

适配器统一用工厂 `registry.util.makeSiteAdapter({ id, match, blockSelector, codeSelector, ignoreSelector })` 创建（见 `src/content/adapters/gemini.js`）。然后：

1. `src/content/adapters/<site>.js`
2. `src/manifest.json` → `content_scripts.matches` 加 URL
3. `src/manifest.json` → `content_scripts.js` 数组追加该文件
4. `package.json` → lint 脚本追加该文件
5. `README.md` 支持站点表 + `docs/DESIGN.md` 特征表与「实测 DOM 结构」各加一段

## 调试与验证

- 代码改动后必须：`chrome://extensions/` 点 ↻ 重载扩展 **并刷新目标页面**（MV3 内容脚本只在页面加载时注入）
- 自动化测试：`npm run test:e2e`（jsdom 加载 docs 快照 × 六种选区起点 × 五站点，报告见 `test/report.md`）。改序列化逻辑后必须跑绿再交付
- 手动抽查仅剩两类：真实站点的登录后渲染差异、富文本编辑器（Typora/语雀）的粘贴表现

| 场景 | 期望 |
| --- | --- |
| 仅选代码块 | 输出带语言围栏的完整块 |
| 选「说明文字 + 代码块」 | 正文与围栏块以空行分隔，无按钮文字泄漏 |
| 跨两条消息选区 | 各代码块独立成围栏 |
| 粘贴到 VS Code / QQ | 读 text/plain，Markdown 正确 |
| 粘贴到 Typora / 语雀 | 读 text/html，无 banner 噪音，有语法高亮 |
| 选纯文本段落（不含代码） | 行为与未装扩展时完全一致 |

## DOM 快照工作流

分析站点结构时，让用户保存页面 HTML 到 `docs/相关网页的html/`（已 gitignore，含对话隐私内容，禁止入库）。快照规范：

- 粒度：**整个助手消息根节点**的 outerHTML（含代码块容器、头部条、紧邻说明段落），无需整页 body
- 不得手删代码块内部任何节点
- 见到 `#shadow-root` 需展开复制内部（当前五站均为 light DOM）
- 域名信息靠文件名对应（如 `Kimi.html`）

诊断工具：内容脚本运行在隔离世界，Console 里直接访问 `AICopyFix` 会报 not defined。正确用法：选中内容后，Console（默认页面上下文即可）执行

```js
dispatchEvent(new Event("aicopyfix-inspect"))
```

内容脚本会以 `[aiweb-copyfix] inspect:` 为前缀打印 `{ impl, searchRoot, blocks, selected }`。报告 bug 时附上该输出。
