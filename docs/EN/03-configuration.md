# 03 · Configuration

**English** | [简体中文](../ZH/03-configuration.md)

MarkDock has three kinds of settings, with different storage locations and scopes.

| Settings | Where to change them | Storage | Scope |
| --- | --- | --- | --- |
| Service | Startup environment variables | Deployment environment or environment files | All visitors to the same service |
| Workspace resources | Settings button beside a workspace | `.markdock.json` at the workspace root | That workspace |
| Interface, history, shortcuts | **Settings** in the sidebar | Current browser | Same-origin tabs, not other devices |

## Service configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKDOCK_DATA_DIR` | `~/.config/markdock/` | Pinned list and password hash; remote mode requires an explicit absolute path |
| `MARKDOCK_WORKSPACE_ROOTS` | Unset | Accessible absolute directories as a JSON array; must be nonempty in remote mode |
| `MARKDOCK_PUBLIC_ORIGIN` | Unset | The single external HTTPS origin, without a path, query, or trailing slash |
| `MARKDOCK_HOST` | `127.0.0.1` | Production listening address; non-loopback listening requires full remote configuration |
| `PORT` | `3000` | Service port |

Example allowed roots:

```sh
MARKDOCK_WORKSPACE_ROOTS='["/srv/blog","/srv/notes"]'
```

With roots unset, local mode accepts manually entered paths and does not automatically display the home directory. An explicit `[]` denies all workspace paths. Configured roots constrain browsing, pinning, opening, and file access; operating-system permissions still apply. Symbolic-link navigation is not supported.

In Docker, use container paths. Host paths are specified by Compose bind mounts; the application does not discover mounts automatically. Restart after environment changes. See [Deployment](01-deployment.md) for examples.

## Workspace resource settings

Click the workspace name at the top left to open **Workspace management**. The settings button beside it opens settings for the current workspace. You can also configure another workspace from the management window; it opens first through the usual save protection. The selected folder is the workspace root for the document tree, search, creation, and moves. Settings cannot expand deployment access permissions.

Choose a resource rule from three directory-example cards. They appear side by side in wide windows and stack in narrow ones. Focus with Tab, select with arrow keys, and confirm with Space. Editing image or attachment paths updates the example; switching cards preserves each card's input for this dialog session. Examples place a document in a subfolder: resources follow that document in the first two modes, while fixed resources use a location under the workspace root. Examples neither create files nor indicate that a directory exists.

| Choice | Layout | Suitable for |
| --- | --- | --- |
| Fixed directory | For example, `public/images/`, `public/files/` | Shared static resources, with matching project build configuration |
| Follow document · .assets folder | `article.md` → `article.assets/` | The default for ordinary Markdown workspaces |
| Follow document · same-name folder | `article.md` → `article/` | Projects requiring a same-name resource directory; verify build configuration yourself |

### Paths and references

Set image and attachment directories separately. Fixed paths are relative to the workspace root. Follow-document paths are relative to the document's dedicated resource directory and may be empty. Filenames receive a unique prefix; image names also have unsuitable path characters cleaned. Format and size limits still apply.

Fixed directories support document-relative or site-root references. For site-root references, specify the disk directory, such as `public`: `public/images/a.png` is then written as `/images/a.png`. This `/` means the website root, not the server filesystem root. Conflicting site-root mappings are rejected.

Click or keyboard-activate the ⓘ beside resource storage settings for details; Esc closes it and returns focus. **Save settings** checks paths, ownership, reference conflicts, and configuration versions. Failure preserves the form and explains the error. Canceling or closing does not save.

### Saving and existing resources

The workspace-root `.markdock.json` stores the format version, current upload rules, and compatibility rules. You can share it with the project; it contains no host absolute paths or secrets. Without it, the default is `article.assets/images/` and `article.assets/file/` next to the document. Service-level resource rules are not used. Invalid configuration or concurrent external changes produce errors rather than silent overwrites. Finish composition, uploads, and draft saving before saving settings.

Changes affect future uploads only. They do not move existing resources or rewrite documents. Old rules continue resolving existing resources; do not manually remove compatibility rules or alter existing site-root mappings. Fixed resources do not follow documents into Trash. Recognized dedicated directories follow in-app moves, renames, and deletion, and restore to their deletion-time location. Resource directories and folders containing fixed resources or a site root cannot be directly renamed. External file-manager moves are not tracked.

