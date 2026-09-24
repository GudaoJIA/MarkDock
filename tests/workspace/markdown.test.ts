import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownPlugin } from '@platejs/markdown';
import { createSlateEditor } from 'platejs';
import { BaseBasicBlocksKit } from '../../src/components/plate/plugins/basic-blocks-base-kit';
import remarkGfm from 'remark-gfm';
import { imageSource, joinMarkdown, markdownIssue, splitMarkdown } from '../../src/features/workspace/shared/markdown';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import { markdownMeaning } from '../../src/features/workspace/shared/markdown';

test('frontmatter, BOM and CRLF preserved as raw envelope', () => {
  const prefix = '\uFEFF---\r\ntitle: 测试\r\ntags: [a, b]\r\n---\r\n';
  const envelope = splitMarkdown(`${prefix}\r\n# 标题\r\n`);
  assert.equal(envelope.prefix, prefix);
  assert.equal(joinMarkdown(envelope, '\n# 新标题\n'), `${prefix}\r\n# 新标题\r\n`);
  assert.ok(splitMarkdown('---\ntitle: no end').reason);
  assert.equal(splitMarkdown('').body, '');
});

test('relative image preview URL keeps document URLs independent of the file API', () => {
  const source = imageSource('id', '随笔/文章.md', '../图片/hello%20world.png');
  const url = new URL(source, 'http://localhost');
  assert.equal(url.searchParams.get('path'), '图片/hello world.png');
  assert.equal(imageSource('id', '文章.md', '../escape.png'), '');
  assert.equal(imageSource('id', '文章.md', 'file:///etc/passwd'), '');
  assert.equal(imageSource('id', '文章.md', 'https://example.com/a.png'), 'https://example.com/a.png');
});

test('unsupported syntax is detected and preserved in editable raw blocks', () => {
  const editor = createSlateEditor({ plugins: [...BaseBasicBlocksKit, MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } })] });
  assert.equal(markdownIssue(editor, '# 标题\n\n- [ ] 中文\n\n| a | b |\n| - | - |\n| c | d |'), undefined);
  for (const source of ['<Custom>text</Custom>', 'Text[^1]\n\n[^1]: note', '```js title=file\nhello\n```', '[bad](javascript:alert)']) {
    assert.ok(markdownIssue(editor, source), source);
    const doc = createDocumentEditor({path:'raw.md',content:source,version:'1'}, {id:'id',root:'/test',name:'test'});
    assert.equal(doc.readOnlyReason, undefined);
    assert.equal(doc.serialize(), source);
    assert.equal(doc.editor.children[0].type, 'workspace_raw');
  }
});

test('real editor round-trips GFM, links and images without hidden characters or semantic loss', () => {
  const samples = [
    '# 中文标题\n\n正文 **粗体**、*斜体*、~~删除~~ 与 `code`。\n',
    '- 项目\n  - 子项目\n\n1. 第一\n2. 第二\n\n- [ ] 未完成\n- [x] 完成\n',
    '> 引用\n>\n> 第二段\n',
    '| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n```js\nconst x = 1;\n```\n',
    '[链接](https://example.com)\n\n![图片](../图片/a.png)\n',
    '[链接][id]\n\n[id]: https://example.com\n',
    '',
  ];
  for (const content of samples) {
    const parsed = createDocumentEditor({ path: '文章.md', content, version: '1' }, { id: 'id', root: '/test', name: 'test' });
    assert.equal(parsed.readOnlyReason, undefined, content);
    assert.equal(markdownMeaning(parsed.editor, parsed.serialize()), markdownMeaning(parsed.editor, content));
    assert.equal(parsed.serialize().includes('\u200b'), false);
  }
  const unusual = '`code `\n';
  const readonly = createDocumentEditor({ path: '文章.md', content: unusual, version: '1' }, { id: 'id', root: '/test', name: 'test' });
  assert.equal(readonly.editor.children[0].type, 'workspace_raw');
  assert.equal(readonly.serialize(), unusual);
  const unusedDefinition = '正文\n\n[future]: https://example.com/important\n';
  const unused = createDocumentEditor({ path: '文章.md', content: unusedDefinition, version: '1' }, { id: 'id', root: '/test', name: 'test' });
  assert.equal(unused.editor.children[1].type, 'workspace_raw');
  assert.equal(unused.serialize(), unusedDefinition);
});

test('pasted rich-text marks save as portable Markdown while retaining supported formatting', () => {
  const workspace = { id: 'id', root: '/test', name: 'test' };
  const doc = createDocumentEditor({ path: 'paste.md', content: '', version: '1' }, workspace);
  doc.editor.tf.setValue([{ type: 'p', children: [
    { text: '外部文字', bold: true, underline: true, color: 'red', fontSize: '18px' },
    { text: ' 与 ' },
    { type: 'a', url: 'https://example.com', children: [{ text: '链接', backgroundColor: 'yellow', italic: true }] },
  ] }]);
  const before = JSON.stringify(doc.editor.children);
  const saved = doc.serialize();
  assert.equal(saved, '**外部文字** 与 [*链接*](https://example.com)\n');
  assert.equal(JSON.stringify(doc.editor.children), before);
  const reopened = createDocumentEditor({ path: 'paste.md', content: saved, version: '2' }, workspace);
  assert.equal(reopened.readOnlyReason, undefined);
  assert.equal(reopened.serialize(), saved);
});

test('copied demo annotations and keyboard labels retain their text without MDX', () => {
  const workspace = { id: 'id', root: '/test', name: 'test' };
  const doc = createDocumentEditor({ path: 'paste.md', content: '', version: '1' }, workspace);
  doc.editor.tf.setValue([{ type: 'p', children: [
    { text: '建议', suggestion: true, suggestion_demo: { type: 'insert', userId: 'test' } },
    { text: '批注', comment: true, comment_demo: true },
    { text: '⌘+J', kbd: true },
  ] }]);
  assert.equal(doc.serialize(), '建议批注⌘+J\n');
});
