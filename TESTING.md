# 测试与验收说明

本项目的验收分为四层：静态检查、数据状态检查、API 检查和页面检查。文档改动至少要做静态检查；数据、页面或接口改动还要跑对应验收。

## 静态检查

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

这四个命令是提交前的固定检查。任何失败都需要先修复或说明原因。

## 数据状态检查

```powershell
npm run sync:status
```

重点确认：

- `Video.total`：当前视频总数，最近本地基准为 705。
- `Transcript.covered`：已有字幕或转写的视频数。
- `Video.noTranscript`：仍无字幕的视频数。
- `Product.total`：产品记录总数，应与当前视频目录闭环。
- `Product.complete/partial/placeholder`：产品整理状态分布。
- `Display.traditional`：公开展示层繁体文本数量，应为 0。
- `Display.englishSentence`：公开展示层普通英文整句数量，应为 0。

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
```

验收点：

- 返回分页结构正常。
- 产品字段使用中文展示字段，如 `displayName`、`displayVideoTitle`、`displayPros`、`displayCons`。
- 评分字段使用 `scoreValue`，公开展示为 10 分制。
- 返回 `contentStatus`、`hasTranscript`、`categoryKey`、`categoryLabel`。
- 不依赖 `published=true` 才可见。
- 响应中不应暴露公开证据区字段。

## 页面验收

启动：

```powershell
npm run dev -- --port 3001
```

打开 `http://localhost:3001`，检查：

- 首页标题为 `TESTV值不值得买`。
- 副文案为 `Bunny try before you buy.`。
- 产品卡片只展示一个 10 分制评分。
- 搜索、按评分排序、按日期排序可用。
- 类型筛选选择后立即生效，并体现在 URL 查询参数里。
- 优点/缺点条数与当前展示候选一致，不把空态文案算作真实条目。
- 页面没有繁体整句、普通英文说明句、乱码和内部占位。

详情页检查：

- 封面、标题、状态、评分和发布日期正确。
- YouTube 链接可用；Bilibili 链接只在高置信匹配时展示。
- 优缺点是简洁结论，每侧最多 3 条。
- 字幕区标题为 `文字版`，内容按段落展示。
- 不出现证据区块。
- 无字幕或无明确观点时展示中文空态，不报错。

## 数据流程抽样验收

播放列表：

```powershell
npm run sync:playlist
```

字幕：

```powershell
npm run sync:transcripts:ytdlp
npm run sync:transcripts:bilibili
```

抽取：

```powershell
npm run sync:extract
```

清洗回填 dry run：

```powershell
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

导出：

```powershell
npm run export:transcripts
```

验收点：

- 重复运行不会创建重复视频或重复产品。
- `Product.videoId` 与视频唯一对应。
- 字幕成功项有 `Transcript` 记录和资产路径。
- 失败项有 `lastError` 或终态原因。
- 回填 dry run 不写数据库。

## 安全检查

- `.env` 不提交。
- cookie、API key、数据库密码不写入文档或日志。
- 线上数据库写入前必须单独确认。
- 数据清洗不得修改原始 `Transcript.content`。

## 文档检查

- README 是用户入口，不放冗长运维细节。
- AGENTS 是维护者规则，不放一次性状态报告。
- BACKFILL_GUIDE 与 `package.json` 脚本名一致。
- 不再出现旧数量口径、公开证据区、百分制公开评分或乱码段落。
