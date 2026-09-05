# AIWeb CopyFix

[English](./README.en.md) | 简体中文

修复 AI 聊天页面（DeepSeek / Kimi / 通义 / GLM / Gemini 等）选中复制时，代码块结构被破坏的浏览器扩展。

## 问题背景

AI 聊天页面的代码块是「渲染后的 DOM」：

- 语言标签（如 `python`）和 Copy 按钮是真实的 DOM 节点；
- Markdown 的 ``` 围栏只是样式，不是文本内容。

因此直接选中复制会发生：

1. 语言标签作为一行杂文本混入代码开头；
2. ``` 围栏完全丢失；
3. 列表、表格、加粗等 Markdown 结构退化为纯文本。

复制结果示例（错误）：

```
python
import os
print(os.getcwd())
```

期望结果（正确）：

````
```python
import os
print(os.getcwd())
```
````

> 是否补上 ``` 围栏由 `src/config.js` 的 `codeCopyFence` 决定：默认（`false`）纯代码复制输出与原页一致的裸代码；设为 `true` 后才输出上方的 ``` 围栏 + 语言名。带说明文字的混合复制不受该开关影响。

## 功能规划

- [x] 监听 `copy` 事件，拦截并重写剪贴板内容
- [x] 识别选区中的代码块，剔除语言标签行、重建 ``` 围栏
- [x] 纯代码复制可配置：默认裸代码（与原页一致），可切换为 ``` 围栏（`src/config.js`）
- [x] 部分选中代码片段输出纯文本（可在 `src/config.js` 切换是否加围栏）
- [x] 通用启发式：识别「语言名 + 复制按钮」代码块头部模式
- [x] 站点适配器：DeepSeek、Gemini、Kimi、GLM、通义 Qwen、ChatGPT
- [ ] 站点适配器：Claude（暂走通用启发式）
- [x] 选区 HTML → Markdown 整体转换（手写规则：标题/引用/表格/列表/行内code/链接/加粗斜体删除线/分隔线/数学）
- [ ] 设置面板：开关、目标格式（Markdown / 纯文本）
- [ ] Firefox (MV3) 兼容

## 支持站点

| 站点 | 状态 | 说明 |
| --- | --- | --- |
| DeepSeek（chat.deepseek.com） | ✅ 专属适配器 | 适配 `.md-code-block` 容器；banner 在 `pre` 外，语言行不会混入正文 |
| Gemini（gemini.google.com） | ✅ 专属适配器 | 适配 `<code-block>` 自定义元素容器；头部含大写语言名与下载/Copy 按钮 |
| Kimi（www.kimi.com） | ✅ 专属适配器 | 适配 `.segment-code` 容器；头部语言名 + 复制按钮，代码体自带 `language-*` class |
| GLM（chatglm.cn） | ✅ 专属适配器 | 适配 `.code-no-artifacts` 容器；头部 `p.language` 标明类型，代码体为 `pre.hljs` |
| 通义（www.qianwen.com） | ✅ 专属适配器 | 适配 `.qw-md-code` 容器；行号是真实文本节点，已通过 ignoreSelector 剔除 |
| ChatGPT（chatgpt.com / chat.openai.com） | ✅ 专属适配器 | 适配 `pre.overflow-visible` 双层 CodeMirror（真实代码为 `pre.cm-content code`）；卡片头部含 Python/Bash 语言名，已支持行内 `$..$` 与块级 `data-math-source` 数学 |
| Claude | 🧪 通用启发式 | 骨架阶段，未做专属适配 |

> 站点改版可能导致选择器失效。测试用最小合成夹具见 `test/fixtures/`；真实站点快照含对话隐私，保存在仓库之外。

[![CI](https://github.com/mcgaffertybodway62-cell/aiweb-copyfix/actions/workflows/ci.yml/badge.svg)](https://github.com/mcgaffertybodway62-cell/aiweb-copyfix/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green)

## 目录结构

```
aiweb-copyfix/
├── .github/
│   ├── workflows/        # CI 与 Release 自动化
│   └── ISSUE_TEMPLATE/   # Bug 报告模板
├── AGENTS.md             # AI 协作约定
├── CONTRIBUTING.md       # 参与贡献
├── SECURITY.md           # 安全策略
├── LICENSE               # MIT
├── package.json          # 项目元信息
├── docs/
│   ├── DESIGN.md         # 技术方案设计
│   └── PUBLISH.md        # 发布与仓库运营手册
├── test/
│   ├── run.mjs           # 测试入口（npm run test:e2e）
│   └── fixtures/         # 各站点最小合成夹具
└── src/
     ├── manifest.json     # Chrome MV3 清单
     ├── config.js         # 用户配置项
     └── content/
         ├── index.js      # 入口：copy 拦截、选区序列化、默认启发式
         └── adapters/     # 六个站点适配器（+ ChatGPT）
```

## 快速开始

无需构建步骤，直接以未打包扩展方式加载：

1. 打开 Chrome，访问 `chrome://extensions/`；
2. 开启右上角「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择 `src/` 目录；
4. 在支持的 AI 聊天页面选中内容复制即可生效。

> 注意：更新代码后需回到 `chrome://extensions/` 点击扩展卡片上的「重新加载」↻，否则页面里跑的仍是旧脚本。

## 配置

编辑 `src/config.js`，保存后重载扩展生效：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `fencePartialCode` | `false` | 只选中代码块的部分内容时是否也加 ``` 围栏。`false` = 输出纯文本片段；`true` = 一律加围栏和语言名 |
| `codeCopyFence` | `false` | 纯代码复制（点代码块的复制按钮，或选区只含完整代码块、不越出代码块）的格式。`false` = 与原页一致输出裸代码（默认）；`true` = 输出 ``` 围栏 + 语言名。带说明文字的混合选区不受影响，仍保持围栏 |

## 开发与测试

```
npm run lint        # 语法检查全部内容脚本
 npm run test:e2e    # jsdom 矩阵：6 站点 x 7 选区场景
```

测试基于 `test/fixtures/` 下的最小合成夹具（按各站点实测结构构造，零隐私内容）。真实站点 DOM 快照含对话隐私，保存在仓库之外。

## 路线图

| 阶段 | 目标 |
| --- | --- |
| v0.1 ✅ | copy 事件拦截 + 代码块围栏重建（DeepSeek 专属适配器） |
| v0.2 | turndown 全选区 Markdown 转换 |
| v0.3 | 多站点适配器 + 启发式通用匹配 |
| v0.4 | 设置面板、Firefox 移植 |

## 参与贡献

欢迎提 Issue 和 PR。新增站点适配请参考 `AGENTS.md` 的五步清单与 `docs/DESIGN.md` 中的适配器约定；发版流程见 `docs/PUBLISH.md`。

## License

[MIT](./LICENSE)
