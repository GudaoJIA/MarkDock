# 01 · Deployment

**English** | [简体中文](../ZH/01-deployment.md)

Use the published candidate **`gudaojia/markdock:0.1.0-rc.1`**, or run from source. The image includes `linux/amd64` and `linux/arm64`; Docker chooses the matching architecture. This is a release candidate, not a stable release; no `latest` tag is published. [Docker Hub](https://hub.docker.com/r/gudaojia/markdock/tags).

## Choose a deployment method

| Method | Requirements | Access |
| --- | --- | --- |
| Local source | Node.js 22, Bun 1.3.3 | A browser on the same computer |
| Server source | The above runtime and an HTTPS reverse proxy | Your configured HTTPS address |
| Docker Compose | Docker Engine, Compose, and an HTTPS reverse proxy | Your configured HTTPS address |

Run only one service instance per data directory. Document storage must support directory synchronization and hard links. Test permissions and filesystem capabilities on network storage or a NAS using a disposable directory first.

## Local source deployment

Run these commands from the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run auth:password
bun run build
bun run start
```

On first setup, enter the password twice; input is not echoed. Skip password initialization if a password already exists. Sign in at <http://127.0.0.1:3000/>, then follow [Getting started](02-getting-started.md) to add a workspace.

The service listens locally by default. Service data is stored in `~/.config/markdock/`. To change this location, use the same environment configuration for password setup and startup; see [Configuration](03-configuration.md#service-configuration). Installation and builds require no AI or cloud service keys.

## Server source deployment

1. Prepare separate service configuration and document directories, writable by the service user.
2. Install frozen dependencies from the repository root.
3. Set the environment variables, initialize the password, build, and start.
4. Configure the HTTPS proxy described below and visit the configured domain.

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

Replace the example paths and domain; directories must already exist. Use a service manager to keep the process running with the same environment. Keep the configuration directory outside document roots.

## Docker Compose

Get the repository to use the maintained [image Compose file](../../compose.image.yaml) and [environment template](../../.env.docker.example):

```sh
git clone https://github.com/GudaoJIA/MarkDock.git
cd MarkDock
```

### 1. Prepare bind mounts

Choose two distinct, existing host directories. You can use an existing project for documents; the configuration directory must be separate from document roots.

| Host directory purpose | Container path | Contents |
| --- | --- | --- |
| Configuration | `/var/lib/markdock` | Pinned workspaces and password hash |
| Documents | `/workspaces` | Documents, resources, project configuration, backups, Trash, and recovery records |

Choose a non-root UID/GID with access to both directories. The application does not create missing mounts or recursively change ownership of host files.

### 2. Configure the environment

```sh
cp .env.docker.example .env.docker
```

Edit `.env.docker`:

| Variable | Value |
| --- | --- |
| `MARKDOCK_PUBLIC_ORIGIN` | External HTTPS address |
| `MARKDOCK_CONFIG_PATH` | Absolute host configuration directory |
| `MARKDOCK_DOCUMENTS_PATH` | Absolute host document directory |
| `MARKDOCK_UID` / `MARKDOCK_GID` | Non-root user and group with read/write access; defaults to 1000 |
| `MARKDOCK_HTTP_PORT` | Host loopback port; defaults to 3000 |

Do not put a password in this file. See the [environment example](../../.env.docker.example).

### 3. Pull, set a password, and start

```sh
docker compose -f compose.image.yaml --env-file .env.docker config --quiet
docker compose -f compose.image.yaml --env-file .env.docker pull
docker compose -f compose.image.yaml --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs
docker compose -f compose.image.yaml --env-file .env.docker up -d
docker compose -f compose.image.yaml --env-file .env.docker logs --tail=50 markdock
```

Run the password command only on first setup; it does not expose a port. The runtime image does not contain Bun, so use the Node command shown above inside the container.

After configuring HTTPS, sign in and browse `/workspaces` in **Workspace management**. Pin the folders you need. These are container paths; unmounted host directories are not exposed.

### 4. Check and stop

```sh
docker compose -f compose.image.yaml --env-file .env.docker ps
docker compose -f compose.image.yaml --env-file .env.docker stop
```

Health checks only confirm that the process responds, not that a password is configured, all directories are writable, or disk space is available. Finish saving and wait for uploads and file operations before stopping. Compose allows 30 seconds for a normal shutdown.

The root filesystem is read-only. Configuration and document mounts are writable, and temporary files use a size-limited memory filesystem. The container listens on `0.0.0.0`, while the host port binds only to `127.0.0.1`.

### Optional: build from source

The existing `compose.yaml` builds `markdock:local` from your checkout. To use it, omit `-f compose.image.yaml` in the commands above and replace `pull` with `build`. Rebuild after source changes. Do not run both configurations against the same data.

## HTTPS reverse proxy

LAN and public access both require an explicitly configured HTTPS origin; there is no remote plain-HTTP switch. For local source mode, you can also reach its default loopback endpoint through an SSH tunnel; Docker still requires its configured HTTPS origin.

The external address, browser `Origin`, and proxy-provided `Host` must match, including non-default ports. The application derives secure cookies from the explicit site configuration. It does not trust `Forwarded`, `X-Forwarded-Host`, or `X-Forwarded-Proto` for access decisions, and these headers do not determine sign-in rate-limit quotas.

When TLS terminates at the proxy, the backend can use HTTP; HTTPS cookies still carry `Secure`. Accept only the configured domain, redirect HTTP to HTTPS, prevent direct backend access, and overwrite client-provided forwarding headers. Backend isolation depends on the listening address, firewall, or private network: Host validation alone does not prevent a client from bypassing the proxy with a matching Host header.

Inside an Nginx HTTPS `server` with certificates already configured, the proxy section can look like this:

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
    proxy_buffering off;
}
```

This is not a complete Nginx configuration. Configure certificates, unknown-Host rejection, connection and request limits, upload timeouts, and log retention separately. Do not cache sign-in, file, or authenticated page responses, or log request bodies, passwords, or cookies. Markdock also applies its own JSON, image, and attachment limits. Use normal shutdown signals and allow active requests time to finish. Do not scale by running multiple processes against the same data directory.

If the proxy is also containerized, connect through a private Docker network and adapt the configuration to your topology. Do not expose the HTTP backend directly to the public internet. Progress streams need timely delivery; do not buffer or cache workspace responses.

## Upgrades and rollback

Finish saving, stop the service, and back up configuration and complete document directories before changing versions. See [Backup and recovery](05-backup-and-recovery.md#upgrades-and-rollback) for steps and data-format limitations.

Compatibility with every NAS, server environment, or downgrade is not guaranteed. Test with isolated directories first. Successful startup and health checks do not replace actual file read/write checks.
