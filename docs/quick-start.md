# 快速启动

这份文档只保留最短路径。公开页面不依赖数据库；维护端同步、回填和导出流程请看 [backfill-guide.md](./backfill-guide.md)。

## 1. 安装依赖

```powershell
npm install
```

## 2. 启动公开站点

```powershell
npm run dev -- --port 3001
```

打开：

```text
http://localhost:3001
```

站点读取 `public-catalog/products.json`。仓库默认带一个合法空快照，所以即使没有本地 Postgres，首页、`/api/products`、详情路由和 sitemap 也应该能启动。

## 3. 可选：准备维护端数据库

只有需要同步视频、补字幕、抽取产品或重新导出公开快照时，才需要本地维护数据库。

复制 `.env.example`：

```powershell
Copy-Item .env.example .env
```

确认 `.env` 中的维护端连接：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/youtube_reviews?schema=public"
```

如果没有现成 Postgres，可以用你自己的本地数据库，或用 Docker 单独启动一个维护端 Postgres。启动数据库后执行：

```powershell
npm run db:generate
npm run db:push
```

需要样例数据时：

```powershell
npm run db:seed
```

## 4. 导出公开快照

维护端数据库可用后：

```powershell
npm run sync:status
DRY_RUN=true npm run export:public-catalog
npm run export:public-catalog
```

默认输出到：

```text
public-catalog/products.json
```

## 5. 常用数据命令

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

## 6. 提交前验证

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run privacy:check
```

## 常见问题

### 端口被占用

```powershell
npm run dev -- --port 3002
```

### 页面没有数据

检查 `public-catalog/products.json` 是否还是空快照。需要真实目录时，先让维护端数据库可用，再执行 `npm run export:public-catalog`。

### 导出快照失败

确认 `.env` 中的 `DATABASE_URL` 指向本地维护数据库，并且数据库服务可连接。本地导出失败不会影响只读公开站点启动。
