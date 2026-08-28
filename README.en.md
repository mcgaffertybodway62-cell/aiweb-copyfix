# AIWeb CopyFix

[简体中文](./README.md) | English

A browser extension that fixes broken code-block structure when you select-and-copy AI chat answers (DeepSeek / Kimi / Qwen / GLM / Gemini, etc.).

## Why

Code blocks on AI chat pages are rendered DOM:

- The language label (e.g. `python`) and the Copy button are real DOM nodes;
- The Markdown ``` fence is just styling, not text.

So a plain select-and-copy produces:

1. A stray language-label line at the top of your code;
2. Lost fences;
3. Degraded lists / tables / bold.

Broken copy result:

```
python
import os
print(os.getcwd())
```

What you actually want:

````
```python
import os
print(os.getcwd())
```
````

## Features

- Intercepts `copy` events and rewrites the clipboard with correct structure
- Dual flavor: clean Markdown as `text/plain`, sanitized HTML as `text/html`
- Site adapters: DeepSeek, Gemini, Kimi, GLM, Qwen, ChatGPT — Claude covered by generic heuristics
- Full Markdown fidelity: headings, blockquotes, tables, nested lists, inline code, links, bold/italic/strikethrough, horizontal rules, inline/block math
- Fence rules: full block selection → fenced with language; partial selection → plain fragment (configurable)
- UI chrome (language labels, copy/download buttons) is stripped from both flavors

## Supported Sites

| Site | Status | Notes |
| --- | --- | --- |
| DeepSeek | ✅ dedicated adapter | `.md-code-block` container; banner lives outside `pre` |
| Gemini | ✅ dedicated adapter | `<code-block>` custom element container |
| Kimi | ✅ dedicated adapter | `.segment-code` container |
| GLM (chatglm.cn) | ✅ dedicated adapter | `.code-no-artifacts` container |
| Qwen (qianwen.com) | ✅ dedicated adapter | line numbers are real text nodes, stripped via `ignoreSelector` |
| ChatGPT (chatgpt.com) | ✅ dedicated adapter | `pre.overflow-visible` double CodeMirror (`pre.cm-content code`); supports inline `$..$` and block `data-math-source` math |
| Claude | 🧪 generic heuristic | not yet snapshotted |

> Sites redesign their DOM over time. Automated tests run against minimal synthetic fixtures in `test/fixtures/` (built from real inspected structures, zero private data). Full-page snapshots with real conversations stay outside this repository.

[![CI](https://github.com/mcgaffertybodway62-cell/aiweb-copyfix/actions/workflows/ci.yml/badge.svg)](https://github.com/mcgaffertybodway62-cell/aiweb-copyfix/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green)

## Install (unpacked)

No build step required:

1. Open `chrome://extensions/` in Chrome;
2. Enable **Developer mode** (top right);
3. Click **Load unpacked** and pick the `src/` directory;
4. Copy any selection on a supported AI chat page.

> After pulling new code, hit the ↻ reload button on the extension card **and refresh the page** — MV3 content scripts only inject on page load.

## Configuration

Edit `src/config.js`, then reload the extension:

| Option | Default | Description |
| --- | --- | --- |
| `fencePartialCode` | `false` | Whether a *partial* code selection also gets fenced. `false` = output raw text fragment; `true` = always emit a fenced block with language |

## Development

```
npm run lint        # syntax-check all content scripts
npm run test:e2e    # jsdom matrix: 6 sites x 7 selection scenarios
```

See `AGENTS.md` for contribution conventions and `docs/DESIGN.md` for the technical design.

## License

[MIT](./LICENSE)
