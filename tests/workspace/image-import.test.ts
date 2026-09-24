import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageCandidates } from '../../src/features/workspace/editor/image-import';

const image = (src: string) => ({ getAttribute: (key: string) => key === 'src' ? src : null }) as HTMLImageElement;
test('clipboard files take precedence without losing additional embedded images or changing remote images', async () => {
  const file = new File(['binary file'], 'one.png', { type: 'image/png' });
  const remote = image('https://example.com/image.png');
  const first = image('data:image/png;base64,YQ==');
  const second = image('data:image/png;base64,Yg==');
  const candidates = imageCandidates([file], [remote, first, second]);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].file, file);
  assert.equal(candidates[0].image, first);
  assert.equal(candidates[1].image, second);
  assert.equal(await candidates[1].file!.text(), 'b');
  assert.equal(imageCandidates([], [remote]).length, 0);
});
test('multiple image files stay separate; bad embedded images report errors without losing valid ones', () => {
  const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')];
  assert.deepEqual(imageCandidates(files, []).map(item => item.file), files);
  const result = imageCandidates([], [image('data:image/png;base64,%%bad'), image('data:image/avif;base64,Yg==')]);
  assert.ok(result[0].error);
  assert.equal(result[1].file!.type, 'image/avif');
  assert.ok(imageCandidates([], [image('data:image/svg+xml;base64,YQ==')])[0].error);
});
