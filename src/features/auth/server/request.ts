import { checkRequest } from '@/features/auth/server/access';
import { WorkspaceError } from '@/features/workspace/shared/types';
import { authentication, requestToken } from './authentication';

export async function requireWorkspaceRequest(request: Request) {
  checkRequest(request);
  if (!(await authentication().authenticated(requestToken(request))))
    throw new WorkspaceError(
      '登录已失效，请重新登录；当前草稿仍保留在本页。',
      401
    );
}
