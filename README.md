<p align="center"><img src="public/brand/markdock-badge.svg" width="48" height="48" alt="Markdock logo"></p>
<h1 align="center">Markdock</h1>
<p align="center"><strong>Where Markdown docks.</strong><br>A self-hosted Markdown workspace. Your files stay yours.</p>
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

![Markdock Visual editor with an English reading journal](docs/assets/screenshots/visual-editor.png)

Write in a focused, Typora-like editor, then switch to Markdown source when you need it. Markdock runs in your browser and works directly with folders on the device hosting the service.

## Files first. Room to think.

- **Your storage, your files.** Markdown, images, and attachments live in real directories you control.
- **One folder, many tools.** Keep using your editor, Git, scripts, and agents with the same files. External changes are checked before saving; avoid simultaneous writes.
- **A quieter workspace.** Read, write, search, and organize without importing your notes into a separate content database.

## Start with Docker

The published candidate is **`gudaojia/markdock:0.1.0-rc.1`**, for **AMD64 and ARM64**. No `latest` tag is published. This candidate is available for testing; target-server regression is still in progress.

You need Docker Compose, two existing writable host directories, a non-root UID/GID, and an HTTPS reverse proxy. Container deployments require HTTPS even on a LAN. For a local source setup, see [Deployment](docs/EN/01-deployment.md#local-source-deployment).

```sh
git clone https://github.com/GudaoJIA/MarkDock.git
cd MarkDock
cp .env.docker.example .env.docker
```

Edit `.env.docker` before continuing:

```dotenv
MARKDOCK_PUBLIC_ORIGIN=https://notes.example.com
MARKDOCK_CONFIG_PATH=/srv/markdock/config
MARKDOCK_DOCUMENTS_PATH=/srv/markdock/documents
MARKDOCK_UID=1000
MARKDOCK_GID=1000
MARKDOCK_HTTP_PORT=3000
```

Replace the domain and paths. Both directories must already exist and be writable by the selected non-root user. The configuration directory must be outside the documents directory. No password belongs in this file.

```sh
docker compose -f compose.image.yaml --env-file .env.docker pull
docker compose -f compose.image.yaml --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs
docker compose -f compose.image.yaml --env-file .env.docker up -d
```

Set a password at the interactive prompt on first setup. Configure your HTTPS proxy to forward to `127.0.0.1:3000`, preserving the external `Host`, then sign in at your configured HTTPS address. The HTTP backend is intentionally bound to host loopback. See the [complete deployment guide](docs/EN/01-deployment.md#https-reverse-proxy) for proxy, permission, and startup checks.

| Host data | Container path | Keep across upgrades |
| --- | --- | --- |
| Service configuration | `/var/lib/markdock` | Pins and password hash |
| Your document directory | `/workspaces` | Markdown, resources, workspace rules, backups, Trash, recovery records |

Open **Workspace management**, browse `/workspaces`, and pin an existing folder. Pinning creates an entry; it does not move or copy your files.

## Write, organize, return

| Capability | What it does |
| --- | --- |
| Visual + Source | Two editing modes with a shared draft, automatic saving, and undo history |
| Markdown tools | Headings, lists, tasks, links, tables, code, images, and attachments |
| Navigation | Document search, find and replace, outline, and collapsible sections |
| File management | Create, rename, move documents, and restore Markdown files from Trash |
| Resource rules | Store resources beside a document or in fixed workspace directories |
| Preferences | English / Chinese, light / dark / system theme, history budgets, custom shortcuts |

![Knowledge note with a table, questions and document outline](docs/assets/screenshots/knowledge-note.png)

<details>
<summary>See the same article in Source</summary>

![The reading journal in Source mode](docs/assets/screenshots/source-editor.png)

Source lets you edit the complete document, including YAML frontmatter. Unsupported visual syntax falls back to editable raw text; Markdown is not promised to round-trip identically after every edit.

</details>

## Make it your own

**Personal knowledge base — A home for your knowledge.** Maintain reading notes, learning records, and project indexes in ordinary Markdown files. Browse folders, edit, and search filenames and text. There is no knowledge graph or semantic search.

**Blog writing — Write where your blog lives.** Edit posts and resources in your existing content directory, then build and publish through your usual tools. YAML frontmatter is retained and editable in Source; there is no metadata form or one-click publishing.

**Agent files — Keep your agent’s files readable.** Review prompts, instructions, memory notes, and skill documents alongside your other writing. Names such as `AGENTS.md`, `MEMORY.md`, and `SKILL.md` are examples, not universal conventions. Markdock edits files; it does not run agents or install skills.

![Example agent memory notes in Markdock](docs/assets/screenshots/agent-notes.png)

## Where your files live

A pinned folder is the workspace boundary. Resource rules belong to that workspace; language, appearance, and editing preferences belong to the browser.

```text
workspace/
├── essays/
│   ├── reading.md
│   └── reading.assets/       # default: resources follow the document
│       ├── images/
│       └── file/
└── .markdock.json            # created when workspace settings are saved
```

Resources can also use a same-name folder or fixed directories relative to the workspace root. Changing rules affects future uploads, not existing files. See [Configuration](docs/EN/03-configuration.md).

Paths belong to the **service device**, not the browser device. Docker can access only mounted directories, further restricted by configured allowed roots. Markdock is a single-user service with password authentication, not a collaboration or cloud-sync system. It does not execute HTML, MDX, or agent instructions.

## Current status

The first dual-architecture Docker candidate is published. Native target-machine regression and cross-version upgrade checks remain part of release validation. Screenshots show the current branding changes; the already-published `0.1.0-rc.1` still uses the previous logo and capitalization.

Near-term work focuses on deployment feedback, editing polish, and clearer documentation. No release dates are promised. Automatic saving and Trash do not replace backups; unsaved drafts and undo history live in page memory. Wide-table scrolling and a divider-undo whitespace issue remain known limitations.

## Guides and contributions

Start with [Deployment](docs/EN/01-deployment.md), [Getting started](docs/EN/02-getting-started.md), or the [full user guide](docs/EN/04-user-guide.md). [Backup and recovery](docs/EN/05-backup-and-recovery.md) covers updates, external conflicts, and recovery records.

For development, use Node.js 22 and Bun 1.3.3. Follow source setup, then run `bun run dev` for local preview. Before proposing a change, run `bun run build`, `bun run typecheck`, `bun run lint`, and `bun run test:workspace`. Use disposable workspaces for testing.

[Report a problem](https://github.com/GudaoJIA/MarkDock/issues) with the version, deployment method, and reproduction steps. Remove private document text, credentials, and paths from reports. Keep English and Chinese user documentation in sync when changing behavior.

## Name, credits, and license

**Markdown** is the format; **Mark** is the act of recording; **Doc** is the document; **Dock** is where those ideas find a place.

Built on [Plate Playground Template](https://github.com/udecode/plate-playground-template), with Plate, Slate, React, Next.js, shadcn/ui, and Lucide. The upstream [MIT license and copyright notice](LICENSE) are retained; dependencies retain their own licenses. The logo was supplied by the project maintainer.
