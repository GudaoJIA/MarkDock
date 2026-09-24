import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApi } from 'platejs';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
import {
  markdownPasteFragment,
  setMarkdownComposing,
} from '../../src/features/workspace/editor/markdown-input';

const document = (content = '') =>
  createDocumentEditor(
    { path: 'input.md', content, version: '1' },
    { id: 'test', root: '/test', name: 'test' }
  );
function type(doc: ReturnType<typeof document>, text: string) {
  if (!doc.editor.selection) doc.editor.tf.select(doc.editor.api.start([])!);
  for (const char of text) doc.editor.tf.insertText(char);
}
const transfer = (text: string, html = '') =>
  ({
    getData: (mime: string) =>
      mime === 'text/plain' ? text : mime === 'text/html' ? html : '',
    files: [],
    items: [],
    types: html ? ['text/plain', 'text/html'] : ['text/plain'],
  }) as unknown as DataTransfer;

test('heading shortcuts convert immediately and undo restores complete Markdown syntax', () => {
  for (let level = 1; level <= 6; level++) {
    const doc = document();
    const prefix = '#'.repeat(level) + ' ';
    type(doc, prefix);
    assert.equal(doc.editor.children[0].type, `h${level}`);
    doc.editor.tf.undo();
    assert.equal(doc.editor.children[0].type, 'p');
    assert.equal(NodeApi.string(doc.editor.children[0]), prefix);
    doc.editor.tf.redo();
    assert.equal(doc.editor.children[0].type, `h${level}`);
  }
});

test('three dashes and space create a separator only in an otherwise empty top-level paragraph', () => {
  const doc = document(); type(doc, '--- ');
  assert.equal(doc.editor.children[0].type, 'hr');
  assert.equal(doc.editor.children[1].type, 'p');
  doc.editor.tf.undo();
  assert.equal(NodeApi.string(doc.editor.children[0]), '--- ');
  for (const source of ['正文', '> 引用', '- 列表']) {
    const other = document(source); other.editor.tf.select(other.editor.api.end([])!); type(other, '--- ');
    assert.notEqual(other.editor.children[0].type, 'hr');
  }
});

test('list Tab changes exactly one level in one batch, mixed selection is unchanged', () => {
  const doc = document('- 一\n- 二\n\n正文');
  doc.editor.tf.select(doc.editor.api.start([0])!);
  doc.editor.tf.tab({ reverse: false });
  assert.equal(doc.editor.children[0].indent, 2);
  assert.equal(doc.editor.history.undos.length, 1);
  doc.editor.tf.tab({ reverse: true });
  assert.equal(doc.editor.children[0].indent, 1);
  doc.editor.tf.tab({ reverse: true });
  assert.equal(doc.editor.children[0].listStyleType, undefined);
  const mixed = document('- 列表\n\n正文');
  mixed.editor.tf.select(mixed.editor.api.range([])!);
  const before = JSON.stringify(mixed.editor.children);
  mixed.editor.tf.tab({ reverse: false });
  assert.equal(JSON.stringify(mixed.editor.children), before);
  const multiple = document('- 一\n- 二\n');
  multiple.editor.tf.select(multiple.editor.api.range([])!);
  multiple.editor.tf.tab({ reverse: false });
  assert.deepEqual(multiple.editor.children.map(node => node.indent), [2, 2]);
});

test('rich text keeps its own paste path; code and table paste stay literal with one undo', () => {
  const doc = document();
  assert.equal(
    markdownPasteFragment(
      doc.editor,
      transfer('**text**', '<p><em>**text**</em></p>')
    ),
    undefined
  );
  for (const [source, path] of [
    ['```\nold\n```', [0, 0]],
    ['| H |\n| - |\n| old |', [0, 1, 0, 0]],
  ] as const) {
    const target = document(source);
    target.editor.tf.select(target.editor.api.range([...path])!);
    const before = target.serialize();
    target.editor.tf.insertData(transfer('**literal**\n# line'));
    assert.equal(
      NodeApi.string(NodeApi.get(target.editor, [...path])!),
      source.startsWith('|') ? '**literal** # line' : '**literal**\n# line'
    );
    target.editor.tf.undo();
    assert.equal(target.serialize(), before);
  }
});

test('read-only input cannot autoformat or paste, and hand-written tables remain paragraphs', () => {
  const doc = document();
  const readOnly = doc.editor.api.isReadOnly;
  doc.editor.api.isReadOnly = () => true;
  type(doc, '# ');
  doc.editor.tf.insertData(transfer('## pasted'));
  assert.equal(NodeApi.string(doc.editor.children[0]), '# ');
  assert.equal(doc.editor.children[0].type, 'p');
  doc.editor.api.isReadOnly = readOnly;
  const table = document();
  type(table, '| A | B |');
  table.editor.tf.insertBreak();
  type(table, '| - | - |');
  table.editor.tf.insertBreak();
  assert.equal(
    table.editor.children.some((n) => n.type === 'table'),
    false
  );
  assert.equal(NodeApi.string(table.editor), '| A | B || - | - |');
});

