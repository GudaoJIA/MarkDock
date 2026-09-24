import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestOrigin } from '@/features/auth/server/access';
import {
  AUTH_COOKIE,
  authentication,
} from '@/features/auth/server/authentication';
import { WorkspaceApp } from '@/features/workspace/shell/workspace';
import './workspace.css';

export const metadata: Metadata = {
  title: 'MarkDock · 本地 Markdown 工作区',
  description: '以真实文件夹组织文档，专注写作并自动保存 Markdown。',
};

export default async function WorkspacePage() {
  requestOrigin(await headers());
  if (
    !(await authentication().authenticated(
      (await cookies()).get(AUTH_COOKIE)?.value
    ))
  )
    redirect('/login');
  return <WorkspaceApp />;
}
