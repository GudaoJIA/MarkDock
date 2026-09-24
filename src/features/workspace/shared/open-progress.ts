/** Opening progress is observational; counts are not a completion percentage. */
export type OpenStage =
  | 'saving'
  | 'waiting'
  | 'checking'
  | 'recovering'
  | 'tree'
  | 'document';
export type OpenProgress = {
  stage: OpenStage;
  entries?: number;
  cancellable: boolean;
};
export type ScanOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: OpenProgress) => void;
};
export type OpeningState = OpenProgress & {
  id: number;
  root: string;
  startedAt: number;
};
export function checkCancelled(options?: ScanOptions) {
  options?.signal?.throwIfAborted();
}
export function reportProgress(
  options: ScanOptions | undefined,
  progress: OpenProgress
) {
  options?.onProgress?.(progress);
}
export type ProgressEvent<T> =
  | { type: 'progress'; progress: OpenProgress }
  | { type: 'heartbeat' }
  | { type: 'result'; value: T }
  | { type: 'error'; error: string; status: number };
