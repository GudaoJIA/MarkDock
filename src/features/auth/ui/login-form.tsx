'use client';
import { useState } from 'react';
import { useT } from '@/features/workspace/ui/interface-provider';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ operation: 'login', password }),
          });
          setPassword('');
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || '登录失败，请重试。');
          onSuccess();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : '登录失败，请重试。'
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-2">
        {t('密码')}
        <input
          autoComplete="current-password"
          className="ws-input"
          disabled={busy}
          maxLength={256}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {t(error)}
        </p>
      )}
      <button className="ws-button" disabled={busy} type="submit">
        {t(busy ? '正在登录…' : '登录')}
      </button>
    </form>
  );
}
