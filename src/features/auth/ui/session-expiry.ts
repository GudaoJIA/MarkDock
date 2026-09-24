export function reportAuthentication(status: number) {
  if (status === 401 && typeof window !== 'undefined')
    window.dispatchEvent(new Event('markdock:login-required'));
}
