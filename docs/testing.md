# 测试与验收说明

本项目的验收分为五层：静态检查、公开快照检查、API 检查、页面检查和隐私检查。公开站点应在没有本地 Postgres 的情况下正常启动。

## 固定检查

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

任何失败都需要先修复或说明原因。

## 公开快照检查

维护端数据库可用时：

```powershell
npm run sync:status
DRY_RUN=true npm run export:public-catalog
```

重点确认：

- `Product.total` 与当前目录基准一致。
- 导出脚本校验通过。
- `public-catalog/products.json` 中产品 `id` 唯一。
- 同一 `video.youtubeId` 不重复。
- 公开快照不包含完整原始 `Transcript.content`、抓取日志、cookie 路径、ASR 响应、`data/**` 原始资产路径或内部绝对路径。

本地维护数据库不可用时，公开站点仍应能读取仓库内的合法空快照。

## API 检查

启动服务：

```powershell
npm run dev -- --port 3001
```

检查：

```text
http://localhost:3001/api/products?sort=score
http://localhost:3001/api/products?sort=date
http://localhost:3001/api/products?category=phone
http://localhost:3001/sitemap.xml
```

验收点：

- `/api/products` 响应结构保持 `{ products, pagination }`。
- 产品字段使用中文展示字段，如 `displayName`、`displayVideoTitle`、`displayPros`、`displayCons`。
- 评分字段使用 `scoreValue`，公开展示为 10 分制。
- 返回 `contentStatus`、`hasTranscript`、`categoryKey`、`categoryLabel`。
- 不依赖 `published=true` 才可见。
- 响应中不暴露证据区字段。
- 不需要本地 Postgres 服务。

## 页面验收

启动：

```powershell
npm run dev -- --port 3001
```

打开 `http://localhost:3001`，检查：

- 首页标题为 `TESTV 值不值得买`。
- 副文案为 `Bunny try before you buy.`。
- 搜索、按评分排序、按日期排序可用。
- 类型筛选选择后立即生效，并体现在 URL 查询参数里。
- 产品卡片只展示一个 10 分制评分。
- 优点/缺点条数与当前展示候选一致，不把空态文案算作真实条目。

详情页检查：

- URL 保持 `/products/[id]`。
- 封面、标题、状态、评分和发布日期来自同一个 `video.youtubeId`。
- YouTube 链接可用；Bilibili 链接只在高置信匹配时展示。
- 优缺点是简洁结论，每侧最多 3 条。
- 字幕区标题为 `文字版`，内容按段落展示。
- 不出现证据区块。
- 无字幕或无明确观点时展示中文空态，不报错。

## 隐私检查

```powershell
npm run privacy:check
```

验收点：

- `.env` 不提交。
- cookie、API key、数据库密码不写入文档或日志。
- `data/` 下只保留 `data/README.md` 和 `data/samples/**`。
- `public-catalog/products.json` 不包含原始私有资产。

## 数据流程抽样验收

这些命令只面向维护端本地数据库：

```powershell
npm run sync:playlist
npm run sync:transcripts:ytdlp
npm run sync:transcripts:bilibili
npm run sync:extract
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

验收点：

- 重复运行不会创建重复视频或重复产品。
- `Product.videoId` 与视频唯一对应。
- 字幕成功项有 `Transcript` 记录和资产路径。
- 失败项有 `lastError` 或终态原因。
- 回填 dry run 不写数据库。
