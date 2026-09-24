import type { InterfaceLocale } from './interface-preferences';
import { english } from './messages';

const chinese = /[\p{Script=Han}]/u;
const regexCharacters = /[.*+?^${}()|[\]\\]/g;
const parameter = /\{(\d+)\}/g;
// Dynamic operational messages arrive from the service as Chinese copy. Match
// complete known messages only; captured paths and user text remain verbatim.
const patterns = Object.entries(english)
  .filter(([key]) => key.includes('{0}') && chinese.test(key))
  .map(([key, value]) => {
    const indexes: number[] = [];
    const source = key
      .split(parameter)
      .map((part, index) => {
        if (index % 2) {
          indexes.push(Number(part));
          return '([\\s\\S]*?)';
        }
        return part.replace(regexCharacters, '\\$&');
      })
      .join('');
    return { expression: new RegExp(`^${source}$`), value, indexes };
  });
export function translate(
  locale: InterfaceLocale,
  message: string,
  values?: readonly (string | number)[]
): string {
  const known = Object.hasOwn(english, message);
  let result = locale === 'en' && known ? english[message] : message;
  if (locale === 'en' && !values && !known && chinese.test(message)) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(message);
      if (!match) continue;
      const captured: string[] = [];
      pattern.indexes.forEach((index, position) => {
        captured[index] = match[position + 1];
      });
      return pattern.value.replace(
        parameter,
        (token, index) => captured[Number(index)] ?? token
      );
    }
  }
  if (values)
    result = result.replace(parameter, (token, index) =>
      String(values[Number(index)] ?? token)
    );
  return result;
}
