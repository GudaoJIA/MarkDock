import {
  deployment,
  loopback,
} from '@/features/workspace/server/deployment.mjs';
import { WorkspaceError } from '@/features/workspace/shared/types';

function configuration() {
  try {
    return deployment();
  } catch (error) {
    throw new WorkspaceError((error as Error).message, 503);
  }
}

function checkedHost(host: string, protocol: string) {
  try {
    const url = new URL(`${protocol}//${host}`);
    if (url.host !== host || url.username || url.password)
      throw new Error('Invalid Host');
    return url;
  } catch {
    throw new WorkspaceError('请求站点不受信任。', 403);
  }
}

// Only Host and explicit configuration establish authority. Forwarded headers
// are neither proof of HTTPS nor a substitute for the external Host.
export function requestOrigin(headers: Headers, internalUrl?: URL) {
  const { origin } = configuration();
  const host = headers.get('host') ?? internalUrl?.host ?? '';
  if (origin) {
    if (checkedHost(host, 'https:').origin !== origin)
      throw new WorkspaceError('请求站点不受信任。', 403);
    return origin;
  }
  const external = checkedHost(host, internalUrl?.protocol ?? 'http:');
  if (
    !loopback(external.hostname) ||
    (internalUrl &&
      (!loopback(internalUrl.hostname) || internalUrl.port !== external.port))
  )
    throw new WorkspaceError('文件接口只允许本机访问。', 403);
  return external.origin;
}

export function checkRequest(request: Request) {
  const expected = requestOrigin(request.headers, new URL(request.url));
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== expected) || (site && site !== 'same-origin'))
    throw new WorkspaceError('请求来源不受信任。', 403);
  if (!['GET', 'HEAD'].includes(request.method) && origin !== expected)
    throw new WorkspaceError('缺少同源请求标识。', 403);
  return expected;
}
