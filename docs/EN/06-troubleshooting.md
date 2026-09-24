# 06 · Troubleshooting

**English** | [简体中文](../ZH/06-troubleshooting.md)

Preserve unsaved content before investigating. Back up files, configuration, and recovery records when they are involved. Do not reset the service by deleting user data.

## Startup failures

1. For source deployment, check Node.js 22 and Bun 1.3.3, frozen installation, and the production build.
2. Read the terminal error and check whether the port is already in use.
3. Check [Environment configuration](03-configuration.md#service-configuration), allowed roots, and service-user permissions.

For download failures, check connectivity and certificate trust rather than disabling TLS validation. Remote access requires an HTTPS origin, nonempty allowed roots, and an absolute service-data directory.

## Sign-in failures or expired sessions

- No password: initialize it on the service device using [Deployment](01-deployment.md). There is no default password.
- Forgotten password: stop the service and [reset it](05-backup-and-recovery.md#resetting-a-password).
- Too many incorrect attempts: after five consecutive failures, wait 60 seconds.
- Restarted service or expired session: keep the page open and use **Sign in again**. Do not refresh unsaved drafts.

The management command and service must use the same user and `MARKDOCK_DATA_DIR`. `.markdock-auth.json` requires mode 0600. Preserve a copy of a damaged credential file and prefer restoring a complete backup; do not disable authentication to work around it.

## Inaccessible directories

Paths belong to **the device running the service**. Docker uses container paths such as `/workspaces`, not original host paths.

Check that the directory exists, lies within allowed roots, is accessible to the service user, and has no symbolic-link path components. Retry or unpin inaccessible entries; there is no need to delete real directories.

If **Data locations** is empty, check `MARKDOCK_WORKSPACE_ROOTS`. Mounts are not automatically discovered. Restart after changing environment variables.

## Slow opening or scan-limit errors

The progress panel shows the stage and real counts. Counts can remain unchanged while waiting for file operations or performing recovery. Cancellable stages provide **Cancel opening**.

| Limit | Purpose |
| --- | --- |
| Recovery scan: 100,000 entries, 128 levels | Find unfinished file operations |
| Document tree: 5,000 entries, 30 levels | Load the browsable document scope |
| Editing history budget | Limit browser undo records, independently of scans |

Opening scans skip hidden entries and node_modules, but other unexcluded entries can still count. Select a more specific document directory when limits are exceeded. Do not delete `.noteai-operations/` to bypass recovery checks.

A disconnected progress stream does not prove that recovery finished or was undone. Preserve the state and handle the error; do not repeatedly resend opening requests automatically.

## Saving failures and external conflicts

Keep the page open and check disk space, mount permissions, directory synchronization, and hard-link support. A sync error may occur after the file changed; check the disk before retrying.

External editors, Git, or scripts can cause conflicts. Avoid simultaneous writes and follow [Conflict handling](05-backup-and-recovery.md#saving-failures-and-conflicts) to reload or save a copy.

## Unavailable images or attachments

Check format, size, and [Workspace resource settings](03-configuration.md#workspace-resource-settings). Images support PNG, JPEG, GIF, WebP, and AVIF, up to 20 MiB each. Attachment uploads are limited to 100 MiB each.

For missing resources, compare actual files with Markdown references, especially relative paths after external moves. Current and valid old rules determine resource ownership; resource endpoints do not expose arbitrary workspace files.

Refresh stale resource pagination. Failed image previews can be retried or downloaded. SVG and HTML are not executed as embedded images. Undoing image insertion or canceling uploads does not guarantee removal of already saved resource files.

## Unexpected raw blocks or formatting controls

Syntax that cannot be safely converted appears as editable raw text, not a read-only document or parsing failure. Continue editing or switch to Source; returning to Visual reanalyzes it.

Inline formatting requires a nonempty text selection. Code, tables, raw blocks, or mixed selections may restrict commands. Composition, uploads, conflicts, and file operations can temporarily disable controls.

## Failed moves, Trash actions, or recovery

Occupied targets, ambiguous resource ownership, external changes, and missing resources can block operations. The application does not overwrite or merge them. Read the specific error and preserve affected files and recovery records.

Trash restores to original paths. Failed permanent deletion can be retried; do not manually delete metadata to hide an error. See [Backup and recovery](05-backup-and-recovery.md).

## Remote access or container problems

Check that the browser address, `MARKDOCK_PUBLIC_ORIGIN`, and proxy Host match, including ports. `X-Forwarded-Host` alone is insufficient. Keep the backend on a private network or loopback address; do not disable authentication or relax origin checks.

Inspect container logs:

```sh
docker compose --env-file .env.docker logs --tail=50 markdock
```

Check existing host mounts, UID/GID, NAS ACLs, free space, and filesystem capabilities. Do not recursively change personal-document ownership to mask permissions problems.

If opening progress stalls, also check proxy timeouts and response buffering. A successful health check only means the process responds. See [Proxy requirements](01-deployment.md#https-reverse-proxy).

## Reporting a problem

Include the deployment method, system or container environment, reproduction steps, and sanitized error messages. Do not provide passwords, cookies, real credential files, or private documents. State whether unsaved content exists so investigation does not destroy it.
