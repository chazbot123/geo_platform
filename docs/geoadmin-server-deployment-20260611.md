# GEO 管理后台部署文档

## 目标

- 域名：`geoadmin.jizhidaoai.com`
- 部署根目录：`/geo_amdin`
- 本文范围：
  - 后台前端 `server/admin-web/src`
  - 后台后端 `server/admin-api`
  - PostgreSQL `deploy/docker-compose.yml`
  - nginx 反向代理与静态托管

## 上传包内容

上传目录包解压后，根目录应直接看到这些目录：

```text
deploy/
server/
```

其中：

- `server/admin-web/src` 是后台页面静态文件
- `server/admin-api` 是后台 API 服务
- `deploy/.env.example` 是数据库环境变量示例
- `deploy/admin-api.env.example` 是后台 API 环境变量示例
- `deploy/nginx/nginx.tls.example.conf` 是 nginx HTTPS 示例

## 服务器目录

建议把上传目录包内容直接放到服务器目录：

```bash
/geo_amdin
```

放置后路径应为：

```text
/geo_amdin/deploy
/geo_amdin/server
```

## 部署步骤

### 1. 上传并解压

把本地生成的目录包上传到服务器，然后把包内内容同步到 `/geo_amdin`。

如果服务器已经有旧版本，先备份再覆盖：

```bash
mkdir -p /geo_amdin/deploy /geo_amdin/server
```

### 2. 直接写数据库 `.env`

直接执行：

```bash
cat >/geo_amdin/deploy/.env <<'EOF'
POSTGRES_DB=geo_admin
POSTGRES_USER=geo_admin
POSTGRES_PASSWORD=!JZDcych1
POSTGRES_PORT=5432
EOF
```

### 3. 直接写后台 API `.env`

直接执行：

```bash
cat >/geo_amdin/deploy/admin-api.env <<'EOF'
PORT=8080
DATABASE_URL=postgres://geo_admin:!JZDcych1@127.0.0.1:5432/geo_admin
ADMIN_USERNAME=geo-admin
ADMIN_PASSWORD=替换成你的后台登录密码
CORS_ORIGIN=https://geoadmin.jizhidaoai.com
RELEASE_BASE_URL=https://geoadmin.jizhidaoai.com
RELEASES_DIR=/geo_amdin/releases
RATE_LIMIT_WINDOW_MS=60000
PUBLIC_RATE_LIMIT_MAX=60
ADMIN_RATE_LIMIT_MAX=300
RELEASE_UPLOAD_LIMIT=500mb
EOF
```

写完后可以检查：

```bash
cat /geo_amdin/deploy/.env
cat /geo_amdin/deploy/admin-api.env
```

## 启动数据库

在 `/geo_amdin` 下执行：

```bash
cd /geo_amdin
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

这个 compose 当前只启动 PostgreSQL。

## 安装并启动后台 API

### 1. 安装依赖

进入后台 API 目录安装依赖：

```bash
cd /geo_amdin/server/admin-api
npm install --omit=dev
```

### 2. 用 pm2 启动

先把环境变量加载到当前 shell：

```bash
set -a
source /geo_amdin/deploy/admin-api.env
set +a
```

首次启动或更新后重启：

```bash
cd /geo_amdin/server/admin-api
pm2 delete geo-admin-api || true
pm2 start src/server.js --name geo-admin-api --interpreter node --cwd /geo_amdin/server/admin-api --update-env
pm2 save
```

查看状态和日志：

```bash
pm2 status
pm2 logs geo-admin-api --lines 100
pm2 restart geo-admin-api --update-env
```

设置开机自启：

```bash
pm2 startup
pm2 save
```

`pm2 startup` 执行后会输出一条命令，复制执行一次即可。

## 配置 nginx

### 1. 写入完整配置

直接执行：

```bash
cat >/etc/nginx/conf.d/geoadmin.jizhidaoai.com.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=geo_public_api:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=geo_admin_api:10m rate=10r/s;

server {
  listen 80;
  server_name geoadmin.jizhidaoai.com;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name geoadmin.jizhidaoai.com;

  ssl_certificate /etc/letsencrypt/live/geoadmin.jizhidaoai.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/geoadmin.jizhidaoai.com/privkey.pem;
  ssl_session_timeout 1d;
  ssl_session_cache shared:SSL:10m;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 600m;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  location /api/admin/ {
    limit_req zone=geo_admin_api burst=40 nodelay;
    proxy_pass http://127.0.0.1:8080/api/admin/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";
  }

  location /api/ {
    limit_req zone=geo_public_api burst=20 nodelay;
    proxy_pass http://127.0.0.1:8080/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";
  }

  location /health {
    proxy_pass http://127.0.0.1:8080/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";
  }

  location /admin/ {
    alias /geo_amdin/server/admin-web/src/;
    index index.html;
    try_files $uri $uri/ /admin/index.html;
  }

  location = /admin {
    return 302 /admin/;
  }

  location /releases/ {
    alias /geo_amdin/releases/;
    autoindex off;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "public, max-age=300" always;
  }
}
EOF
```

### 2. 检查 nginx 配置

重点检查：

- `ssl_certificate`
- `ssl_certificate_key`
- `alias /geo_amdin/server/admin-web/src/`
- `alias /geo_amdin/releases/`

检查通过后重载 nginx：

```bash
nginx -t
systemctl reload nginx
```

## 验证

先验证 API：

```bash
curl -fsS https://geoadmin.jizhidaoai.com/health
```

再验证后台页面：

- 打开 `https://geoadmin.jizhidaoai.com/admin/`

再验证接口反代：

- `https://geoadmin.jizhidaoai.com/api/licenses/status?deviceFingerprint=test`

## 桌面端正式配置

正式环境下，桌面端需要指向服务器域名：

```text
GEO_FEEDBACK_ENDPOINT=https://geoadmin.jizhidaoai.com/api/feedback
GEO_RELEASE_ENDPOINT=https://geoadmin.jizhidaoai.com/api/releases/latest
GEO_LICENSE_ACTIVATION_ENDPOINT=https://geoadmin.jizhidaoai.com/api/licenses/activate
GEO_LICENSE_STATUS_ENDPOINT=https://geoadmin.jizhidaoai.com/api/licenses/status
```

## 更新方式

后续更新后台时：

1. 用新的目录包覆盖 `/geo_amdin/deploy`、`/geo_amdin/server`
2. 不覆盖你已经填好的：
   - `/geo_amdin/deploy/.env`
   - `/geo_amdin/deploy/admin-api.env`
3. 重新执行：

```bash
cd /geo_amdin/server/admin-api
npm install --omit=dev
set -a
source /geo_amdin/deploy/admin-api.env
set +a
pm2 restart geo-admin-api --update-env
nginx -t
systemctl reload nginx
```

## 当前约束

- 后台页面是静态文件，不需要单独前端服务
- 后台 API 通过宿主机进程运行，不在 compose 里启动
- 后台 API 进程由 `pm2` 管理
- 生产环境授权、反馈、更新接口都应走 `https://geoadmin.jizhidaoai.com`
