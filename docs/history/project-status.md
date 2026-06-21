# 项目状态（历史辅助文档）

这个文件只作为历史辅助材料保留。当前最新状态请优先查看：

- [README.md](../../README.md)
- [backfill-guide.md](../backfill-guide.md)
- [testing.md](../testing.md)
- [verification-checklist.md](../verification-checklist.md)
- [AGENTS.md](../../AGENTS.md)

## 当前状态获取方式

不要手写或猜测当前数据量，直接运行：

```powershell
npm run sync:status
```

最近一次本地完整目录口径为 `Video.total=705`、`Product.total=705`，但实际状态以命令输出为准。

## 已知产品边界

- 京东、淘宝等推广链接字段已预留，联盟 API、跳转统计和推广披露页还未实现。
- 公开展示层统一简体中文，允许保留品牌、型号和平台英文。
- 优缺点没有字幕依据时允许为空，不应伪造内容。
- 线上数据库写入和全量回填必须先确认。

## 本地验收命令

```powershell
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run sync:status
npm run dev -- --port 3001
```
