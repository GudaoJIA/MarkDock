import { WorkspaceError } from './types';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export function imageExtension(data: Uint8Array) {
  if (data.length > MAX_IMAGE_BYTES)
    throw new WorkspaceError('图片不能超过 20 MB。', 413);
  const bytes = Buffer.from(data);
  if (
    bytes.length >= 45 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  )
    return 'png';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  )
    return 'jpg';
  if (
    bytes.length >= 14 &&
    ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) &&
    bytes.at(-1) === 0x3b
  )
    return 'gif';
  if (
    bytes.length >= 20 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  )
    return 'webp';
  if (bytes.length >= 24 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const boxLength = bytes.readUInt32BE(0);
    if (boxLength >= 16 && boxLength <= bytes.length) {
      for (let offset = 8; offset < boxLength; offset += 4) {
        if (
          offset !== 12 &&
          ['avif', 'avis'].includes(bytes.toString('ascii', offset, offset + 4))
        )
          return 'avif';
      }
    }
  }
  throw new WorkspaceError(
    '图片格式无效。请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片。',
    415
  );
}
