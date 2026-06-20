# 部署说明

本项目可以本地运行，也可以部署到 VPS 或其他 Node.js 运行环境。部署文档只描述应用上线和定时任务；任何线上数据库写入、schema 变更、全量字幕补抓或产品回填都必须先得到用户确认。

## 本地开发

```powershell
npm install
docker-compose up -d
npm run db:generate
npm run db:push
npm run dev -- --port 3001
```

访问：

```text
http://localhost:3001
```

## 生产环境要求

- Node.js 20 或更高版本。
- 可用 PostgreSQL 数据库。
- 可选 Docker / Docker Compose。
- 可选 `yt-dlp`，用于字幕和音频兜底。
- 可选 OpenAI 兼容接口，用于产品抽取、文案清洗和 ASR。
- 可选哔哩哔哩 cookie，用于 B 站字幕兜底。

## 环境变量

按 `.env.example` 配置生产 `.env`。常用变量：

```env
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_APP_URL="https://your-domain.example"

YOUTUBE_API_KEY="..."
YOUTUBE_PLAYLIST_ID="PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7"
# 或：
# YOUTUBE_PLAYLIST_URL="https://www.youtube.com/playlist?list=..."

OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-4o-mini"
OPENAI_TRANSCRIPTION_MODEL="whisper-1"

YTDLP_BIN="yt-dlp"
YTDLP_COOKIES_FILE="/absolute/path/to/youtube-cookies.txt"

BILIBILI_PREFERRED_MID="11336264"
BILIBILI_COOKIE_FILE="/absolute/path/to/bilibili-cookie.txt"
```

如果 `.env` 中是 placeholder，脚本可能会跳过 AI 阶段或回退本地规则。不要把真实 key 或 cookie 写入仓库。

## 初始化数据库

本地或新环境：

```bash
npm run db:generate
npm run db:push
```

生产数据库执行前必须确认：

- 当前 `DATABASE_URL` 指向正确环境。
- 已有备份。
- schema 变更影响已说明。
- 用户确认允许写入。

## 构建和启动

```bash
npm run build
npm start
```

部署后检查：

```text
/
/api/products?sort=score
/api/products?sort=date
/api/products?category=phone
```

页面应展示简体中文内容、10 分制评分、类型筛选和详情页文字版。

## 定时同步

生产环境可以按需配置 cron。建议先只做增量同步，避免未经确认的全量回填。

示例：

```bash
0 2 * * * cd /srv/testv && npm run sync:daily >> /var/log/testv-sync.log 2>&1
```

数据整理类任务建议人工触发：

```bash
npm run sync:status
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

确认样例后再考虑写库。线上写库前必须再次确认。

## 字幕和资产

字幕和转写资产会写入：

- `data/browser-transcripts/`
- `data/ytdlp-transcripts/`
- `data/asr-transcripts/`
- `data/transcript-export/`

如果生产环境磁盘较小，先规划保留策略。不要删除还未导出的原始字幕资产。

## 部署后验收

固定检查：

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run sync:status
```

页面检查：

- 首页能打开。
- 搜索、排序和类型筛选正常。
- 详情页显示优缺点和文字版。
- 不出现乱码、繁体整句、普通英文说明句、公开证据区或百分制评分。

API 检查：

- `/api/products?sort=score` 返回 `scoreValue`。
- `/api/products?category=phone` 返回分类后的结果。
- 响应包含 `contentStatus`、`hasTranscript`、`categoryKey`、`categoryLabel`。

## 回滚与安全

- 部署前保留上一版构建或镜像。
- 数据库变更前备份。
- 线上全量字幕补抓、ASR 和 AI 回填成本不可忽略，先小批量验证。
- 如果发现公开层出现繁体、英文整句或乱码，先停止部署，运行 `npm run sync:status` 查看样本。
