# TESTV值不值得买

这是一个基于 TESTV「值不值得买」视频内容整理的中文产品目录站。项目会同步视频列表，抓取字幕或转写内容，提取产品名称、10 分制评分、优点、缺点和视频链接，并提供可搜索、可排序、可按类型筛选的展示页面。

当前本地数据基准以 `npm run sync:status` 为准；最近一次完整回填口径是 `Video.total=705`、`Product.total=705`。如果后续播放列表源发生变化，以新的状态报告更新文档。

## 核心能力

- 一条视频对应一条产品记录，信息不完整也会保留在目录中。
- 首页支持按评分、发布日期、关键词和产品类型筛选。
- 详情页展示封面、10 分制评分、优点、缺点、文字版、YouTube 链接和高置信哔哩哔哩链接。
- 字幕和转写资产会落盘，后续可以继续用于重新整理、导出和二次分析。
- 京东、淘宝等推广链接字段已预留，联盟接入和跳转统计还未实现。

## 公开展示规则

- 公开页面和 API 统一使用简体中文。
- `TESTV`、`YouTube`、`Bilibili`、品牌名、型号和技术缩写可以保留英文。
- 普通英文整句、繁体文本、乱码和“整理中/待补全”这类内部占位不应出现在公开展示层。
- 评分公开使用视频里的 10 分制 `scoreValue`，不再展示百分制口径。
- 详情页不展示证据区；证据类原始字段只保留在内部数据中。
- 优缺点必须来自字幕、转写或当前候选结果；没有明确依据时展示中文空态，不伪造观点。
- 原始 `Transcript.content` 不做破坏性清洗；简体化和文本过滤主要发生在展示层或 `Product` 整理字段。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- PostgreSQL
- Prisma 7
- Vitest
- OpenAI 兼容接口
- YouTube、`yt-dlp`、哔哩哔哩字幕和 ASR 兜底链路

## 快速启动

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

如果只想看样例数据，可执行：

```powershell
npm run db:seed
```

## 环境变量

复制 `.env.example` 为 `.env`，至少确认：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/youtube_reviews?schema=public"
YOUTUBE_API_KEY="your_youtube_api_key_here"
YOUTUBE_PLAYLIST_ID="PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7"
OPENAI_API_KEY="your_openai_api_key_here"
OPENAI_MODEL="gpt-4o-mini"
```

如果需要登录态字幕，优先导出 cookie 文件后配置：

```env
YTDLP_COOKIES_FILE="/absolute/path/to/youtube-cookies.txt"
BILIBILI_PREFERRED_MID="11336264"
BILIBILI_COOKIE_FILE="C:\\path\\to\\bilibili-cookie.txt"
```

ASR 相关变量按需启用：

```env
ENABLE_AUDIO_TRANSCRIPTION="true"
OPENAI_TRANSCRIPTION_MODEL="whisper-1"
ASR_BATCH_SIZE="5"
FASTER_WHISPER_MODEL="small"
FASTER_WHISPER_DEVICE="cuda"
```

## 常用数据命令

播放列表与产品抽取：

```powershell
npm run sync:playlist
npm run sync:extract
npm run sync:status
```

字幕抓取漏斗：

```powershell
npm run sync:transcripts:browser-fast
npm run sync:transcripts:browser-slow
npm run sync:transcripts:ytdlp
npm run sync:transcripts:bilibili
npm run sync:transcripts:asr
npm run sync:transcripts:local-asr
npm run sync:transcripts:drain
```

公开文案清洗和导出：

```powershell
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
npm run export:transcripts
```

`sync:copy-backfill` 会整理产品名、标题、优点、缺点和 `contentStatus`。正式写入本地库前先保留 `DRY_RUN=true`，确认样例后再分批执行 `DRY_RUN=false`。

## 验证命令

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run sync:status
```

页面验收建议启动：

```powershell
npm run dev -- --port 3001
```

并检查首页、类型筛选、排序、搜索、详情页、文字版和 `/api/products`。

## 文档索引

- [quick-start.md](./quick-start.md)：最短本地启动步骤。
- [BACKFILL_GUIDE.md](./BACKFILL_GUIDE.md)：字幕抓取、ASR、AI 清洗和状态指标。
- [TESTING.md](./TESTING.md)：自动化、API、页面和数据验收。
- [DEPLOYMENT.md](./DEPLOYMENT.md)：生产部署与线上数据库边界。
- [AGENTS.md](./AGENTS.md)：维护者和 Agent 工作规则。

`START_HERE.md`、`PROJECT_STATUS.md`、`PROJECT_SUMMARY.md`、`IMPLEMENTATION_REPORT.md`、`IMPLEMENTATION_SUMMARY.md` 只作为历史或辅助材料；如果与上面的入口文档冲突，以入口文档为准。

## 维护边界

- 线上数据库写入、schema 变更和全量回填必须先得到确认。
- 文档和公开文案统一使用 UTF-8 简体中文。
- 修改 Next.js 相关代码前，需要先阅读本仓库 `node_modules/next/dist/docs/` 中对应版本文档。
- 提交信息遵循 Conventional Commits，详细规则见 [AGENTS.md](./AGENTS.md)。
