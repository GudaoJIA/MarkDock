'use client';
const DATA_IMAGE =
  /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([\s\S]+)$/i;
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif)$/i;
const EMBEDDED = /^data:image\//i;
const LOCAL_IMAGE = /^(?:data|blob|file):/i;

import { KEYS, type TRange, type Value } from 'platejs';
import { useEffect, useRef, useState } from 'react';
import { RAW_BLOCK } from '../shared/raw';
import type { DocumentSession, WorkspaceController } from '../state/sessions';
import type { WorkspaceEditor } from './editor-kit';
import { uploadImageFile } from './image-upload';
import { insertMarkdownFragment } from './markdown-input';

function embeddedFile(source: string, name: string) {
  const match = DATA_IMAGE.exec(source);
  if (!match) throw new Error('内嵌图片格式不受支持。');
  if (match[2].length > 28 * 1024 * 1024)
    throw new Error('图片不能超过 20 MB。');
  const binary = atob(match[2].replace(/\s/g, ''));
  return new File([Uint8Array.from(binary, (ch) => ch.charCodeAt(0))], name, {
    type: match[1],
  });
}
export function imageCandidates(files: File[], images: HTMLImageElement[]) {
  const embedded = images.filter((image) =>
    EMBEDDED.test(image.getAttribute('src') ?? '')
  );
  const represented = embedded.length >= files.length ? embedded : images;
  const candidates: {
    file?: File;
    image?: HTMLImageElement;
    error?: string;
  }[] = files.map((file, index) => ({ file, image: represented[index] }));
  for (const [index, image] of embedded.entries()) {
    if (candidates.some((item) => item.image === image)) continue;
    try {
      candidates.push({
        file: embeddedFile(
          image.getAttribute('src')!,
          `粘贴图片-${index + 1}.png`
        ),
        image,
      });
    } catch (error) {
      candidates.push({
        image,
        error: error instanceof Error ? error.message : '图片无效。',
      });
    }
  }
  return candidates;
}
export function useImageImport(
  doc: DocumentSession<WorkspaceEditor>,
  controller: WorkspaceController<WorkspaceEditor>
) {
  const [status, setStatus] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const receive = (data: DataTransfer, at?: TRange | null) => {
    const available = data.files.length
      ? Array.from(data.files)
      : Array.from(data.items ?? [])
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file);
    const files = available.filter(
      (file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name)
    );
    const html = data.getData('text/html');
    const body = html
      ? new DOMParser().parseFromString(html, 'text/html').body
      : null;
    const images = body ? Array.from(body.querySelectorAll('img')) : [];
    const embedded = images.filter((img) =>
      EMBEDDED.test(img.getAttribute('src') ?? '')
    );
    if (!files.length && !embedded.length) return false;
    const editor = doc.editor;
    const selection = at ?? editor.selection;
    if (controller.busy || doc.composing) return true;
    if (
      selection &&
      editor.api.some({
        at: selection,
        match: { type: [KEYS.table, KEYS.codeBlock, RAW_BLOCK] },
      })
    ) {
      const text = data.getData('text/plain');
      if (!at && text) editor.tf.withNewBatch(() => editor.tf.insertText(text));
      return true;
    }
    const finish = controller.beginTask(doc);
    if (!finish) return true;
    const reference = selection ? editor.api.rangeRef(selection) : null;
    const transfer = new AbortController();
    abort.current = transfer;
    const candidates = imageCandidates(files, images);
    void (async () => {
      const nodes: Value = [];
      const extra: Value = [];
      const errors: string[] = [];
      try {
        for (const [index, item] of candidates.entries()) {
          try {
            if (!item.file) throw new Error(item.error);
            const result = await uploadImageFile({
              file: item.file,
              workspace: controller.workspace!.id,
              revision: controller.workspace!.settings?.revision,
              path: doc.path,
              signal: transfer.signal,
              onProgress: (percent) =>
                setStatus(
                  `导入图片 ${index + 1}/${candidates.length} · ${percent}%`
                ),
            });
            if (item.image) item.image.setAttribute('src', result.url);
            const node = {
              type: KEYS.img,
              url: result.url,
              caption: [{ text: item.image?.alt || item.file.name }],
              children: [{ text: '' }],
            };
            nodes.push(node);
            if (!item.image) extra.push(node);
          } catch (error) {
            if (transfer.signal.aborted) return;
            item.image?.remove();
            errors.push(
              error instanceof Error ? error.message : '图片导入失败。'
            );
          }
        }
        // Never let unhandled local/base64 URLs enter Plate's generic HTML importer.
        for (const image of body?.querySelectorAll('img') ?? [])
          if (LOCAL_IMAGE.test(image.getAttribute('src') ?? '')) image.remove();
        finish();
        if (transfer.signal.aborted || controller.active !== doc) return;
        if (nodes.length) {
          editor.tf.withNewBatch(() => {
            if (reference?.current) editor.tf.select(reference.current);
            else editor.tf.select(editor.api.end([])!);
            const fragment =
              body && images.length
                ? editor.api.html.deserialize({ element: body })
                : nodes;
            for (const node of fragment) {
              if (node.type === KEYS.img) {
                const uploaded = nodes.find((image) => image.url === node.url);
                if (uploaded) node.caption = uploaded.caption;
              }
            }
            insertMarkdownFragment(editor, fragment);
            if (body && images.length && extra.length)
              insertMarkdownFragment(editor, extra);
          });
          controller.changed(doc);
          editor.tf.focus();
        }
        setStatus(
          errors.length ? `部分图片未导入：${errors.join('；')}` : '图片已导入'
        );
      } catch (error) {
        if (!transfer.signal.aborted)
          setStatus(error instanceof Error ? error.message : '图片导入失败。');
      } finally {
        reference?.unref();
        finish();
      }
    })();
    return true;
  };
  return { receive, status };
}
