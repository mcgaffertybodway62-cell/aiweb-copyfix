# 安全策略

## 报告漏洞

请勿通过公开 Issue 报告安全问题。请通过仓库 **Security → Report a vulnerability**（Private vulnerability reporting）私下报告；如无法使用该入口，可在 Issues 留言请求私下联系方式。

请在报告中包含：复现步骤、受影响版本、可能的修复思路。收到后 72 小时内确认，修复随下一个 patch 版本发布并在 Release notes 致谢。

## 安全模型

本扩展不请求任何浏览器权限、不发起网络请求、不含远程代码；内容脚本仅运行在隔离世界并改写本地剪贴板内容。
