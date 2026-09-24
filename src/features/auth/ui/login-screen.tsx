'use client';
import {
  InterfaceProvider,
  useInterface,
  useT,
} from '@/features/workspace/ui/interface-provider';
import { LoginForm } from './login-form';

function Content({
  configured,
  error,
}: {
  configured: boolean;
  error?: string;
}) {
  const t = useT();
  const { locale, update } = useInterface();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="grid w-full max-w-sm gap-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-semibold text-2xl">MarkDock</h1>
          <button
            className="ws-button"
            onClick={() => update({ locale: locale === 'en' ? 'zh-CN' : 'en' })}
            type="button"
          >
            {locale === 'en' ? '中文' : 'English'}
          </button>
        </div>
        <p>{t('单用户密码登录')}</p>
        {error ? (
          <p role="alert">{t(error)}</p>
        ) : configured ? (
          <LoginForm onSuccess={() => window.location.assign('/workspace')} />
        ) : (
          <div className="grid gap-3">
            <p>{t('尚未设置密码，请先在服务器初始化登录。')}</p>
            <code>bun run auth:password</code>
            <p className="text-muted-foreground text-sm">
              {t('设置完成后刷新此页。')}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
export function LoginScreen(props: { configured: boolean; error?: string }) {
  return (
    <InterfaceProvider>
      <Content {...props} />
    </InterfaceProvider>
  );
}
