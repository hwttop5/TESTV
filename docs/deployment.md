# Docker 部署说明

生产环境采用 `app + public-catalog/products.json` 的只读架构。Docker Compose 只启动 Web 应用，不再启动 PostgreSQL，也不要求生产运行时配置 `DATABASE_URL`。

Prisma/Postgres 仍作为本地维护端流水线保留：同步视频、补字幕、抽取产品、回填文案后，导出脱敏公开 JSON 快照，再随镜像发布。

## 生产环境要求

- Docker 29 或兼容版本。
- Docker Compose v2 或兼容版本。
- VPS 至少能让反代访问应用容器的 `3000` 端口。
- `public-catalog/products.json` 已存在并通过隐私检查。
- 生产 `.env` 不提交到仓库，只从 `.env.docker.example` 复制后在服务器本地维护。

## 公开快照发布流程

在维护端数据库可用的本地环境执行：

```powershell
npm run db:generate
npm run sync:status
DRY_RUN=true npm run export:public-catalog
npm run export:public-catalog
npm run privacy:check
```

`DRY_RUN=true` 只做读取和校验，不写快照文件。正式导出会更新 `public-catalog/products.json`。如果生产发布时该文件仍为空快照，站点会正常启动但目录为空。

## GitHub Actions 自动部署

仓库需要配置这些 secrets：

```text
VPS_HOST=<your-vps-ip-or-hostname>
VPS_USER=<ssh-user>
VPS_SSH_KEY=<VPS deploy private key>
```

仓库建议配置这些 GitHub variables。下面都是占位例子，不要把真实私钥、密码、IP、cookie 或生产路径写入文档：

```text
NEXT_PUBLIC_APP_URL=https://your-domain.example
NEXT_PUBLIC_BAIDU_TONGJI_ID=<hm.js 后面的统计 ID>
VPS_STACK_DIR=/opt/stacks/example-app
VPS_DATA_DIR=/srv/example-app
CADDY_NETWORK=caddy_proxy
APP_NETWORK_ALIAS=app
```

推送到 `main` 后，`.github/workflows/deploy-vps.yml` 会同步代码到 `VPS_STACK_DIR`，维护 `VPS_STACK_DIR/deploy/.env`，并执行：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build --remove-orphans
```

自动部署不会执行 `db:push`、数据导入、同步、回填、ASR 或任何线上写库操作。

## 域名和反代

DNS：

```text
<your-domain.example> A <your-vps-ip-or-hostname>
```

共享 Caddy 增加：

```caddy
your-domain.example {
  encode zstd gzip
  reverse_proxy <APP_NETWORK_ALIAS>:3000
}
```

修改后在 VPS 校验并重载 Caddy：

```bash
cd <your-caddy-stack-dir>
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

## 首次部署

在服务器项目目录执行：

```bash
cp .env.docker.example .env
```

然后编辑 `.env`，至少修改：

```env
NEXT_PUBLIC_APP_URL="https://your-domain.example"
APP_PORT="3000"
CADDY_NETWORK="caddy_proxy"
APP_NETWORK_ALIAS="app"
```

启动容器：

```bash
docker compose build app
docker compose up -d app
docker compose ps
docker compose logs app --tail=100
```

## 验收检查

容器状态：

```bash
docker compose config
docker compose ps
docker compose logs app --tail=100
```

页面和 API：

```bash
curl -I http://127.0.0.1:3000/
curl "http://127.0.0.1:3000/api/products"
curl "http://127.0.0.1:3000/api/products?sort=date"
curl "http://127.0.0.1:3000/api/products?sort=score"
curl "http://127.0.0.1:3000/sitemap.xml"
```

预期结果：

- 首页可以打开。
- `/api/products` 返回原有分页结构。
- 日期排序按 `video.publishedAt desc`。
- 评分排序按 `scoreValue desc nulls last`。
- 页面和 API 不需要数据库容器。
- 页面和 API 不出现原始字幕全文、抓取日志、cookie 路径、ASR 响应或内部绝对路径。

## 升级发布

更新代码和公开快照后执行：

```bash
docker image tag <APP_IMAGE>:latest <APP_IMAGE>:backup-$(date +%Y%m%d%H%M%S)
docker compose build app
docker compose up -d app
docker compose logs app --tail=100
```

升级后重新执行验收检查。除非本次改动明确包含 schema 变更，并且已经得到确认，否则不要执行 `db:push`。

## 回滚

如果升级后应用异常，可以先查看本机保留的镜像：

```bash
docker images <APP_IMAGE>
```

把备份镜像重新标记为 `latest` 后启动：

```bash
docker tag <APP_IMAGE>:backup-YYYYMMDDHHMMSS <APP_IMAGE>:latest
docker compose up -d app
docker compose logs app --tail=100
```

生产运行时没有数据库状态需要恢复。若问题来自公开快照，回滚到上一版镜像或上一版 `public-catalog/products.json`。

## 维护端数据库边界

维护端数据库只用于本地同步、抽取、清洗和导出。任何线上数据库写入、schema 变更、全量回填、覆盖导入都必须先得到用户确认。

不要提交生产数据库备份、`deploy/.env`、登录态 cookie、ASR 响应或完整 `data/` 资产。部署前后可运行：

```powershell
npm run privacy:check
```
