# MarkDock

**English** | [简体中文](README.zh-CN.md)

**Edit real Markdown files in your browser.**

MarkDock is a single-user Markdown workspace. Pin an existing folder to edit documents and manage images and attachments. Files stay on the device running the service, with no import or export required.

## What you can do

- Switch between Visual and Source editing with shared undo history and automatic saving.
- Search, create, move, and rename documents, and recover deleted files from Trash.
- Configure image and attachment storage per workspace and browse resource files on demand.
- Use the document outline, find and replace, writing goals, and custom shortcuts.
- Choose an English or Chinese interface and a light, dark, or system appearance.

## Get started

| Your goal | Start here |
| --- | --- |
| Install on your computer or server | [Deployment](docs/EN/01-deployment.md) |
| Open your first workspace | [Getting started](docs/EN/02-getting-started.md) |
| Configure folders, resources, and preferences | [Configuration](docs/EN/03-configuration.md) |
| Learn editing and file management | [User guide](docs/EN/04-user-guide.md) |
| Back up, upgrade, or recover data | [Backup and recovery](docs/EN/05-backup-and-recovery.md) |
| Resolve a problem | [Troubleshooting](docs/EN/06-troubleshooting.md) |

See the full [documentation index](docs/EN/README.md).

## Deployment and limitations

Run from source or build with the included Dockerfile and Compose configuration. **No official Docker Hub image has been published yet.** Source deployment requires Node.js 22 and Bun 1.3.3; see the deployment guide for commands.

The service listens on the local loopback address by default. Server access uses a single-user password and an explicitly configured HTTPS reverse proxy. There is no account registration, collaboration, cloud sync, or built-in AI. Workspace paths belong to the service device, not the browser device.

Markdown, resources, and workspace configuration are stored directly on disk. Automatic saving and Trash do not replace independent backups. Closing a page discards in-memory undo history, and recovery of unsaved input is not guaranteed.

## Credits and license

Built on [Plate Playground Template](https://github.com/udecode/plate-playground-template), using open-source components including Plate, Slate, React, Next.js, shadcn/ui, and Lucide.

The upstream [MIT license and copyright notice](LICENSE) are retained. Third-party dependencies remain subject to their own licenses.
