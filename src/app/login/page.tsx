import { headers } from 'next/headers';
import { requestOrigin } from '@/features/auth/server/access';
import { authentication } from '@/features/auth/server/authentication';
import { LoginScreen } from '@/features/auth/ui/login-screen';
import '../workspace/workspace.css';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function LoginPage() {
  let configured = false;
  let error: string | undefined;
  try {
    requestOrigin(await headers());
    configured = !!(await authentication().credentials());
  } catch {
    error = '登录或部署配置无效，请在服务器检查站点地址、允许目录及凭证权限。';
  }
  return <LoginScreen configured={configured} error={error} />;
}
