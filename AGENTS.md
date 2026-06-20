<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Agent Rules

## 交流语言

- 与用户交流必须使用简体中文。
- 命令、路径、API 名称、错误信息、品牌名和型号可以保留英文。
- 文档、页面文案和公开展示内容默认使用 UTF-8 简体中文。

## 修改前检查

- 修改 Next.js 相关代码前，先阅读本仓库 `node_modules/next/dist/docs/` 中与当前任务相关的版本文档。
- 修改前先运行 `git status --short`，确认工作树里已有的用户改动。
- 不要重置、覆盖或删除你没有创建的改动。
- 不要用 `git reset --hard`、`git checkout --` 等破坏性命令，除非用户明确要求。

## 数据库边界

- 修改 `prisma/schema.prisma` 前必须先向用户说明影响并获得确认。
- 对线上数据库执行 `db:push`、迁移、回填、清表、批量写入前必须单独确认。
- 本地回填也要先小批量 dry run，再分批写入。
- schema 变更后需要运行 `npm run db:generate`。

## 项目数据规则

- 当前目录模型是一视频一产品：`Product.videoId` 唯一。
- 首页、详情页和 `/api/products` 面向完整目录，不以 `published=true` 作为公开硬门槛。
- `contentStatus` 取值为 `complete`、`partial`、`placeholder`，用于展示信息完整度。
- 公开评分使用视频里的 10 分制 `scoreValue`；历史兼容评分字段不作为公开口径。
- 排序规则：评分排序按 `scoreValue desc nulls last`；日期排序按 `Video.publishedAt desc`。
- 缩略图、发布日期和视频链接以同一个 `videoId` 的 `Video` 记录为准，避免图文错配。

## 文本清洗规则

- 公开展示层必须统一简体中文。
- 允许保留 `TESTV`、`YouTube`、`Bilibili`、品牌名、型号、平台名和技术缩写。
- 普通英文整句、繁体文本、乱码和内部占位词不得公开展示。
- `Transcript.content` 是原始资产，不做破坏性改写。
- 展示层可以对字幕段落做简体化、空白清理和长度裁剪。
- 优缺点最多每侧 3 条，每条尽量是一句简洁结论。
- 优缺点必须有字幕、转写、库内字段或当前候选作为依据；没有依据时用中文空态，不伪造内容。
- 详情页不展示证据区；证据字段只保留作内部追溯。

## 字幕与回填脚本规则

- 字幕补齐按漏斗执行：浏览器快扫/慢扫、`yt-dlp`、哔哩哔哩字幕、OpenAI ASR、本地 ASR。
- 原始资产保存在 `data/browser-transcripts/`、`data/ytdlp-transcripts/`、`data/asr-transcripts/` 和 `data/transcript-export/`。
- 推荐先运行 `npm run sync:status` 判断队列状态，再决定补抓或回填。
- `sync:copy-backfill` 正式写库前必须先执行：

```powershell
DRY_RUN=true LIMIT=20 npm run sync:copy-backfill
```

- 小批量确认后再用 `DRY_RUN=false` 分批写入本地库。
- 如果 AI 不可用，可以回退本地规则清洗，但不能伪造字幕里没有的观点。

## 文档分工

- `README.md` 面向用户和新维护者，保持紧凑，只写项目入口、常用命令和关键规则。
- `AGENTS.md` 面向维护者和 Agent，写工作流、数据边界和清洗规则。
- `BACKFILL_GUIDE.md` 写字幕抓取、ASR、AI 清洗、资产目录和状态指标。
- `TESTING.md` 与 `VERIFICATION_CHECKLIST.md` 写验收命令、页面/API/数据检查。
- `DEPLOYMENT.md` 写部署和生产数据库安全边界。
- `START_HERE.md`、`PROJECT_STATUS.md`、`PROJECT_SUMMARY.md`、`IMPLEMENTATION_*` 只作为历史或辅助材料，不作为最新事实来源。

## 验证命令

完成任务前运行：

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

数据相关改动还要运行：

```bash
npm run sync:status
```

可见页面或 API 改动完成后，启动本地服务让用户验收：

```bash
npm run dev -- --port 3001
```

## Commit Message Convention

本项目遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。

格式：

```text
<type>[optional scope][optional !]: <description>

[optional body]

[optional footer(s)]
```

常用类型：

- `feat`: 新功能
- `fix`: 缺陷修复
- `docs`: 文档变更
- `style`: 不影响含义的格式调整
- `refactor`: 不改变行为的重构
- `perf`: 性能优化
- `test`: 测试变更
- `build`: 构建系统或依赖变更
- `ci`: CI 配置变更
- `chore`: 其他维护变更
- `revert`: 回滚

示例：

```text
feat: add Chinese localization for product extraction
fix(api): handle null values in product search
docs: update backfill guide with troubleshooting steps
refactor(extraction)!: change prompt structure

BREAKING CHANGE: extraction schema now requires Chinese fields
```

## 开发流程

1. 读相关代码、文档和 Next.js 本地文档。
2. 制定最小必要改动，保护既有用户改动。
3. 修改代码或文档。
4. 运行验证命令。
5. 启动本地服务给用户验收。
6. 用户确认后再提交、推送和部署。
