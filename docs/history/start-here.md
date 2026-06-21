# 从这里开始

这是历史入口索引。当前最新入口请优先阅读：

1. [README.md](../../README.md)：项目功能、公开规则和常用命令。
2. [quick-start.md](../quick-start.md)：本地快速启动。
3. [backfill-guide.md](../backfill-guide.md)：字幕补齐、ASR、AI 清洗和状态指标。
4. [testing.md](../testing.md)：测试与验收。
5. [deployment.md](../deployment.md)：部署和线上数据库边界。
6. [AGENTS.md](../../AGENTS.md)：维护者和 Agent 工作规则。

`project-status.md`、`project-summary.md`、`implementation-report.md`、`implementation-summary.md` 和其他一次性报告可能记录的是历史阶段状态。如果这些文档与入口文档冲突，以 README、docs/backfill-guide、docs/testing、docs/deployment 和 AGENTS 为准。

最短启动命令：

```powershell
npm install
docker-compose up -d
npm run db:generate
npm run db:push
npm run dev -- --port 3001
```

打开：

```text
http://localhost:3001
```
