# 验收检查清单

提交、推送或部署前按本清单检查。涉及 `prisma/schema.prisma`、线上数据库写入、全量回填或覆盖导入时，先停止并向用户确认。

## 环境

- [ ] Node.js 版本符合项目要求。
- [ ] 已安装依赖：`npm install`。
- [ ] `.env` 没有被提交。
- [ ] API key、cookie、数据库密码没有写入仓库文档。
- [ ] 修改 Next.js 相关代码前已阅读 `node_modules/next/dist/docs/` 中相关版本文档。

## 公开快照

- [ ] `public-catalog/products.json` 是合法 JSON。
- [ ] 如果维护端数据库可用，已运行 `DRY_RUN=true npm run export:public-catalog`。
- [ ] 如果正式刷新目录，已运行 `npm run export:public-catalog`。
- [ ] 产品 `id` 唯一。
- [ ] `video.youtubeId` 唯一。
- [ ] 评分排序口径仍是 `scoreValue desc nulls last`。
- [ ] 日期排序口径仍是 `video.publishedAt desc`。
- [ ] 快照不包含完整原始字幕、抓取日志、cookie、ASR 响应、内部绝对路径或原始 `data/**` 资产路径。

## 固定验证命令

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run privacy:check
```

- [ ] `npm run lint` 通过。
- [ ] `npm test` 通过。
- [ ] `npx tsc --noEmit` 通过。
- [ ] `npm run build` 通过。
- [ ] `npm run privacy:check` 通过。

## 本地服务验收

```powershell
npm run dev -- --port 3001
```

- [ ] 首页可打开。
- [ ] 本地 Postgres 未启动时，公开页面仍不报数据库连接错误。
- [ ] `/api/products?sort=score` 返回正常分页结构。
- [ ] `/api/products?sort=date` 返回正常分页结构。
- [ ] `/api/products?category=phone` 返回正常分页结构。
- [ ] `/sitemap.xml` 可打开。

## 首页

- [ ] 首页标题为 `TESTV 值不值得买`。
- [ ] 副文案为 `Bunny try before you buy.`。
- [ ] 产品列表可以加载。
- [ ] 产品卡片只显示一个 10 分制评分。
- [ ] 搜索可用。
- [ ] 按评分排序可用，空评分在后。
- [ ] 按日期排序可用。
- [ ] 类型筛选可用，并保留在 URL 查询参数中。
- [ ] 页面无繁体整句、普通英文说明句、乱码和内部占位。

## 详情页

- [ ] URL 保持 `/products/[id]`。
- [ ] 产品名称、视频标题、封面和发布日期与同一个视频匹配。
- [ ] 评分为 10 分制。
- [ ] YouTube 链接可跳转。
- [ ] Bilibili 链接仅在高置信匹配时展示。
- [ ] 优缺点简洁直接，每侧最多 3 条。
- [ ] 无明确优缺点时显示中文空态。
- [ ] 字幕区标题为 `文字版`。
- [ ] 文字版按段落展示，不是一整块长文本。
- [ ] 不出现证据区块。

## 维护端数据

- [ ] Prisma Client 已生成：`npm run db:generate`。
- [ ] 本地 schema 同步前确认目标是本地维护库：`npm run db:push`。
- [ ] 没有未经确认的线上数据库写入。
- [ ] `Product.videoId` 保持一视频一产品。
- [ ] `npm run sync:status` 输出可解释。
- [ ] `Display.traditional = 0`。
- [ ] `Display.englishSentence = 0`。

## 部署

- [ ] `deploy/docker-compose.yml` 只启动 `app` 服务。
- [ ] 生产运行时不要求 `DATABASE_URL`、`POSTGRES_*` 或数据库容器。
- [ ] GitHub Actions 不要求 `POSTGRES_PASSWORD` secret。
- [ ] 部署后 VPS-local health check 通过。
- [ ] 配置了 `NEXT_PUBLIC_APP_URL` 时，公网首页 smoke test 通过。

## 文档

- [ ] `README.md` 与当前 JSON 快照架构一致。
- [ ] `docs/deployment.md` 不再描述生产 `app + postgres`。
- [ ] `docs/backfill-guide.md` 包含 `npm run export:public-catalog`。
- [ ] `docs/testing.md` 与本清单口径一致。