test('Markdown paste replaces only the selection, retains structures and undoes as one action', () => {
  const doc = document('前选中后\n');
  doc.editor.tf.select({
    anchor: { path: [0, 0], offset: 1 },
    focus: { path: [0, 0], offset: 3 },
  });
  const before = doc.serialize();
  doc.editor.tf.insertData(
    transfer(
      '## 粘贴标题\n\n- [x] 完成\n\n| H | Q |\n| - | - |\n| A | B |\n\n```js\nconst x = 1;\n```\n\n![说明](images/pic.png)\n'
    )
  );
  assert.equal(document(doc.serialize()).readOnlyReason, undefined);
  assert.ok(doc.editor.children.some((n) => n.type === 'table'));
  assert.ok(
    doc.editor.children.some((n) => n.type === 'code_block' && n.lang === 'js')
  );
  assert.ok(doc.editor.children.some((n) => n.type === 'img'));
  assert.ok(NodeApi.string(doc.editor).startsWith('前'));
  assert.ok(NodeApi.string(doc.editor).endsWith('后'));
  const after = doc.serialize();
  doc.editor.tf.undo();
  assert.equal(doc.serialize(), before);
  doc.editor.tf.redo();
  assert.equal(doc.serialize(), after);
});

test('unsupported Markdown paste stays literal and does not change document metadata', () => {
  for (const source of [
    '<span>原文</span>',
    '正文[^1]\n\n[^1]: 注释',
    '```js title="name"\ncode\n```',
    '[link](javascript:alert(1))',
  ]) {
    const doc = document('---\ntitle: 原标题\n---\n\n');
    doc.editor.tf.select(doc.editor.api.start([])!);
    doc.editor.tf.insertData(transfer(source));
    assert.equal(
      doc.editor.children
        .map((n) => NodeApi.string(n))
        .join('\n')
        .trimEnd(),
      source
    );
    assert.equal(document(doc.serialize()).readOnlyReason, undefined, source);
    assert.ok(doc.serialize().startsWith('---\ntitle: 原标题\n---\n'));
  }
});

test('composition commits once, while code, inline code and table structures stay literal', async () => {
  const doc = document();
  setMarkdownComposing(doc.editor, true);
  type(doc, '**中文**');
  assert.equal(NodeApi.string(doc.editor.children[0]), '**中文**');
  setMarkdownComposing(doc.editor, false);
  await Promise.resolve();
  assert.equal(NodeApi.string(doc.editor.children[0]), '中文');
  assert.match(doc.serialize(), /\*\*中文\*\*/);
  doc.editor.tf.undo();
  assert.equal(NodeApi.string(doc.editor.children[0]), '**中文**');
  for (const [source, path, text] of [
    ['```\n\n```', [0, 0], '**代码**'],
    ['| H |\n| - |\n|  |', [0, 1, 0, 0], '# 标题'],
  ] as const) {
    const protectedDoc = document(source);
    protectedDoc.editor.tf.select(protectedDoc.editor.api.start([...path])!);
    type(protectedDoc, text);
    assert.equal(
      NodeApi.string(NodeApi.get(protectedDoc.editor, [...path])!),
      text
    );
  }
  const inline = document('`原文`');
  inline.editor.tf.select({ path: [0, 0], offset: 1 });
  type(inline, '**字面**');
  assert.equal(NodeApi.string(inline.editor.children[0]), '原**字面**文');
  const table = document('| H |\n| - |\n|  |');
  table.editor.tf.select(table.editor.api.start([0, 1, 0, 0])!);
  type(table, '**粗体**');
  assert.match(table.serialize(), /\*\*粗体\*\*/);
  assert.equal(NodeApi.string(NodeApi.get(table.editor, [0, 1, 0])!), '粗体');
});

