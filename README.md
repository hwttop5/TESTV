# TESTV 值不值得买

这是一个基于 TESTV「值不值得买」视频内容整理的中文产品目录站。项目会同步视频列表，抓取字幕或转写内容，提取产品名称、10 分制评分、优点、缺点和视频链接，并提供可搜索、可排序、可按类型筛选的展示页面。

当前本地数据基准以 `npm run sync:status` 为准；最近一次完整回填口径是 `Video.total=705`、`Product.total=705`。如果后续播放列表源发生变化，以新的状态报告更新文档。

## 快速启动

```powershell
npm install
docker compose up -d postgres
npm run db:generate
npm run db:push
npm run dev -- --port 3001
```

打开：

```text
http://localhost:3001
```

只想看样例数据时，可以在建表后执行：

```powershell
npm run db:seed
```

## Docker 部署

```powershell
Copy-Item .env.docker.example .env
docker compose up -d --build
```

首次建表、初始数据导入、升级、回滚和备份流程见 [docs/deployment.md](./docs/deployment.md)。线上写库前必须先确认。

## 文档索引

完整文档入口见 [docs/README.md](./docs/README.md)。

- [docs/quick-start.md](./docs/quick-start.md)：最短本地启动步骤。
- [docs/backfill-guide.md](./docs/backfill-guide.md)：字幕抓取、ASR、AI 清洗和状态指标。
- [docs/testing.md](./docs/testing.md)：自动化、API、页面和数据验收。
- [docs/deployment.md](./docs/deployment.md)：Docker 部署、升级、回滚、备份与线上数据库边界。
- [AGENTS.md](./AGENTS.md)：维护者和 Agent 工作规则。

## 关键安全边界

- 线上数据库写入、schema 变更和全量回填必须先得到确认。
- 本地回填先跑小批量 `DRY_RUN=true`，确认后再分批写入。
- 文档和公开文案统一使用 UTF-8 简体中文。
- 修改 Next.js 相关代码前，先阅读本仓库 `node_modules/next/dist/docs/` 中对应版本文档。
- 提交信息遵循 Conventional Commits，详细规则见 [AGENTS.md](./AGENTS.md)。

## 开源隐私边界

本仓库只应提交代码、文档、测试和脱敏样例。以下内容不要提交到 GitHub：

- `.env`、`.env.*`、生产 `deploy/.env`、数据库备份和本地 SQLite/Postgres 数据文件。
- `youtube-cookies.txt`、Bilibili Cookie、浏览器 profile、任何导出的登录态 cookie。
- `data/` 下的原始字幕、ASR 响应、yt-dlp/Bilibili/browser 抓取响应、错误日志和完整导出。
- OpenAI/Codex Manager 凭据、GitHub token、SSH 私钥、VPS 密码和任何真实 API key。

提交前运行：

```powershell
npm run privacy:check
```
