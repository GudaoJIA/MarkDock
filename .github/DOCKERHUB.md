# Markdock

**Where Markdown docks. Your files stay yours.**

A self-hosted Markdown workspace with a focused visual editor and a source editor. Read, edit, and organize real files on the device running the service. Keep using the same folders with Git, scripts, other editors, and agents.

## Use it for

- **Personal knowledge:** notes, reading journals, and project documentation, with filename and text search.
- **Blog writing:** edit existing Markdown posts and resources, then publish through your usual tools. YAML frontmatter is editable in Source; there is no built-in publishing integration.
- **Agent files:** review Markdown instructions, memory notes, and skill documents. Markdock does not run agents or install skills.

## Image and release status

`gudaojia/markdock:0.1.0-rc.1` is the first release candidate, available for `linux/amd64` and `linux/arm64`. Docker selects the matching architecture. No `latest` tag is published. Build and manifest checks have passed; regression on target servers and cross-version upgrades remains part of release validation.

```sh
docker pull gudaojia/markdock:0.1.0-rc.1
```

## Run with Compose

You need Docker Engine with Compose and an HTTPS reverse proxy. Prepare two distinct host directories, with read/write permissions for a non-root UID/GID. Keep service configuration outside the document root. You may mount an existing notes or project directory; documents are not copied into the image.

Save the following as `compose.yaml`:

```yaml
name: markdock

services:
  markdock:
    image: gudaojia/markdock:0.1.0-rc.1
    user: "${MARKDOCK_UID:-1000}:${MARKDOCK_GID:-1000}"
    init: true
    restart: unless-stopped
    stop_grace_period: 30s
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    environment:
      MARKDOCK_PUBLIC_ORIGIN: ${MARKDOCK_PUBLIC_ORIGIN:?Set the external HTTPS origin}
      MARKDOCK_WORKSPACE_ROOTS: '["/workspaces"]'
      MARKDOCK_DATA_DIR: /var/lib/markdock
      MARKDOCK_HOST: 0.0.0.0
      PORT: "3000"
    ports:
      - "127.0.0.1:${MARKDOCK_HTTP_PORT:-3000}:3000"
    volumes:
      - type: bind
        source: ${MARKDOCK_CONFIG_PATH:?Set an existing configuration directory}
        target: /var/lib/markdock
        bind:
          create_host_path: false
      - type: bind
        source: ${MARKDOCK_DOCUMENTS_PATH:?Set an existing documents directory}
        target: /workspaces
        bind:
          create_host_path: false

```

Save an adjacent `.env.docker`, replacing the domain, host paths, and UID/GID:

```dotenv
MARKDOCK_PUBLIC_ORIGIN=https://notes.example.com
MARKDOCK_CONFIG_PATH=/srv/markdock/config
MARKDOCK_DOCUMENTS_PATH=/srv/markdock/documents
MARKDOCK_UID=1000
MARKDOCK_GID=1000
MARKDOCK_HTTP_PORT=3000
```

Both host directories must already exist. The service will not create missing mounts or recursively change ownership. Do not put a password in the environment file.

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker pull
# First setup only: choose a 15–128 character password at the interactive prompt.
docker compose --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

### HTTPS and access

The service listens on container port `3000`; Compose exposes it only at host `127.0.0.1:3000` by default. Configure an HTTPS reverse proxy on that host to forward to this backend, preserving the external `Host` including any non-default port. The browser address must match `MARKDOCK_PUBLIC_ORIGIN` exactly. Then sign in at that HTTPS address.

HTTPS is required for container access, including LAN use. Do not expose the HTTP backend directly. If the proxy is another container, use a private Docker network and adapt the upstream address; `127.0.0.1` inside a proxy container refers to that proxy container. Disable proxy caching and buffering for workspace responses, and configure upload limits and timeouts. See the [deployment guide](https://github.com/GudaoJIA/MarkDock/blob/main/docs/EN/01-deployment.md#https-reverse-proxy) for details.

Authentication is single-user: no registration, shared accounts system, or collaboration. There is no default password. One service instance must own a given data directory.

### Open your files

In **Workspace management**, browse `/workspaces`, select an existing folder, and pin it. Click the pinned workspace to open it. Paths refer to the container; unmounted host directories are inaccessible. The allowed root is `/workspaces` in this example.

Create or open a Markdown document, switch between Visual and Source, and let automatic saving write changes back to the mounted directory. Workspace settings control where future image and attachment uploads are stored. If an external edit creates a conflict, keep the page open and resolve it before continuing.

## Persistence and permissions

| Container path | Persistent contents |
| --- | --- |
| `/var/lib/markdock` | Workspace pins and password hash |
| `/workspaces` | Markdown, images, attachments, `.markdock.json`, backups, Trash, and recovery records |

Browser preferences stay in that browser. Undo history and unsaved drafts live in page memory; they are not restored by mounting a directory. Automatic saving and Trash are not substitutes for independent backups.

Run as a non-root user with access to both mounts. Document storage must support directory synchronization and hard links. Validate NAS and network storage with disposable files first. Container health means the process responds, not that every directory is writable or the password has been initialized.

## Update safely

1. Finish saving and wait for uploads and file operations to complete.
2. Stop the service and other tools writing to those directories.
3. Back up both complete host directories, including hidden files.
4. Change the image tag in `compose.yaml` to the published version you intend to test.
5. Pull and recreate, keeping the same mounts:

```sh
docker compose --env-file .env.docker stop
# Back up both host directories before continuing.
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d --force-recreate
```

Sign in again and check documents and resources. Do not run old and new instances against the same writable data. Rollback may require the matching data backup; general data-format downgrades are not guaranteed.

## Documentation and source

- [GitHub](https://github.com/GudaoJIA/MarkDock)
- [English documentation](https://github.com/GudaoJIA/MarkDock/blob/main/docs/EN/README.md)
- [中文说明](https://github.com/GudaoJIA/MarkDock/blob/main/docs/ZH/README.md)
- [Backup and recovery](https://github.com/GudaoJIA/MarkDock/blob/main/docs/EN/05-backup-and-recovery.md)
- [Report an issue](https://github.com/GudaoJIA/MarkDock/issues) — omit credentials and private document content.

## License and credits

Markdock is based on [Plate Playground Template](https://github.com/udecode/plate-playground-template). The upstream [MIT license and copyright notice](https://github.com/GudaoJIA/MarkDock/blob/main/LICENSE) are retained. Third-party components retain their own licenses.
