# 05 · Backup and recovery

**English** | [简体中文](../ZH/05-backup-and-recovery.md)

Markdock operates directly on disk files. Automatic saving, Trash, and operation recovery serve different purposes and do not replace independent backups.

## What to back up

| Data | Location | Back up? |
| --- | --- | --- |
| Pinned workspaces and password hash | `MARKDOCK_DATA_DIR` | Yes; protect access to credentials |
| Markdown, images, attachments | Workspace directories | Yes |
| Resource rules | Workspace `.markdock.json` | Yes |
| Original-text backups | `.noteai-backups/` | Include with the workspace |
| Trash | `.noteai-trash/` | Include with the workspace |
| File-operation recovery records | `.noteai-operations/` | Include; these are not disposable caches |
| Interface preferences and writing goals | Current browser | Not included in service backups |
| Undo history and unsaved sessions | Page memory | Not restored by service backups or restarts |

## Make a consistent backup

1. Confirm all documents have saved and wait for uploads and file operations to finish.
2. Stop Markdock and other editors or scripts writing to the same directories.
3. Copy the complete service configuration and workspace directories, including hidden files and subdirectories.
4. Store copies independently and check file counts, permissions, and readability.

Copying only `.md` files misses resources, configuration, and recovery records. Credential backups contain sensitive data.

## Saving failures and conflicts

Keep the page and draft open when saving fails. Check disk space, permissions, and mount status. **Do not refresh first.**

When an external edit causes a conflict, choose which version to retain:

- Reload: adopt the disk version and rebuild that document's session.
- Save a copy: save the local text as a sibling file, then compare manually.

A disk-sync error reporting an unconfirmed outcome means the file may already have changed. Check the disk and backups before retrying; an error does not mean nothing was written.

`.noteai-backups/` stores original text before its first write-back, not a complete history of every edit. Before manual recovery, save a separate copy of the current file and verify the backup you need.

## Restore from Trash

Open **Trash** in the sidebar, select a document, and restore it. The document and accompanying dedicated resources return to their original paths. Missing parent directories can be recreated; occupied paths stop restoration instead of being overwritten or merged.

Other documents referencing the deleted document's dedicated resources may have broken links while those resources are in Trash. Shared resources are not deleted with the document.

Permanently deleting or emptying Trash removes only selected entries and their accompanying resources, not independent historical backups. File deletion is not part of document undo history.

## Interrupted file operations

Reopening the original workspace checks unfinished operations and recovers them when conditions permit. If external changes, damaged records, or unfinished operations in another workspace are reported:

1. Stop writing to the affected directories.
2. Back up the complete state, including `.noteai-operations/`.
3. Return to the original workspace indicated by the error. If the situation is unclear, preserve it for investigation.

Do not delete recovery records, change allowed roots, or overwrite files to bypass errors. Multiple files are not one atomic filesystem transaction. Recovery does not guarantee that all operations survive sudden power loss.

## Resetting a password

Stop the service first. For source deployment, use the same service user and configuration directory:

```sh
bun run auth:password --reset
```

For Docker:

```sh
docker compose -f compose.image.yaml --env-file .env.docker stop
docker compose -f compose.image.yaml --env-file .env.docker run --rm --no-deps markdock node admin/auth-password.mjs --reset
docker compose -f compose.image.yaml --env-file .env.docker up -d
```

Resetting does not change documents or pinned workspaces. Sign in again after restarting. Damaged credential files are not silently overwritten; see [Sign-in failures](06-troubleshooting.md#sign-in-failures-or-expired-sessions).

<details>
<summary>Setting a password without an interactive terminal</summary>

The password command accepts `--password-file /absolute/path`. It must be a regular file with mode 0600, not a symbolic link. Docker requires an additional read-only mount and a container path. Do not put plaintext passwords in command arguments, environment variables, or images. Securely retain or remove the input file after use.

</details>

## Upgrades and rollback

After a stopped-service backup, choose the source revision or published image version you intend to run.

Source deployment:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run start
```

Docker image deployment: update the version tag in `compose.image.yaml` to the chosen published version, then run:

```sh
docker compose -f compose.image.yaml --env-file .env.docker pull
docker compose -f compose.image.yaml --env-file .env.docker up -d --force-recreate
```

Sign in and check workspaces, documents, and resources. Bind mounts remain on the host; rebuilding a container is not a backup.

For rollback, check program and data-format compatibility together and restore the matching stopped-service snapshot if needed. There is no general data-format downgrade guarantee. Never run old and new services against the same writable data directory simultaneously.

## Organizing legacy resources

Existing resource rules continue resolving old links; manual organization is usually unnecessary. If explicitly needed, back up first and stop concurrent writes, then run from a source installation:

```sh
bun scripts/migrate-resources.ts /absolute/workspace/path
```

This previews affected documents. Review the output before applying:

```sh
bun scripts/migrate-resources.ts --apply /absolute/workspace/path
```

The tool retains old resources and original-text backups and reports missing files, name collisions, or unsupported content. It does not scan historical workspace lists. It requires source code and Bun and is not included in the minimal runtime image.
