# 01 · 部署 MarkDock

[English](../EN/01-deployment.md) | **简体中文**

可选择源码运行或 Docker 源码构建。当前尚未发布官方镜像，因此本页不提供 Docker Hub 拉取命令。

## 选择部署方式

| 方式 | 需要准备 | 访问方式 |
| --- | --- | --- |
| 本机源码 | Node.js 22、Bun 1.3.3 | 本机浏览器 |
| 服务器源码 | 上述运行环境、HTTPS 反向代理 | 配置的 HTTPS 地址 |
| Docker Compose | Docker Engine、Compose、HTTPS 反向代理 | 配置的 HTTPS 地址 |

同一数据目录只运行一个服务实例。文档目录需支持目录同步与硬链接；网络磁盘及 NAS 请先用测试目录验证权限和文件系统能力。

## 本机源码部署

在仓库根执行：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run auth:password
bun run build
bun run start
```

首次密码设置会要求输入两次，终端不回显；已有密码时无需重复初始化。打开 <http://127.0.0.1:3000/> 登录，然后按[快速上手](02-getting-started.md)添加工作区。

默认监听本机。服务数据默认保存在 `~/.config/markdock/`；如需更改目录，在设密与启动前使用相同的环境配置，见[配置说明](03-configuration.md#服务配置)。安装与构建不需要 AI 或云服务密钥。

## 服务器源码部署

1. 准备独立的服务配置目录及文档目录，并授予运行用户读写权限。
2. 在仓库根冻结安装依赖。
3. 设置环境变量，初始化密码并构建启动。
4. 配置下方 HTTPS 代理，通过配置的域名访问。

```sh
bun install --frozen-lockfile --ignore-scripts
export MARKDOCK_PUBLIC_ORIGIN=https://notes.example.com
export MARKDOCK_WORKSPACE_ROOTS='["/srv/documents"]'
export MARKDOCK_DATA_DIR=/var/lib/markdock
export MARKDOCK_HOST=127.0.0.1
export PORT=3000
bun run auth:password
bun run build
bun run start
```

示例路径和域名须替换为实际值，目录须预先存在。由服务管理工具保持进程运行，并使用相同环境变量。配置目录放在文档根之外。

## Docker 源码构建

### 1. 准备挂载目录

选择两个不同的、已存在的宿主机目录。文档目录可以是已有项目；配置目录必须独立于文档根。

| 宿主机用途 | 容器路径 | 保存内容 |
| --- | --- | --- |
| 配置目录 | `/var/lib/markdock` | 固定列表、密码哈希 |
| 文档目录 | `/workspaces` | 文档、资源、项目配置、备份、垃圾箱和恢复记录 |

选择有这些目录访问权限的非 root UID/GID。应用不会自动创建缺失挂载或递归修改宿主机文件所有权。

### 2. 填写配置

```sh
cp .env.docker.example .env.docker
```

编辑 `.env.docker`：

| 配置项 | 填写内容 |
| --- | --- |
| `MARKDOCK_PUBLIC_ORIGIN` | 外部 HTTPS 地址 |
| `MARKDOCK_CONFIG_PATH` | 宿主机配置目录的绝对路径 |
| `MARKDOCK_DOCUMENTS_PATH` | 宿主机文档目录的绝对路径 |
| `MARKDOCK_UID` / `MARKDOCK_GID` | 有读写权限的非 root 用户和组，默认 1000 |
| `MARKDOCK_HTTP_PORT` | 宿主机回环端口，默认 3000 |

不要将密码写入环境文件。详细示例见[环境文件](../../.env.docker.example)。

### 3. 构建、设密与启动

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker build
docker compose --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker logs --tail=50 markdock
```

密码命令仅首次执行，不开放端口。运行镜像不含 Bun，容器内使用上述 Node 命令。

配置 HTTPS 代理后登录，在“工作区管理”中浏览 `/workspaces`，固定需要的文件夹。这里显示容器路径，不会暴露未挂载的宿主机目录。

### 4. 检查与停止

```sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker stop
```

健康检查仅表示进程能响应，不代表已设置密码、所有目录可写或磁盘空间充足。停止前在页面完成保存，等待上传、移动等操作结束。Compose 预留 30 秒正常停止时间。

根文件系统只读，配置与文档挂载可写，临时文件使用受限内存目录。容器内监听 `0.0.0.0`，宿主机端口只绑定 `127.0.0.1`。

## HTTPS 反向代理

局域网和公网访问都使用显式配置的 HTTPS 来源；不提供远程明文 HTTP 开关。本机访问也可通过 SSH 隧道使用默认回环入口。


外部地址、浏览器 `Origin`、代理传给应用的 `Host` 必须一致（包含非默认端口）。应用使用显式站点配置确定安全 Cookie，忽略 `Forwarded`、`X-Forwarded-Host` 和 `X-Forwarded-Proto` 作为信任依据。不提供任意代理头信任开关，也不依据这些头分配登录限流额度。

TLS 在代理终止时，后端可以使用 HTTP；HTTPS Cookie 仍带 `Secure`。代理应只接受配置的域名，将 HTTP 重定向到 HTTPS，阻止旁路访问后端，并覆盖客户端提交的转发头。应用无法从 Web Request 获取并验证真实代理源地址，后端隔离由监听地址、防火墙或私有网络保证。Host 校验不是网络隔离，也不能防止绕过代理发送正确 Host 的客户端。

例如在已配置证书的 Nginx HTTPS `server` 中，代理部分可参考：

```nginx
client_max_body_size 110m;
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_cache off;
}
```

这不是完整 Nginx 部署文件；需自行配置域名、证书、未知 Host 拒绝、连接及请求速率限制、上传超时与日志保留。不要缓存登录、文件或认证页面响应，不记录请求正文、密码或 Cookie。应用仍对 JSON、图片及附件执行自己的限额。代理应以正常停止信号退出应用并给予请求完成时间；单实例运行，不能用多个进程共享一个数据目录来扩容。



若代理也在容器中，应通过私有 Docker 网络连接服务，并按拓扑调整配置；不要把 HTTP 后端直接暴露公网。进度流需要及时传递，代理不要缓冲或缓存工作区响应。

## 升级与回滚

先完成保存、停止服务并备份配置与完整文档目录，再更换版本。具体步骤与数据格式限制见[备份与恢复](05-backup-and-recovery.md#升级与回滚)。

当前不承诺所有 NAS、真实服务器环境或跨版本降级均兼容；请先在隔离目录验证。启动成功和健康检查通过不能代替真实文件读写验证。
