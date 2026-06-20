# 验收检查清单

提交、推送或部署前按本清单检查。涉及线上数据库写入、schema 变更、全量回填时，先停止并向用户确认。

## 环境

- [ ] Node.js 版本符合项目要求。
- [ ] 已安装依赖：`npm install`。
- [ ] Docker Desktop 已启动。
- [ ] 已复制 `.env.example` 到 `.env`。
- [ ] `.env` 中没有占位数据库地址误指向线上库。
- [ ] API key、cookie、数据库密码没有写入仓库文档。

## 数据库

- [ ] PostgreSQL 容器运行正常。
- [ ] Prisma Client 已生成：`npm run db:generate`。
- [ ] 本地 schema 已同步：`npm run db:push`。
- [ ] 没有未经确认的线上数据库写入。
- [ ] `Product.videoId` 保持一视频一产品。

## 固定验证命令

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

- [ ] `npm run lint` 通过。
- [ ] `npm test` 通过。
- [ ] `npx tsc --noEmit` 通过。
- [ ] `npm run build` 通过。

## 数据状态

```powershell
npm run sync:status
```

- [ ] `Video.total` 符合当前播放列表基准。
- [ ] `Product.total` 与目录闭环。
- [ ] `Transcript.covered`、`Video.noTranscript` 数字可解释。
- [ ] `Display.traditional = 0`。
- [ ] `Display.englishSentence = 0`。
- [ ] 剩余 `partial/placeholder` 有合理原因，不靠伪造内容补齐。

## 首页

- [ ] 首页标题为 `TESTV值不值得买`。
- [ ] 副文案为 `Bunny try before you buy.`。
- [ ] 产品列表可以加载。
- [ ] 产品卡片只显示一个 10 分制评分。
- [ ] 优点/缺点条数来自真实展示候选。
- [ ] 搜索可用。
- [ ] 按评分排序可用，空评分在后。
- [ ] 按日期排序可用。
- [ ] 类型筛选可用，并保留在 URL 查询参数中。
- [ ] 页面无乱码、繁体整句、普通英文说明句和内部占位。

## 详情页

- [ ] 产品名称、视频标题、封面和发布日期与同一视频匹配。
- [ ] 评分为 10 分制。
- [ ] YouTube 链接可跳转。
- [ ] Bilibili 链接仅在高置信匹配时展示。
- [ ] 优缺点简洁直接，每侧最多 3 条。
- [ ] 无明确优缺点时显示中文空态。
- [ ] 字幕区标题为 `文字版`。
- [ ] 文字版按段落展示，不是一整块长文本。
- [ ] 不出现证据区块。

## API

检查：

```text
/api/products?sort=score
/api/products?sort=date
/api/products?category=phone
```

- [ ] 返回分页信息。
- [ ] 返回 `displayName`、`displayVideoTitle`、`displayPros`、`displayCons`。
- [ ] 返回 `scoreValue`，不把百分制作为公开评分口径。
- [ ] 返回 `contentStatus`、`hasTranscript`、`categoryKey`、`categoryLabel`。
- [ ] 搜索和类型筛选结果与首页一致。
- [ ] 不公开证据区字段。

## 字幕与回填

- [ ] 字幕资产保存在 `data/*-transcripts/` 或 `data/transcript-export/`。
- [ ] `npm run export:transcripts` 可以生成清单。
- [ ] `sync:copy-backfill` 写库前先执行 dry run。
- [ ] 回填不修改原始 `Transcript.content`。
- [ ] 无字幕或无观点时不生成假优缺点。

## 部署

- [ ] 生产环境变量完整。
- [ ] 生产构建通过。
- [ ] 部署后首页能打开。
- [ ] `/api/products?sort=score` 返回正常。
- [ ] 定时同步日志可追踪。
- [ ] 若涉及线上数据写入，已完成备份和用户确认。

## 文档

- [ ] `README.md` 与当前功能一致。
- [ ] `AGENTS.md` 包含项目维护规则。
- [ ] `BACKFILL_GUIDE.md` 与 `package.json` 脚本名一致。
- [ ] `TESTING.md` 与本清单口径一致。
- [ ] 不再出现旧数量口径、公开证据区、百分制公开评分和乱码核心段落。
