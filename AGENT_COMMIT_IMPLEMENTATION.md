# Agent 规则与提交约束实施总结（历史材料）

这个文件记录的是早期为仓库加入 `AGENTS.md`、Conventional Commits 和本地 commit hook 的过程。当前维护规则已经沉淀到 [AGENTS.md](./AGENTS.md)。

请以当前 `AGENTS.md` 为准：

- 全程使用简体中文交流。
- 修改 Next.js 相关代码前阅读本地 `node_modules/next/dist/docs/`。
- 保护用户已有改动。
- 数据库 schema 和线上数据写入必须先确认。
- 提交信息遵循 Conventional Commits。
- 完成后运行 `npm run lint`、`npm test`、`npx tsc --noEmit`、`npm run build`。

如果本文件与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。
