export type ShortcutPlatform = 'mac' | 'other';
export type Shortcut = {
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};
export type ShortcutMap = Record<string, Shortcut | null>;
export const shortcutCommands = [
  ['bold', '粗体', 'inline'],
  ['italic', '斜体', 'inline'],
  ['strikethrough', '删除线', 'inline'],
  ['code', '行内代码', 'inline'],
  ['link', '链接', 'inline'],
  ['p', '正文', 'block'],
  ...Array.from({ length: 6 }, (_, i) => [
    `h${i + 1}`,
    ['一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'][i],
    'block',
  ]),
  ['ul', '无序列表', 'block'],
  ['ol', '有序列表', 'block'],
  ['todo', '待办列表', 'block'],
  ['blockquote', '引用', 'block'],
  ['code_block', '代码块', 'block'],
  ['table', '插入表格', 'insert'],
  ['hr', '分隔线', 'insert'],
  ['img', '插入图片', 'insert'],
  ['attachment', '插入附件', 'insert'],
].map(([id, label, group]) => ({ id, label, group }));
export function defaultShortcuts(platform: ShortcutPlatform): ShortcutMap {
  const primary = {
    meta: platform === 'mac',
    ctrl: platform !== 'mac',
    alt: false,
    shift: false,
  };
  const extended = { ...primary, ctrl: true, alt: platform !== 'mac' };
  const result: ShortcutMap = {
    bold: { ...primary, code: 'KeyB' },
    italic: { ...primary, code: 'KeyI' },
    link: { ...primary, code: 'KeyK' },
    code: { ...primary, shift: true, code: 'Backquote' },
    strikethrough: { ...primary, shift: true, code: 'KeyX' },
  };
  const codes: Record<string, string> = {
    p: 'Digit0',
    ul: 'KeyU',
    ol: 'KeyO',
    todo: 'KeyL',
    blockquote: 'Quote',
    code_block: 'KeyK',
    table: 'KeyT',
    hr: 'KeyH',
    img: 'KeyI',
    attachment: 'KeyA',
  };
  for (let i = 1; i <= 6; i++) codes[`h${i}`] = `Digit${i}`;
  for (const [id, code] of Object.entries(codes))
    result[id] = { ...extended, code };
  return result;
}
const physicalCode =
  /^(Key[A-Z]|Digit[0-9]|Backquote|Quote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Minus|Equal)$/;
export function isShortcut(value: unknown): value is Shortcut {
  if (!value || typeof value !== 'object') return false;
  const v = value as Shortcut;
  return (
    physicalCode.test(v.code) &&
    ['meta', 'ctrl', 'alt', 'shift'].every(
      (k) => typeof v[k as keyof Shortcut] === 'boolean'
    ) &&
    (v.meta || v.ctrl || v.alt)
  );
}
export const shortcutKey = (s: Shortcut) =>
  `${+s.meta}${+s.ctrl}${+s.alt}${+s.shift}:${s.code}`;
export function keyboardShortcut(
  event: Pick<
    KeyboardEvent,
    'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >
): Shortcut {
  return {
    code: event.code,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}
export function shortcutLabel(
  s: Shortcut | null | undefined,
  platform: ShortcutPlatform
) {
  if (!s) return '—';
  const keys: Record<string, string> = {
    Backquote: '`',
    Quote: "'",
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Minus: '-',
    Equal: '=',
  };
  return [
    s.meta ? '⌘' : null,
    s.ctrl ? (platform === 'mac' ? '⌃' : 'Ctrl') : null,
    s.alt ? (platform === 'mac' ? '⌥' : 'Alt') : null,
    s.shift ? (platform === 'mac' ? '⇧' : 'Shift') : null,
    keys[s.code] ?? s.code.replace('Key', '').replace('Digit', ''),
  ]
    .filter(Boolean)
    .join(platform === 'mac' ? '' : ' + ');
}
export function reservedShortcut(s: Shortcut, platform: ShortcutPlatform) {
  const primary = platform === 'mac' ? s.meta : s.ctrl;
  if (
    primary &&
    !s.alt &&
    (platform !== 'mac' || !s.ctrl) &&
    (['KeyQ', 'KeyM'].includes(s.code) ||
      (!s.shift && ['KeyX', 'Backquote'].includes(s.code)))
  )
    return true;
  if (
    ['KeyS', 'KeyZ', 'KeyY', 'KeyF', 'KeyH'].includes(s.code) &&
    primary &&
    !s.alt &&
    (platform !== 'mac' || !s.ctrl)
  )
    return true;
  if (
    primary &&
    !s.alt &&
    (platform !== 'mac' || !s.ctrl) &&
    [
      'KeyW',
      'KeyT',
      'KeyN',
      'KeyL',
      'KeyR',
      'KeyO',
      'KeyP',
      'KeyD',
      'KeyJ',
      'KeyE',
      'KeyG',
      'KeyC',
      'KeyV',
      'KeyA',
      'Equal',
      'Minus',
      'Digit0',
      'Digit1',
      'Digit2',
      'Digit3',
      'Digit4',
      'Digit5',
      'Digit6',
      'Digit7',
      'Digit8',
      'Digit9',
      'BracketLeft',
      'BracketRight',
      'Comma',
    ].includes(s.code)
  )
    return true;
  if (
    primary &&
    s.shift &&
    !s.alt &&
    ['KeyI', 'KeyC', 'KeyJ', 'Delete'].includes(s.code)
  )
    return true;
  if (
    platform === 'mac' &&
    s.meta &&
    s.alt &&
    ['KeyI', 'KeyJ', 'KeyC', 'KeyH', 'KeyM', 'KeyW', 'KeyD'].includes(s.code)
  )
    return true;
  if (platform === 'mac' && s.meta && s.ctrl && s.code === 'KeyQ') return true;
  if (
    platform === 'mac' &&
    s.meta &&
    s.shift &&
    ['Digit3', 'Digit4', 'Digit5'].includes(s.code)
  )
    return true;
  return s.code === 'KeyQ' && (s.meta || s.alt);
}
export function shortcutError(
  map: ShortcutMap,
  platform: ShortcutPlatform
): string {
  const seen = new Set<string>();
  for (const command of shortcutCommands) {
    const value = map[command.id];
    if (value === null) continue;
    if (!isShortcut(value)) return '请使用带修饰键的有效快捷键。';
    if (reservedShortcut(value, platform))
      return '该快捷键由浏览器、系统或基础编辑操作保留。';
    const key = shortcutKey(value);
    if (seen.has(key)) return '快捷键重复，请为每个操作选择不同组合。';
    seen.add(key);
  }
  return '';
}
export function parseShortcuts(
  value: unknown,
  platform: ShortcutPlatform
): ShortcutMap {
  const defaults = defaultShortcuts(platform);
  if (!value || typeof value !== 'object') return defaults;
  const map = { ...defaults };
  for (const { id } of shortcutCommands) {
    const candidate = (value as ShortcutMap)[id];
    if (candidate === null || isShortcut(candidate)) map[id] = candidate;
  }
  return shortcutError(map, platform) ? defaults : map;
}
export function shortcutCommand(
  event: KeyboardEvent,
  map: ShortcutMap
): string | undefined {
  if (event.isComposing || event.repeat || event.getModifierState?.('AltGraph'))
    return;
  const key = shortcutKey(keyboardShortcut(event));
  return shortcutCommands.find(
    ({ id }) => map[id] && shortcutKey(map[id]!) === key
  )?.id;
}