test('inline Markdown works beside Chinese text, preserves existing marks, and undoes to source', () => {
  for (const [source, mark] of [
    ['这里**重点**', 'bold'],
    ['这里*强调*', 'italic'],
    ['~~删除~~', 'strikethrough'],
    ['`code`', 'code'],
    ['__bold__', 'bold'],
    ['_italic_', 'italic'],
  ]) {
    const doc = document();
    type(doc, source);
    assert.ok(
      [...doc.editor.api.nodes({ at: [], match: (node: any) => !!node[mark] })]
        .length,
      source
    );
    doc.editor.tf.undo();
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    doc.editor.tf.redo();
    assert.equal(document(doc.serialize()).readOnlyReason, undefined);
  }
  for (const source of [
    '**未完成*',
    '\\*字面*',
    'file_name_here',
    '```',
    '***',
    '___',
    '~~',
  ]) {
    const doc = document();
    type(doc, source);
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    assert.equal(
      doc.editor.children[0].children.some(
        (n: any) => n.bold || n.italic || n.code || n.strikethrough
      ),
      false,
      source
    );
  }
  const doc = document('**已加粗**');
  doc.editor.tf.select(doc.editor.api.start([0])!);
  type(doc, '*');
  doc.editor.tf.select(doc.editor.api.end([0])!);
  type(doc, '*');
  assert.ok(
    [...doc.editor.api.nodes({ at: [], match: (n: any) => n.bold && n.italic })]
      .length
  );
});

test('Markdown links and standalone images retain URL and alt without stealing image syntax', () => {
  for (const source of [
    '[说明](https://example.com/a_(b))',
    '![说明](images/pic.png)',
  ]) {
    const doc = document();
    type(doc, source);
    assert.ok(
      [
        ...doc.editor.api.nodes({
          at: [],
          match: { type: source.startsWith('!') ? 'img' : 'a' },
        }),
      ].length,
      source
    );
    const saved = doc.serialize();
    doc.editor.tf.undo();
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    doc.editor.tf.redo();
    assert.equal(document(saved).readOnlyReason, undefined);
  }
  for (const source of [
    '前文 ![说明](images/pic.png)',
    '[危险](javascript:alert(1))',
  ]) {
    const doc = document();
    type(doc, source);
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    assert.equal(
      doc.editor.children.some((n) => n.type === 'img'),
      false
    );
    assert.equal(
      [...doc.editor.api.nodes({ at: [], match: { type: 'a' } })].length,
      0
    );
  }
});

test('lists, standard task markers and quotes consume prefixes without losing following text', () => {
  for (const prefix of ['- ', '* ', '+ ', '1. ', '3) ']) {
    const doc = document();
    type(doc, prefix);
    assert.ok(doc.editor.children[0].listStyleType, prefix);
    doc.editor.tf.undo();
    assert.equal(NodeApi.string(doc.editor.children[0]), prefix);
    doc.editor.tf.redo();
    type(doc, '内容');
    assert.equal(NodeApi.string(doc.editor.children[0]), '内容');
  }
  for (const marker of ['[ ]', '[x]', '[X]']) {
    const doc = document();
    type(doc, `- ${marker} `);
    assert.equal(doc.editor.children[0].listStyleType, 'todo', marker);
    assert.equal(doc.editor.children[0].checked, marker !== '[ ]');
    doc.editor.tf.undo();
    assert.equal(NodeApi.string(doc.editor.children[0]), `${marker} `);
    doc.editor.tf.redo();
    assert.equal(document(doc.serialize()).readOnlyReason, undefined);
  }
  const quote = document();
  type(quote, '> 引用');
  assert.equal(quote.editor.children[0].type, 'blockquote');
  assert.equal(quote.serialize(), '> 引用\n');
});

test('code fences retain language and thematic breaks convert only on Enter', () => {
  for (const source of ['```', '```js', '~~~python', '---', '***', '___']) {
    const doc = document();
    type(doc, source);
    assert.equal(doc.editor.children[0].type, 'p', source);
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    doc.editor.tf.insertBreak();
    assert.equal(
      doc.editor.children[0].type,
      source[0] === '`' || source[0] === '~' ? 'code_block' : 'hr',
      source
    );
    if (source.endsWith('js')) assert.equal(doc.editor.children[0].lang, 'js');
    if (source.endsWith('python'))
      assert.equal(doc.editor.children[0].lang, 'python');
    doc.editor.tf.undo();
    assert.equal(NodeApi.string(doc.editor.children[0]), source);
    assert.equal(doc.editor.children[0].type, 'p');
    doc.editor.tf.redo();
    assert.equal(document(doc.serialize()).readOnlyReason, undefined);
  }
});

test('shared block rendering survives rule overrides and nested inline text is preserved', () => {
  const doc = document();
  for (const key of ['h1', 'h2', 'blockquote', 'hr'])
    assert.ok(doc.editor.getPlugin({ key }).node.component, key);
  for (const [source, expected] of [
    ['[**bold**](https://example.com)', 'bold'],
    ['**a *b* c**', 'a b c'],
    ['`**literal**`', '**literal**'],
  ]) {
    const target = document();
    type(target, source);
    assert.equal(NodeApi.string(target.editor.children[0]), expected);
    assert.equal(
      NodeApi.string(document(target.serialize()).editor.children[0]),
      expected
    );
  }
});
