# 参与贡献

1. **报 bug**：使用 Issue 模板，务必附 inspect() 输出与 DOM 快照（取证规范见 AGENTS.md「DOM 快照工作流」）。
2. **新增站点适配**：按 AGENTS.md「新增站点适配器五步清单」执行，`npm run test:e2e` 需全绿。
3. **提交信息**：`<type>: <摘要>`，type 取 feat / fix / chore / docs。

本地验证：

```
npm run lint
npm run test:e2e
```
