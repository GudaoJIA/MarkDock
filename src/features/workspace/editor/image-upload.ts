import { reportAuthentication } from '@/features/auth/ui/session-expiry';
export function uploadImageFile({
  file,
  workspace,
  revision,
  path,
  signal,
  onProgress,
}: {
  file: File;
  workspace: string;
  revision?: string;
  path: string;
  signal: AbortSignal;
  onProgress?: (value: number) => void;
}): Promise<{ url: string }> {
  if (file.size > 20 * 1024 * 1024)
    return Promise.reject(new Error('图片不能超过 20 MB。'));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) {
      reject(new Error('已取消上传。'));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('POST', '/api/workspace');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      reportAuthentication(xhr.status);
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || '上传失败。'));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('网络连接失败。'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new Error('已取消上传。'));
    };
    const form = new FormData();
    form.set('operation', 'upload-image');
    form.set('id', workspace);
    form.set('path', path);
    if (revision) form.set('revision', revision);
    form.set('image', file);
    xhr.send(form);
  });
}
