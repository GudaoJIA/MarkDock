export type HistoryLimits = {
  batches: number;
  documentMiB: number;
  pageMiB: number;
};
export const defaultHistoryLimits: HistoryLimits = {
  batches: 200,
  documentMiB: 16,
  pageMiB: 64,
};
export const historyPresets = [
  { label: '节省内存', limits: { batches: 100, documentMiB: 8, pageMiB: 32 } },
  { label: '均衡', limits: defaultHistoryLimits },
  {
    label: '更多历史',
    limits: { batches: 500, documentMiB: 32, pageMiB: 128 },
  },
];
export function validHistoryLimits(value: unknown): value is HistoryLimits {
  if (!value || typeof value !== 'object') return false;
  const v = value as HistoryLimits;
  return (
    Number.isInteger(v.batches) &&
    v.batches >= 20 &&
    v.batches <= 1000 &&
    Number.isInteger(v.documentMiB) &&
    v.documentMiB >= 4 &&
    v.documentMiB <= 64 &&
    Number.isInteger(v.pageMiB) &&
    v.pageMiB >= 16 &&
    v.pageMiB <= 256 &&
    v.documentMiB <= v.pageMiB
  );
}
export const MiB = 1024 * 1024;
