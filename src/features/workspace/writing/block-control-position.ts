// Measure rendered text without changing the editor selection or document nodes.
export function observeBlockControlPosition(wrapper: HTMLElement) {
  let frame = 0;
  let disposed = false;
  const measure = () => {
    frame = 0;
    const bounds = wrapper.getBoundingClientRect();
    if (!bounds.height) return;
    const content = wrapper.querySelector<HTMLElement>(
      '[data-slate-node="element"]'
    );
    if (!content) return;
    const contentBounds = content.getBoundingClientRect();
    let center = contentBounds.top + Math.min(18, contentBounds.height / 2);
    if (!content.hasAttribute('data-slate-void')) {
      const leaves = content.querySelectorAll<HTMLElement>(
        '[data-slate-string], [data-slate-zero-width]'
      );
      for (const leaf of leaves) {
        if (leaf.closest('[contenteditable="false"]')) continue;
        const text = leaf.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(text.textContent?.length ?? 0, 1));
        const firstLine = [...range.getClientRects()].find((r) => r.height);
        if (!firstLine) continue;
        center = firstLine.top + firstLine.height / 2;
        break;
      }
    }
    const marker = wrapper.querySelector<HTMLElement>('[data-todo-marker]');
    if (marker?.offsetParent instanceof HTMLElement) {
      const parent = marker.offsetParent;
      marker.style.top =
        center -
        parent.getBoundingClientRect().top -
        parent.clientTop -
        marker.getBoundingClientRect().height / 2 +
        'px';
    }
    wrapper.style.setProperty('--ws-first-line-y', `${center - bounds.top}px`);
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(wrapper);
  const mutation = new MutationObserver(schedule);
  mutation.observe(wrapper, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });
  window.addEventListener('resize', schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  void document.fonts.ready.then(schedule);
  measure();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutation.disconnect();
    window.removeEventListener('resize', schedule);
    document.fonts.removeEventListener('loadingdone', schedule);
  };
}
