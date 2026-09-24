# 01 · Deployment

**English** | [简体中文](../ZH/01-deployment.md)

Run MarkDock from source or build a Docker image from source. No official image has been published yet, so this guide does not include a Docker Hub pull command.

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

## Docker source build

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

### 3. Build, set a password, and start

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker build
docker compose --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker logs --tail=50 markdock
```

Run the password command only on first setup; it does not expose a port. The runtime image does not contain Bun, so use the Node command shown above inside the container.

After configuring HTTPS, sign in and browse `/workspaces` in **Workspace management**. Pin the folders you need. These are container paths; unmounted host directories are not exposed.

### 4. Check and stop

```sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker stop
```

Health checks only confirm that the process responds, not that a password is configured, all directories are writable, or disk space is available. Finish saving and wait for uploads and file operations before stopping. Compose allows 30 seconds for a normal shutdown.

The root filesystem is read-only. Configuration and document mounts are writable, and temporary files use a size-limited memory filesystem. The container listens on `0.0.0.0`, while the host port binds only to `127.0.0.1`.

## HTTPS reverse proxy

LAN and public access both require an explicitly configured HTTPS origin; there is no remote plain-HTTP switch. You can also reach the default loopback endpoint through an SSH tunnel.

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
}
```

This is not a complete Nginx configuration. Configure certificates, unknown-Host rejection, connection and request limits, upload timeouts, and log retention separately. Do not cache sign-in, file, or authenticated page responses, or log request bodies, passwords, or cookies. MarkDock also applies its own JSON, image, and attachment limits. Use normal shutdown signals and allow active requests time to finish. Do not scale by running multiple processes against the same data directory.

If the proxy is also containerized, connect through a private Docker network and adapt the configuration to your topology. Do not expose the HTTP backend directly to the public internet. Progress streams need timely delivery; do not buffer or cache workspace responses.

## Upgrades and rollback

Finish saving, stop the service, and back up configuration and complete document directories before changing versions. See [Backup and recovery](05-backup-and-recovery.md#upgrades-and-rollback) for steps and data-format limitations.

Compatibility with every NAS, server environment, or downgrade is not guaranteed. Test with isolated directories first. Successful startup and health checks do not replace actual file read/write checks.
