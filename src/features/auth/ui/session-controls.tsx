'use client';
import { LogInIcon, LogOutIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceEditor } from '@/features/workspace/editor/editor-kit';
import type { WorkspaceManager } from '@/features/workspace/state/manager';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/features/workspace/ui/dialog';
import { useT } from '@/features/workspace/ui/interface-provider';
import { LoginForm } from './login-form';

export function SessionControls({
  manager,
}: {
  manager: WorkspaceManager<WorkspaceEditor>;
}) {
  const t = useT();
  const [expired, setExpired] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const required = () => {
      setExpired(true);
      setNotice('');
    };
    window.addEventListener('markdock:login-required', required);
    return () =>
      window.removeEventListener('markdock:login-required', required);
  }, []);
  return (
    <>
      <button
        className="ws-button ws-sidebar-action mb-2 w-full"
        disabled={manager.busy}
        onClick={() => {
          if (expired) {
            setOpen(true);
            return;
          }
          void manager
            .logout(async () => {
              const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operation: 'logout' }),
                cache: 'no-store',
              });
              if (!response.ok)
                throw new Error(
                  (await response.json()).error || '退出登录失败，请重试。'
                );
            })
            .then((ok) => {
              if (ok) window.location.assign('/login');
            });
        }}
        type="button"
      >
        {expired ? (
          <LogInIcon aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <LogOutIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        {t(expired ? '重新登录' : '退出登录')}
      </button>
      {expired && (
        <p role="status">
          {t('登录已失效，请重新登录；当前草稿仍保留在本页。')}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('重新登录')}</DialogTitle>
            <DialogDescription>
              {t('重新登录不会刷新页面或丢弃草稿。')}
            </DialogDescription>
          </DialogHeader>
          <LoginForm
            onSuccess={() => {
              setExpired(false);
              setOpen(false);
              setNotice('登录已恢复，请重试未完成的操作。');
              if (manager.activeRoot) void manager.open(manager.activeRoot);
              else void manager.refreshManagement();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
