# TESTV 值不值得买

这是一个基于 TESTV「值不值得买」视频内容整理的中文产品目录站。公开站点提供产品搜索、排序、分类筛选、详情页、`/api/products` 和 sitemap。

当前生产运行时只读取脱敏公开快照 `public-catalog/products.json`，不需要连接 Postgres。Prisma/Postgres 仍保留给本地维护端，用于同步视频、补字幕、抽取产品、清洗回填和导出新的公开快照。

最近一次完整维护端基准以 `npm run sync:status` 为准，历史口径约为 `Video.total=705`、`Product.total=705`。

## 快速启动

```powershell
npm install
npm run dev -- --port 3001
```

打开：

```text
http://localhost:3001
```

页面数据来自 `public-catalog/products.json`。如果当前文件还是空快照，页面会正常启动但目录为空。

## 刷新公开快照

维护端数据库可用后运行：

```powershell
npm run db:generate
npm run sync:status
DRY_RUN=true npm run export:public-catalog
npm run export:public-catalog
```

导出脚本会复用展示层清洗逻辑，只写入公开页面/API 需要的字段，不导出完整 `Transcript.content`、抓取日志、cookie 路径、ASR 响应或原始 `data/**` 资产。

## Docker 部署

```powershell
Copy-Item .env.docker.example .env
docker compose up -d --build
```

Docker 生产栈只启动 `app` 服务，并随镜像携带 `public-catalog/products.json`。部署、升级、回滚和 VPS 自动部署见 [docs/deployment.md](./docs/deployment.md)。

## 文档索引

完整文档入口见 [docs/README.md](./docs/README.md)。

- [docs/quick-start.md](./docs/quick-start.md)：最短本地启动步骤。
- [docs/backfill-guide.md](./docs/backfill-guide.md)：字幕抓取、ASR、AI 清洗、快照导出和状态指标。
- [docs/testing.md](./docs/testing.md)：自动化、API、页面和数据验收。
- [docs/deployment.md](./docs/deployment.md)：只读 JSON 生产部署和维护端数据库边界。
- [AGENTS.md](./AGENTS.md)：维护者和 Agent 工作规则。

## 关键安全边界

- 公开运行时不在线写库，线上默认没有数据库容器。
- `prisma/schema.prisma` 变更、线上数据库写入和全量回填必须先得到确认。
- 本地回填先跑小批量 `DRY_RUN=true`，确认后再分批写入。
- 文档和公开文案统一使用 UTF-8 简体中文。
- 修改 Next.js 相关代码前，先阅读本仓库 `node_modules/next/dist/docs/` 中对应版本文档。
- 提交信息遵循 Conventional Commits，详细规则见 [AGENTS.md](./AGENTS.md)。

## 开源隐私边界

本仓库只应提交代码、文档、测试、脱敏样例和公开快照。以下内容不要提交到 GitHub：

- `.env`、`.env.*`、生产 `deploy/.env`、数据库备份和本地 SQLite/Postgres 数据文件。
- `youtube-cookies.txt`、Bilibili Cookie、浏览器 profile、任何导出的登录态 cookie。
- `data/` 下的原始字幕、ASR 响应、yt-dlp/Bilibili/browser 抓取响应、错误日志和完整导出。
- OpenAI/Codex Manager 凭据、GitHub token、SSH 私钥、VPS 密码和任何真实 API key。

提交前运行：

```powershell
npm run privacy:check
```
