# 项目总结（历史辅助文档）

这个文件曾用于记录早期 MVP 架构，现在不再作为最新事实来源。当前项目已经从早期“百分制榜单 + 公开证据区”的口径调整为：

- 项目名：`TESTV值不值得买`
- 目录模型：一视频一产品。
- 公开评分：视频原始 10 分制 `scoreValue`。
- 公开语言：简体中文，品牌/型号/平台英文可保留。
- 公开内容：首页、类型筛选、详情页优缺点和文字版，不展示证据区。
- 字幕链路：YouTube 浏览器/`yt-dlp`、Bilibili 字幕、OpenAI ASR、本地 ASR。
- 数据状态：以 `npm run sync:status` 输出为准。

最新文档入口：

- [README.md](./README.md)
- [BACKFILL_GUIDE.md](./BACKFILL_GUIDE.md)
- [TESTING.md](./TESTING.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [AGENTS.md](./AGENTS.md)

如果本文件与入口文档冲突，以入口文档为准。
