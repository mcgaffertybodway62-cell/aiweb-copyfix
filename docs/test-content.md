# 富文本测试内容

各站点夹具来自同一份“生成Markdown测试内容”Prompt 的渲染语义，而不是用户快照本身。为避免隐私进入仓库，`test/fixtures/` 仅保留零隐私的最小 HTML（原始快照保存在仓库外的 `E:\Projects\想法\源码\完整bug`，含 deepseek/gemini/qwen/kimi/glm/GPT 六份）。

测试元素清单：`#` 标题、包含粗体/斜体/行内 code/链接/删除线的 `> 引用`、两段 `python`/`bash` 代码块、行内 `$E=mc^2$`、块级数学 `$$...$$`（含 `\frac` `\sqrt`）、三列表格（含对齐：Kimi 用 `align`，Qwen/GLM/GPT 用 `style:text-align`）、嵌套无序/有序列表、分隔线 `---`、行内 code 与链接。各夹具保留对应站点的真实容器与数学 DOM 特征：

- DeepSeek：`.md-code-block > pre`（无 `code`，`token` 高亮），`katex` 含 `annotation`
- Gemini：`<code-block>` 自定义元素 + `code[data-test-id]`，表格外包 `<table-block>`，数学 `data-math`
- Kimi：`.segment-code` + `pre.language-*`，表格 `align`，数学 `katex-wrapper` 无 `annotation`（回退可视文本）
- Qwen：`.qw-md-code` + `pre` 含 `.linenumber` 需忽略，表格 `style`，数学 `annotation` 完整
- GLM：`.code-no-artifacts` + `pre.hljs`，表格 `style`，数学 `eqn` + `katex-display`
- GPT：`pre.overflow-visible` 双层 CodeMirror（`pre.cm-content code`），表格 `W-fit`，数学 `span[role=math][data-math-source]` 块级；**行内数学在 GPT Web 上未渲染为 KaTeX，HTML 中保留 `$E=mc^2$` 原文本**，扩展直接保留该文本，HTML 侧不额外生成 KaTeX 以避免误渲染