A same-name folder containing Markdown documents or ambiguous resource ownership is not automatically hidden or moved; uploads and affected file operations report a conflict. Existing attachments in `.assets/` remain compatible. Page bundles such as `article/index.md`, bulk migration through these settings, arbitrary naming expressions, and framework autodetection are not provided. Automatic blog-framework compatibility is not guaranteed.

## Interface preferences

Open **Settings** above Trash in the sidebar, then **Interface**. Choose English or Simplified Chinese, and Light, Dark, or System appearance. The default is English with system appearance; existing language choices are preserved. Changes apply immediately. Settings use left navigation in wide windows and top navigation in narrow windows.

Preferences are saved in this browser and synchronized across same-origin tabs, not other devices. If browser storage is blocked, settings remain in memory for this page and a notice appears. Document text, filenames, paths, and Markdown are not translated. Switching language does not reopen documents, create history, or trigger saving.

Word count, reading time, and writing goals can each be shown or hidden; all are visible by default in both modes. Hiding all three hides the bottom statistics area. Hiding a goal does not delete it. Source mode counts its current source text. Image and attachment rules belong only in [Workspace resource settings](#workspace-resource-settings).

**Show resource folders** is off by default. Enabling it displays recognized resource directories across all workspaces in this browser without changing project configuration. See [Browsing resources](04-user-guide.md#browsing-resources).

System reduced-motion preferences disable the corresponding interface transitions.

## Editing history and shortcuts

Under **Editing**, choose a preset or enter whole-number limits, then click **Apply**. Restoring defaults changes the form first and still requires Apply. Settings synchronize across same-origin tabs, but each page manages its own history.

| Limit | Range | Default |
| --- | --- | --- |
| Batches per document | 20–1,000 | 200 |
| History budget per document | 4–64 MiB | 16 MiB |
| Total history budget per page | 16–256 MiB | 64 MiB |

**Save memory**, **Balanced**, and **More history** use 100/8/32, 200/16/64, and 500/32/128 respectively. The document budget cannot exceed the page budget. Undo and redo both count; the page total includes resident documents from other workspaces. The oldest undo and farthest redo records are discarded when limits are exceeded, after composition completes. Increasing limits does not restore discarded records. A single edit exceeding the budget keeps the text and saving intact, but undo cannot cross that operation; a non-modal notice explains why.

Settings show document batch counts, estimated history usage, and the page total. Estimates count UTF-16 characters in before/after text at two bytes each, not actual browser memory. They exclude decoded images, editor nodes, and other overhead. Refreshing, reloading a disk version, or deleting a document releases the associated history; mode switching and automatic saving do not.

**Shortcuts** groups inline, paragraph, and insertion commands. Click a binding to record a combination; Esc cancels recording without closing Settings or discarding other unapplied changes. Press Esc again outside recording to close Settings. The unlink icon clears a binding; the reset icon restores its default. Hover for labels. **Restore all defaults** and **Apply** remain text buttons. Changes take effect after Apply. Mac and Windows/Linux bindings are stored separately.

| Action | Default shortcut |
| --- | --- |
| Bold / italic / link | Primary + B / I / K |
| Inline code / strikethrough | Primary + Shift + backquote / X |
| Paragraph / H1–H6 | Extended + 0 / 1–6 |
| Bulleted / numbered / task list | Extended + U / O / L |
| Quote / code block | Extended + single quote / K |
| Insert table / divider / image / attachment | Extended + T / H / I / A |

Primary means Command on Mac or Ctrl elsewhere. Extended means Command + Control on Mac or Ctrl + Alt elsewhere. Recording uses physical key codes and rejects duplicate, unmodified, and registered reserved combinations. The operating system can still intercept custom combinations before they reach the page.

Formatting shortcuts run only in the Visual editor and respect raw-block, code, table, and selection protections. Menus and toolbar hints show current bindings. Source retains its own save, find, undo, and text-editing behavior. List Tab/Shift + Tab and table navigation cannot be rebound. Formatting commands do not run during composition or AltGraph input.
