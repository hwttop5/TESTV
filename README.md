# YouTube 产品评测榜单

从指定 YouTube 播放列表同步产品评测视频，提取字幕或音频转写内容，再用 AI 抽取产品名称、评分、优点、缺点和证据片段，生成可排序、可搜索的中文展示页面。

## 当前能力

- 同步 YouTube 播放列表视频元数据
- 抓取公开视频字幕，支持 `yt-dlp` 登录态补充抓取
- 可选音频转写兜底
- 抽取产品名称、评分、优点、缺点、证据片段
- 只公开展示中文字段齐全的产品记录
- 首页支持按分数排序、按日期排序、产品名称搜索
- 详情页展示原视频、评分、优缺点和证据片段
- PostgreSQL + Prisma 数据模型，预留京东 / 淘宝推广链接字段

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- PostgreSQL
- Prisma 7
- OpenAI API
- YouTube Data API

## 本地启动

```powershell
npm install
docker-compose up -d
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

## 环境变量

复制 `.env.example` 为 `.env`，至少配置：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/youtube_reviews?schema=public"
YOUTUBE_API_KEY="your_youtube_api_key_here"
YOUTUBE_PLAYLIST_ID="PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7"
OPENAI_API_KEY="your_openai_api_key_here"
OPENAI_MODEL="gpt-4o-mini"
```

如果 YouTube 需要登录态，额外配置：

```env
YTDLP_COOKIES_FILE="/absolute/path/to/youtube-cookies.txt"
```

或：

```env
YTDLP_COOKIES_FROM_BROWSER="chrome:C:\path\to\profile"
YTDLP_JS_RUNTIMES="node"
YTDLP_REMOTE_COMPONENTS="ejs:github"
```

## 数据同步

```powershell
npm run sync:playlist
npm run sync:transcripts
npm run sync:extract
npm run sync:status
npm run sync:daily
```

## 质量检查

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
```

## 当前已验证的本地状态

- 播放列表元数据已同步到 `705` 条可访问视频
- 首页与公开 API 只输出中文展示字段
- 本地字幕同步链路已打通，支持 `cookies-from-browser` 模式

## 注意

- 当前仓库不包含线上部署凭据
- 如果要把抽取和全量同步跑到生产环境，需要真实的 `OPENAI_API_KEY`、YouTube 相关配置以及线上数据库
