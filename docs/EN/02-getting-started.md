# 02 · Getting started

**English** | [简体中文](../ZH/02-getting-started.md)

This guide starts with a running Markdock service. If it is not installed yet, read [Deployment](01-deployment.md) first.

## 1. Sign in

Open the service address and enter the password set during deployment. There is no default password or registration screen. If you forget it, the service administrator can [reset the password](05-backup-and-recovery.md#resetting-a-password).

## 2. Pin a folder

1. Click **Workspace management** at the top left.
2. Browse folders under **Data locations**, or use the path-edit button at the bottom to enter a path.
3. Select a folder and click **Pin to workspaces**, or drag a folder from this window into the pinned workspace area on the left.
4. Click a pinned workspace to open its document list.

**The folder you select is the workspace.** Pinning creates an entry; it does not move, copy, or create a folder. Dragging a folder from an external Finder window is not accepted as a server directory reference.

You are browsing the service device. Docker users see mounted container paths such as `/workspaces`, not the original host path. If no data locations appear, check [Service configuration](03-configuration.md#service-configuration).

## 3. Start editing

Open a `.md` file from the document tree or use the new-document button. The rightmost toolbar button switches between Visual and Source. Edits save automatically; you can also press Command/Ctrl + S.

Syntax that cannot be safely represented visually appears as editable raw text. HTML and template code are not executed. See the [User guide](04-user-guide.md) for details.

## 4. Adjust settings

- The settings button next to a workspace name controls that workspace's image and attachment storage.
- **Settings** at the bottom of the sidebar controls this browser's language, appearance, history budget, and shortcuts.
- To see resources in the document tree, enable **Settings → Interface → Show resource folders**.

See [Configuration](03-configuration.md) for where each type of setting is stored.

## Opening and leaving a workspace

Large directories show the current stage, actual entry count, and elapsed time while opening. **Cancel opening** is available during read-only scans. Saving and recovery writes must finish safely. A temporarily unchanged count does not mean the operation has failed.

Before leaving, confirm saving has finished. If saving fails or a conflict appears, keep the page open and follow the message. Refreshing can lose unsaved input.
