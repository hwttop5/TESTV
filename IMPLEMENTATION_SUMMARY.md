# 实施总结（历史材料）

这个文件保留为历史材料。它记录的是早期中文化和全量导入阶段，里面可能出现旧数量口径、公开证据区、旧字幕命令、旧发布规则等已经过时的描述。

当前维护请以这些文档为准：

- [README.md](./README.md)
- [BACKFILL_GUIDE.md](./BACKFILL_GUIDE.md)
- [TESTING.md](./TESTING.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [AGENTS.md](./AGENTS.md)

当前数据和公开规则：

- 目录模型是一视频一产品。
- 本地数据状态以 `npm run sync:status` 为准。
- 公开评分使用 10 分制 `scoreValue`。
- 公开文本统一简体中文，品牌/型号/平台英文可保留。
- 优缺点最多每侧 3 条，必须有字幕或候选依据。
- 不展示证据区。
- 字幕和转写资产要保留，导出使用 `npm run export:transcripts`。

如果本文件与入口文档冲突，以入口文档为准。
