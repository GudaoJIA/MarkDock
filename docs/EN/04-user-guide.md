# 04 · User guide

**English** | [简体中文](../ZH/04-user-guide.md)

Daily work starts in the document tree and editor. To add your first workspace, see [Getting started](02-getting-started.md). For resources and preferences, see [Configuration](03-configuration.md).

## Workspaces and documents

Click the name at the top left to open workspace management, then click a pinned workspace to switch. Switching saves first and may be blocked by conflicts, composition, or unfinished uploads.

Unpinning does not delete files. Unpinning the current workspace saves drafts and clears the visible document area; failure keeps the current workspace open. Unpinning from another browser does not forcibly close the document being edited on this page.

The document tree supports creating documents and folders, renaming both, and moving documents within a workspace. Folder deletion, folder dragging, and cross-workspace moves are not supported.

## Editing modes

| Mode | Use it for |
| --- | --- |
| Visual | Edit through the toolbar, block menu, and Markdown input; insert images and tables |
| Source | Edit complete Markdown, including metadata, template text, and blank lines |

The rightmost toolbar code icon opens Source; the editing icon returns to Visual. Both modes share a draft, automatic saving, and undo history, while remembering separate cursor and scroll positions. Switching itself does not save or create an undo record.

Source provides line numbers, highlighting, wrapping, and search. Paste is plain text. There is no separate reading mode, and HTML, MDX, or template code is not executed.

## Formatting and the block menu

Toolbar groups appear in this order:

| Group | Actions |
| --- | --- |
| History | Undo, redo |
| Inline | Bold, italic, strikethrough, inline code, link |
| Lists | Bulleted, numbered, task list |
| Blocks | Quote, code block, divider, table |
| Resources and search | Image, attachment, find and replace |

Scroll the toolbar horizontally in narrow windows; the outline and mode buttons remain on the right. Inline formatting requires selected text; an empty cursor does not preset a style for future typing.

Hover a block or focus its left controls to reveal the six-dot handle. Headings also show H1–H6. Click the handle to convert paragraphs, headings, lists, and quotes. The menu targets the clicked block, not a selection elsewhere.

- List conversion affects the current item; nested content is retained with adjusted indentation.
- Quote conversion affects the whole quote and preserves paragraph boundaries.
- Tables, code, images, dividers, and raw blocks do not offer format conversion.
- **Delete block** at the bottom removes the clicked block, including whole tables or images, and can be undone. Deleting a heading preserves its section body.

Within lists, Tab increases indentation and Shift + Tab decreases it; decreasing the outermost level converts it to a paragraph. Batch indentation requires all selected items to be list items.

## Markdown input

Visual mode supports line-start Markdown markers such as `#` for headings, `-` for lists, and `>` for quotes. In an otherwise empty ordinary paragraph, type `---` and press Space to create a divider.

Type `/` to open the command menu and filter blocks by name. It does not activate in code, tables, raw blocks, or during composition. Source mode always preserves literal input.

Unsupported syntax appears as editable raw blocks. If safe boundaries cannot be identified, the whole document falls back to raw text. Opening or switching does not rewrite the file; unchanged fragments stay intact, while edited structures are serialized as Markdown.

## Links and tables

Select text and click the link button, or edit an existing link. HTTP(S) sites do not need to be online. Relative paths, anchors, and email links are supported; bare domains receive `https://`. Unsafe protocols are rejected.

Click an ordinary link for editing actions. Command-click on Mac or Ctrl-click on Windows/Linux opens a new tab. **Remove link** preserves its text and other formatting. Attachment links download on click.

The table button offers a grid and custom dimensions. The first row is the header; merged cells are not supported. Cells contain a single paragraph with inline formatting. Enter or Shift + Enter moves between cells; pasted newlines and tabs become spaces.

## Find and replace

**Find documents** in the sidebar searches filenames and text, including unsaved sessions. Command/Ctrl + F opens unified search in Visual mode and the source editor's search in Source mode.

Use toolbar **Find and replace** or Command/Ctrl + Shift + H for document replacement.

