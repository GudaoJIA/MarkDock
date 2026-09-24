import { isIP } from 'node:net';
import path from 'node:path';

const PORT_DIGITS = /^\d+$/;

export function loopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
}

export function readDataRoots(raw) {
  if (!raw?.trim()) return null;
  try {
    const roots = JSON.parse(raw);
    if (
      !Array.isArray(roots) ||
      roots.length > 100 ||
      roots.some(
        (root) =>
          typeof root !== 'string' ||
          !path.isAbsolute(root) ||
          root.includes('\0')
      )
    )
      throw new Error('Invalid deployment value');
    return [...new Set(roots.map((root) => path.resolve(root)))];
  } catch {
    throw new Error(
      'MARKDOCK_WORKSPACE_ROOTS 必须是绝对目录路径组成的 JSON 数组。'
    );
  }
}

// Also imported by the Node launcher: keep this free of framework/TS aliases.
/** @param {Record<string, string | undefined>} env */
export function deployment(env = process.env) {
  const hostname = env.MARKDOCK_HOST?.trim() || '127.0.0.1';
  const port = env.PORT?.trim() || '3000';
  if (hostname !== 'localhost' && !isIP(hostname))
    throw new Error('MARKDOCK_HOST 必须是 IP 地址或 localhost。');
  if (!PORT_DIGITS.test(port) || Number(port) < 1 || Number(port) > 65_535)
    throw new Error('PORT 必须是 1–65535 的整数。');
  const roots = readDataRoots(env.MARKDOCK_WORKSPACE_ROOTS);
  const raw = env.MARKDOCK_PUBLIC_ORIGIN?.trim();
  let origin = null;
  if (raw) {
    try {
      const url = new URL(raw);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        raw !== url.origin
      )
        throw new Error('Invalid deployment value');
      origin = url.origin;
    } catch {
      throw new Error(
        'MARKDOCK_PUBLIC_ORIGIN 必须是完整的 HTTPS 来源地址，不含路径、查询或末尾斜线。'
      );
    }
    if (!roots?.length)
      throw new Error('远程访问必须配置非空 MARKDOCK_WORKSPACE_ROOTS。');
    if (
      !env.MARKDOCK_DATA_DIR ||
      !path.isAbsolute(env.MARKDOCK_DATA_DIR) ||
      env.MARKDOCK_DATA_DIR.includes('\0')
    )
      throw new Error('远程访问必须配置绝对路径 MARKDOCK_DATA_DIR。');
  }
  if (!loopback(hostname) && !origin)
    throw new Error('非回环监听必须配置 MARKDOCK_PUBLIC_ORIGIN。');
  return { hostname, port: Number(port), origin, roots };
}
