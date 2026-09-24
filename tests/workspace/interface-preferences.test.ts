import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { defaultInterfacePreferences, parseInterfacePreferences, resolveAppearance } from '../../src/features/workspace/shared/interface-preferences';
import { english } from '../../src/features/workspace/shared/messages';
import { translate } from '../../src/features/workspace/shared/translate';
import { createInterfacePreferenceStore } from '../../src/features/workspace/state/interface-preferences';

describe('interface preferences', () => {
  test('restores valid settings and safely defaults malformed storage', () => {
    for (const value of [null, '{}', '{', 'null', '42', '{"locale":"fr","appearance":"night"}'])
      assert.deepEqual(parseInterfacePreferences(value), defaultInterfacePreferences);
    assert.deepEqual(parseInterfacePreferences('{"locale":"en","appearance":"dark"}'), { ...defaultInterfacePreferences, locale: 'en', appearance: 'dark' });
    assert.equal(defaultInterfacePreferences.locale, 'en');
    assert.equal(parseInterfacePreferences('{"locale":"zh-CN"}').locale, 'zh-CN');
    assert.equal(parseInterfacePreferences('{"locale":"invalid","appearance":"dark"}').appearance, 'dark');
    assert.equal(resolveAppearance('system', true), 'dark');
    assert.equal(resolveAppearance('system', false), 'light');
    assert.equal(resolveAppearance('light', true), 'light');
    assert.equal(resolveAppearance('dark', false), 'dark');
  });
  test('persists changes, merges preferences and refreshes external changes', () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const store = createInterfacePreferenceStore(() => storage);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications++; });
    assert.equal(store.update({ locale: 'en' }), true);
    assert.equal(store.update({ appearance: 'dark' }), true);
    assert.deepEqual(parseInterfacePreferences(store.snapshot()), { ...defaultInterfacePreferences, locale: 'en', appearance: 'dark' });
    const reopened = createInterfacePreferenceStore(() => storage);
    assert.equal(reopened.snapshot(), store.snapshot());
    raw = '{"locale":"zh-CN","appearance":"light"}';
    store.reload();
    assert.equal(parseInterfacePreferences(store.snapshot()).appearance, 'light');
    assert.equal(parseInterfacePreferences(store.snapshot()).locale, 'zh-CN');
    assert.equal(notifications, 3);
    unsubscribe();
  });
  test('denied writes keep new preferences in memory even when old storage is readable', () => {
    const store = createInterfacePreferenceStore(() => ({
      getItem: () => '{"locale":"zh-CN","appearance":"light"}',
      setItem: () => { throw new Error('QuotaExceeded'); },
    }));
    assert.equal(store.update({ locale: 'en' }), false);
    assert.equal(store.update({ appearance: 'dark' }), false);
    assert.deepEqual(parseInterfacePreferences(store.snapshot()), { ...defaultInterfacePreferences, locale: 'en', appearance: 'dark' });
    const denied = createInterfacePreferenceStore(() => { throw new Error('SecurityError'); });
    assert.equal(denied.update({ locale: 'en' }), false);
    assert.equal(parseInterfacePreferences(denied.snapshot()).locale, 'en');
  });
});

describe('workspace translations', () => {
  test('keeps user paths, markup and replacement-like characters verbatim', () => {
    const path = '文档/图片 $& {0}.md';
    assert.equal(translate('en', '编辑 {0}', [path]), `Edit ${path}`);
    assert.equal(translate('zh-CN', '编辑 {0}', [path]), `编辑 ${path}`);
    assert.equal(translate('en', `引用文件不存在：${path}`), `Referenced file not found: ${path}`);
    assert.equal(translate('en', '# 正文 <script>标题</script>'), '# 正文 <script>标题</script>');
    assert.equal(translate('en', '没有权限访问此文件或目录。'), 'Permission denied for this file or directory.');
  });
  test('every translation preserves its parameter set', () => {
    const parameters = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(x => x[0]).sort();
    for (const [key, value] of Object.entries(english)) assert.deepEqual(parameters(value), parameters(key), key);
  });
  test('all literal translation calls have English copy', () => {
    const root = fileURLToPath(new URL('../../src/features/workspace', import.meta.url));
    const missing: string[] = [];
    for (const folder of ['editor', 'shell', 'writing', 'ui', '../auth/ui']) {
      for (const filename of readdirSync(resolve(root, folder)).filter(file => file.endsWith('.tsx'))) {
        const file = resolve(root, folder, filename);
        const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
            const key = node.arguments[0];
            if (key && ts.isStringLiteral(key) && !Object.hasOwn(english, key.text)) missing.push(`${filename}: ${key.text}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(ast);
      }
    }
    assert.deepEqual(missing, []);
  });
});


test('resource visibility is an opt-in browser preference, persisted and reloaded independently of workspace settings', () => {
 let value: string | null = null;
 const store=createInterfacePreferenceStore(()=>({getItem:()=>value,setItem:(_key:string,next:string)=>{value=next;}}));
 assert.equal(parseInterfacePreferences(store.snapshot()).showResourceDirectories,false);
 assert(store.update({showResourceDirectories:true}));
 assert.equal(parseInterfacePreferences(value).showResourceDirectories,true);
 value=JSON.stringify({showResourceDirectories:false});store.reload();
 assert.equal(parseInterfacePreferences(store.snapshot()).showResourceDirectories,false);
 assert.equal(parseInterfacePreferences('{"showResourceDirectories":"true"}').showResourceDirectories,false);
});
