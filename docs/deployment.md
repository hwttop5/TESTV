# Docker 部署说明

本项目支持用 Docker Compose 部署为 `app + postgres` 两个服务。默认只启动 Web 应用和 PostgreSQL，不会自动执行 `db:push`、数据导入、字幕补抓、ASR、AI 回填或定时同步。

任何线上数据库写入、schema 变更、全量回填、覆盖导入都必须先得到用户确认。

## 生产环境要求

- Docker 29 或兼容版本。

- Docker Compose v2 或兼容版本。

- VPS 至少开放应用端口，默认是 `3000`。

- 生产 `.env` 不提交到仓库，只从 `.env.docker.example` 复制后在服务器本地维护。

- VPS 自动部署使用 `deploy/docker-compose.yml`。生产域名、远端栈目录、数据目录、Caddy 网络名和反代 alias 都通过 GitHub variables 或服务器本地 `.env` 提供，开源仓库不写真实部署拓扑。

## GitHub Actions 自动部署

仓库需要配置这些 secrets：

```text
VPS_HOST=<your-vps-ip-or-hostname>
VPS_USER=<ssh-user>
VPS_SSH_KEY=<VPS deploy private key>
POSTGRES_PASSWORD=<production postgres password>
```

仓库建议配置这些 GitHub variables。下面都是占位例子，不要把真实私钥、密码或 cookie 写入文档：

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

自动部署不会执行 `db:push`、数据导入、同步、回填或 ASR。

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

POSTGRES_PASSWORD="change-this-password"

APP_PORT="3000"

POSTGRES_PORT="5432"

```

启动容器：

```bash

docker compose build app

docker compose up -d postgres app

docker compose ps

docker compose logs app --tail=100

```

检查 PostgreSQL：

```bash

docker compose exec -T postgres pg_isready -U postgres

```

此时数据库可能还是空库，页面可以启动，但涉及数据表的 API 可能在建表前返回错误。不要把这一步理解为已经完成数据初始化。

## 建表和初始数据

线上执行前必须先确认当前 `.env` 指向正确环境，并确认允许写入数据库。

建表命令：

```bash

cd "$VPS_STACK_DIR"

docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm app npm run db:push

```

初始数据导入先 dry run：

```bash

docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm app sh -lc "DRY_RUN=true LIMIT=20 npx tsx scripts/import-local-data.ts"

```

确认 dry run 输出后，才执行正式导入：

```bash

docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm app sh -lc "DRY_RUN=false LIMIT=705 npx tsx scripts/import-local-data.ts"

mkdir -p $VPS_DATA_DIR

touch $VPS_DATA_DIR/.db_initialized

```

默认不要使用 `FORCE_REIMPORT=true`。只有明确确认要覆盖现有数据时，才允许加这个变量。

## 验收检查

容器状态：

```bash

docker compose config

docker compose ps

docker compose logs app --tail=100

docker compose logs postgres --tail=100

```

页面和 API：

```bash

curl -I http://127.0.0.1:3000/

curl "http://127.0.0.1:3000/api/products"

curl "http://127.0.0.1:3000/api/products?sort=date"

curl "http://127.0.0.1:3000/api/products?sort=score"

```

VPS 生产栈使用：

```bash

cd "$VPS_STACK_DIR"

docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps

docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs app --tail=100

```

预期结果：

- 首页可以打开。

- `/api/products` 返回 JSON。

- 日期排序按 `Video.publishedAt desc`。

- 评分排序按 `scoreValue desc nulls last`。

- 页面和 API 不出现乱码、繁体整句、普通英文说明句或百分制评分口径。

## 升级发布

更新代码后执行：

```bash

docker image tag <APP_NETWORK_ALIAS>:latest <APP_NETWORK_ALIAS>:backup-$(date +%Y%m%d%H%M%S)

docker compose build app

docker compose up -d app

docker compose logs app --tail=100

```

升级后重新执行验收检查。除非本次改动明确包含 schema 变更，并且已经得到确认，否则不要执行 `db:push`。

## 回滚

如果升级后应用异常，可以先查看本机保留的镜像：

```bash

docker images <APP_NETWORK_ALIAS>

```

把备份镜像重新标记为 `latest` 后启动：

```bash

docker tag <APP_NETWORK_ALIAS>:backup-YYYYMMDDHHMMSS <APP_NETWORK_ALIAS>:latest

docker compose up -d app

docker compose logs app --tail=100

```

如果异常涉及数据库，先备份并只读核查，再决定是否恢复数据。

## 数据库备份

备份：

```bash

mkdir -p backups

docker compose exec -T postgres pg_dump -U postgres youtube_reviews > backups/youtube_reviews-$(date +%Y%m%d%H%M%S).sql

```

恢复前必须确认目标库和备份文件：

```bash

docker compose exec -T postgres psql -U postgres youtube_reviews < backups/youtube_reviews-YYYYMMDDHHMMSS.sql

```

恢复是线上写库操作，执行前必须单独确认。

## 手动同步和回填

生产环境默认不配置定时任务。需要同步或回填时，先查看状态：

```bash

docker compose run --rm app npm run sync:status

```

数据整理类任务先 dry run：

```bash

docker compose run --rm app sh -lc "DRY_RUN=true LIMIT=20 npm run sync:copy-backfill"

```

确认样例后再考虑小批量正式写入。不要在没有确认的情况下执行 `sync:daily`、`sync:backfill`、`backfill:prices` 或任何 `DRY_RUN=false` 命令。

## 本地开发

本地开发仍建议只用 Compose 启 PostgreSQL，应用用 Next dev 跑：

```powershell

docker compose up -d postgres

npm run db:generate

npm run db:push

npm run dev -- --port 3001

```

访问：

```text

http://localhost:3001

```

## 开源与生产密钥边界

生产密钥只通过 GitHub Secrets、服务器本地 `deploy/.env` 或运维侧 secret 管理，不写入源码仓库。自动部署 workflow 只能引用 secret 名称，不能输出或提交真实值。

不要提交生产数据库备份、`VPS_DATA_DIR` 下的数据、`VPS_STACK_DIR/deploy/.env`、登录态 cookie、ASR 响应或完整 `data/` 资产。部署前后可运行 `npm run privacy:check` 做本地检查。