- Visual supports case-insensitive literal matching, not regex, cross-paragraph, or cross-file replacement.
- Visual **Replace all** shows a count and asks for confirmation. The operation can be undone once.
- Source also offers case sensitivity, whole-word, and regex options. Replace all runs directly and can be undone.

## Images and attachments

| Type | How to add it | Limits |
| --- | --- | --- |
| Image | Toolbar, drag and drop, or paste | PNG, JPEG, GIF, WebP, AVIF; 20 MiB each |
| Attachment | Attachment toolbar button or `/` menu | 100 MiB each |

Local images and images embedded as base64 in pasted HTML are uploaded as files; Markdown receives resource addresses. Base64 inside ordinary text is not automatically converted. Storage follows [Workspace resource settings](03-configuration.md#workspace-resource-settings).

Failed uploads do not insert invalid links and can be retried. Canceling may leave resources already saved on disk. Deleting an image block or undoing an insertion removes the document reference, not the resource file.

Click an image in the document to open the viewer. It supports fit-to-window, original size, zoom, and pan. Viewing scale does not change Markdown.

## Browsing resources

1. Enable **Settings → Interface → Show resource folders**.
2. Expand a resource folder in the document tree.
3. Click an image to preview it or another file to view its information.

Folders sort before files. Pages contain up to 100 entries, with **Load more** for subsequent pages. Collapse and reopen to refresh; refresh the list if pagination becomes stale.

File information offers download and copy-path actions. The copied path is **relative to the workspace**, not a Markdown reference relative to the current document. Failed image previews can be retried or downloaded.

Resource files do not enter document editing sessions or affect saving and undo. Resource deletion, renaming, moving, creation, and dragging into the editor are not offered. PDF, Office, HTML, SVG, scripts, and Markdown attachments are not previewed inline.

## Outline and writing tools

The Visual outline on the right jumps to headings. Arrows beside headings collapse sections. Collapsing affects display only; search, statistics, and saving include the full text. Source has no outline.

The six-dot handle also drags content blocks. List items include nested items; headings include their section. Raw blocks cannot be dragged. Esc cancels, and moves can be undone. This differs from moving disk files in the sidebar.

The bottom bar shows word count, reading time, and writing goals; each can be hidden in Settings. Goals are saved in the browser, not Markdown. Counts treat Chinese characters individually and English/numeric words as units; reading time is estimated at 400 units per minute.

## Moving and renaming

Choose **Move to…** from a document menu, or drag it to an ordinary directory in the same workspace. Existing targets are rejected rather than overwritten or merged.

The application handles dedicated directories according to resource ownership and updates supported local Markdown links. Fixed resources do not move with documents. Missing resources, unsupported references, or external changes may block the operation.

**External file-manager moves are not tracked by MarkDock.** Back up important directories first and avoid concurrent writes from the application and external tools. File moves are not part of document undo history.

## Deleting files and Trash

Choose **Move to Trash** from a document menu. Restore from the success message or sidebar **Trash**. Only Markdown files can be deleted this way, not workspaces or folders.

Dedicated resources follow documents into Trash; shared resources stay in place. Restore uses the original path and stops if a document or resource directory occupies it. File deletion is not part of document undo history.

Permanent deletion and emptying Trash require confirmation; there is no automatic expiry. Independent historical backups are not removed. See [Backup and recovery](05-backup-and-recovery.md).

## Saving, signing out, and limits

Edits save automatically and can also be saved manually. External changes pause saving and show a conflict. Keep the page open and choose to reload or save a copy; see [Saving failures and conflicts](05-backup-and-recovery.md#saving-failures-and-conflicts).

Sidebar **Sign out** saves resident documents first. Failures, composition, or uploads may prevent signing out. If a session expires, use **Sign in again** rather than refreshing unsaved input.

Documents must be UTF-8 Markdown, at most 5 MiB each. Hidden entries, node_modules, symbolic links, and internal data directories are excluded from the ordinary document tree. Scan limits are independent of history budgets; see [Troubleshooting](06-troubleshooting.md#slow-opening-or-scan-limit-errors).
