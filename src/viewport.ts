// The on-screen keyboard can resize the visual viewport without changing 100dvh.
// Keep the conversation inside the visible area, without interfering with pinch zoom.
export function trackViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  function update() {
    frame = 0;
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height ?? window.innerHeight;
    root.style.setProperty('--app-height', `${Math.round(height)}px`);
    root.style.setProperty('--app-offset-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
    const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
    root.dataset.keyboardOpen = String(Boolean(editing && window.innerHeight - height > 120));
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-offset-top');
    delete root.dataset.keyboardOpen;
  };
}
