# 快速启动

这份文档只保留最短启动路径。完整数据补抓和清洗请看 [BACKFILL_GUIDE.md](./BACKFILL_GUIDE.md)。

## 1. 安装依赖

```powershell
npm install
```

## 2. 配置环境变量

复制 `.env.example` 为 `.env`：

```powershell
Copy-Item .env.example .env
```

至少确认：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/youtube_reviews?schema=public"
YOUTUBE_API_KEY="your_youtube_api_key_here"
OPENAI_API_KEY="your_openai_api_key_here"
```

如果只启动页面查看本地已有数据，API key 可以先保留占位。

## 3. 启动数据库

```powershell
docker-compose up -d
```

## 4. 初始化本地数据库

```powershell
npm run db:generate
npm run db:push
```

如果需要样例数据：

```powershell
npm run db:seed
```

## 5. 启动页面

```powershell
npm run dev -- --port 3001
```

打开：

```text
http://localhost:3001
```

## 6. 查看当前数据状态

```powershell
npm run sync:status
```

重点看：

- `Video.total`
- `Transcript.covered`
- `Video.noTranscript`
- `Product.total`
- `Display.traditional`
- `Display.englishSentence`

## 7. 常用数据命令

同步播放列表：

```powershell
npm run sync:playlist
```

字幕补齐：

```powershell
npm run sync:transcripts:ytdlp
npm run sync:transcripts:bilibili
npm run sync:transcripts:asr
```

产品抽取：

```powershell
npm run sync:extract
```

文案清洗 dry run：

```powershell
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

导出字幕：

```powershell
npm run export:transcripts
```

## 8. 提交前验证

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## 常见问题

### 端口被占用

```powershell
npm run dev -- --port 3002
```

### 数据库连接失败

```powershell
docker ps
docker-compose up -d
```

确认 `.env` 中的 `DATABASE_URL` 指向本地数据库。

### 页面没有数据

先运行：

```powershell
npm run sync:status
```

如果 `Product.total=0`，需要先 seed 或跑同步/抽取流程。

### AI 或字幕脚本失败

检查 `.env` 中的 OpenAI、YouTube、Bilibili、`yt-dlp` 和 cookie 文件配置。没有有效 key 时，部分 AI/ASR 步骤会跳过或回退本地规则。
