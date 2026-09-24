export type ResourceEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size?: number;
};
export type ResourceListing = {
  entries: ResourceEntry[];
  nextCursor?: string;
};
const imageFile = /\.(png|jpe?g|gif|webp|avif)$/i;
export const previewableImage = (name: string) => imageFile.test(name);
