# TESTV 字幕补齐与产品文案回填指南

这份文档面向本地数据运维。默认只操作本地数据库和本地资产目录；任何线上数据库写入、schema 变更或全量回填都必须先得到用户确认。

## 当前数据口径

- 当前有效目录基准以 `npm run sync:status` 输出为准。
- 最近一次本地完整目录口径：`Video.total=705`、`Product.total=705`。
- 字幕、产品状态和公开展示质量不要手写猜测，统一用状态脚本确认。
- 失败项应记录原因；不要为了凑满数量伪造字幕、评分、优点或缺点。

## 字幕补齐漏斗

推荐先执行状态检查：

```powershell
npm run sync:status
```

字幕补齐按以下顺序推进。

### 1. 浏览器字幕快扫和慢扫

```powershell
npm run sync:transcripts:browser-fast
npm run sync:transcripts:browser-slow
```

- 快扫用于快速处理未解决队列。
- 慢扫用于重试无 timedtext、空 timedtext 或首轮失败的视频。
- 浏览器链路能抓到真实 timedtext 时，保存原始响应和元数据。

### 2. yt-dlp 字幕补抓

```powershell
npm run sync:transcripts:ytdlp
```

推荐使用导出的 cookie 文件：

```env
YTDLP_COOKIES_FILE="/absolute/path/to/youtube-cookies.txt"
```

不推荐把“直接读取浏览器 cookie 数据库”作为常规方案，因为浏览器 cookie 数据库容易被占用，稳定性较差。

### 3. 哔哩哔哩字幕兜底

```powershell
npm run sync:transcripts:bilibili
```

常用配置：

```env
BILIBILI_PREFERRED_MID="11336264"
BILIBILI_COOKIE_FILE="C:\\path\\to\\bilibili-cookie.txt"
BILIBILI_BATCH_SIZE="10"
BILIBILI_INCLUDE_ALL_UNRESOLVED="true"
```

B 站匹配遵循“宁可少也别错”：只有高置信匹配才写入字幕或展示 B 站链接。

### 4. OpenAI ASR 和本地 ASR

OpenAI 兼容接口可用时：

```powershell
npm run sync:transcripts:asr
```

本地 faster-whisper 可用时：

```powershell
npm run sync:transcripts:local-asr
```

常用配置：

```env
ASR_BATCH_SIZE="5"
ASR_LIMIT="10"
ASR_MARK_TERMINAL="false"
LOCAL_ASR_BATCH_SIZE="2"
FASTER_WHISPER_MODEL="small"
FASTER_WHISPER_DEVICE="cuda"
```

建议先跑 10 条样本确认质量和成本，再全量 drain。音频文件默认不长期保留，只保存转写文本、segments、元数据和错误摘要。

### 5. 自动漏斗

```powershell
npm run sync:transcripts:drain
```

`drain` 会串联服务端可自动执行的字幕补齐步骤，并在结束后导出字幕清单和状态报告。浏览器快扫/慢扫仍建议单独运行，因为它依赖真实浏览器环境和登录态。

## 字幕资产目录

- `data/browser-transcripts/`：浏览器 timedtext 原始响应、meta 和错误摘要。
- `data/ytdlp-transcripts/`：`yt-dlp` 字幕 JSON3 和 meta。
- `data/asr-transcripts/`：ASR 文本、segments、meta 和错误摘要。
- `data/transcript-export/`：统一导出文件。

导出命令：

```powershell
npm run export:transcripts
```

导出文件：

- `all-transcripts.jsonl`：所有成功字幕。
- `video-transcript-status.jsonl`：全量视频状态清单。
- `summary.json`：导出汇总。

## 产品抽取

有字幕后运行：

```powershell
npm run sync:extract
```

抽取结果应落到同一个 `videoId` 对应的 `Product` 记录。公开评分使用视频里的 10 分制 `scoreValue`；没有明确评分时允许为空。

## AI 文案清洗回填

当产品名、标题、优点、缺点存在空值、繁体、英文整句、乱码或过长口语句时，使用：

```powershell
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

检查输出样例后，再分批写入本地库：

```powershell
DRY_RUN=false LIMIT=20 OFFSET=0 npm run sync:copy-backfill
DRY_RUN=false LIMIT=20 OFFSET=20 npm run sync:copy-backfill
```

可用过滤参数：

```powershell
TARGET_PRODUCT="红米K90" DRY_RUN=true LIMIT=5 npm run sync:copy-backfill
FORCE=true DRY_RUN=true LIMIT=10 npm run sync:copy-backfill
USE_AI=false DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

清洗规则：

- 输出必须是简体中文。
- 品牌、型号、平台名和技术缩写英文可保留。
- 普通英文整句、繁体、乱码、占位词不得回写到公开字段。
- 每侧优缺点最多 3 条，每条尽量一句话。
- 没有字幕依据时允许空数组，不伪造优缺点。
- 不修改 `Transcript.content` 原文。

## 状态验收

```powershell
npm run sync:status
```

重点看：

- `Video.total`
- `Video.available`
- `Video.unavailable`
- `Transcript.total`
- `Transcript.covered`
- `Video.noTranscript`
- `BrowserRecovered`
- `YtDlpRecovered`
- `BilibiliRecovered`
- `AsrRecovered`
- `UnresolvedTerminal`
- `Product.total`
- `Product.complete`
- `Product.partial`
- `Product.placeholder`
- `Display.missingPros`
- `Display.missingCons`
- `Display.traditional`
- `Display.englishSentence`

验收目标不是强行让所有产品完整，而是确保每条视频都有明确状态，公开展示层没有繁体、英文整句、乱码和内部占位。

## 常见问题

### 字幕仍然缺失

先看 `Video.lastError`、`transcriptStage` 和导出的 `video-transcript-status.jsonl`。常见原因包括视频无公开字幕、timedtext 为空、B 站无匹配、音频转写失败、视频不可用。

### 优缺点为空

如果字幕里没有明确正反面观点，产品可以保持 `partial`。前台会显示中文空态，不应强行生成观点。

### AI 不可用

`sync:copy-backfill` 会尝试读取 `.env` 的 OpenAI 兼容配置；如果没有可用配置，会回退本地规则清洗。回退模式可以整理文本，但不应新增事实。

### 线上数据需要同步

暂停操作，先向用户说明数据库地址、写入范围、备份方案和回滚路径。未经确认不要写线上库。

## 开源仓库注意事项

字幕、ASR、yt-dlp、Bilibili 和浏览器抓取产物默认属于本地私有资产，不随开源仓库提交。data/ 目录默认被忽略，只允许保留 data/README.md 和 data/samples/** 里的脱敏样例。

Cookie 只能通过本地私有文件提供，例如 YTDLP_COOKIES_FILE 或 BILIBILI_COOKIE_FILE。不要把 cookie 内容、浏览器 profile、原始抓取响应、ASR 响应或本机绝对路径提交到仓库。

如需导出浏览器 cookie，请在本机使用私有脚本或浏览器插件完成；这类脚本不随开源仓库发布，也不要提交导出的 cookie 文件。

AI 回填默认只读取显式配置的 OPENAI_API_KEY。如需临时复用本机 Codex Manager 配置，必须显式设置 USE_CODEX_MANAGER_OPENAI=true，并在提交前运行 npm run privacy:check。
