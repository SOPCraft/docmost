import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { asideBounds, ASIDE_DEFAULT_WIDTH, ASIDE_WIDTH_KEY, clampAsideWidth, widthAfterKey } from './aside-size';

function readWidth() {
  try { return Number(localStorage.getItem(ASIDE_WIDTH_KEY)) || ASIDE_DEFAULT_WIDTH; }
  catch { return ASIDE_DEFAULT_WIDTH; }
}
export function useResizableAside(navigation: number, enabled: boolean) {
  const [preferred, setPreferred] = useState(readWidth);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [draft, setDraft] = useState<number | null>(null);
  const active = useRef<{ id: number; x: number; width: number; value: number; element: HTMLElement } | null>(null);
  const enabledOnDesktop = enabled && viewport >= 768;
  const width = clampAsideWidth(draft ?? preferred, viewport, navigation);
  const bounds = asideBounds(viewport, navigation);
  const save = useCallback((value: number) => {
    setPreferred(value);
    try { localStorage.setItem(ASIDE_WIDTH_KEY, String(value)); } catch { /* Storage is optional for resizing. */ }
  }, []);
  const finish = useCallback((commit: boolean) => {
    const drag = active.current; if (!drag) return;
    active.current = null;
    if (commit) save(drag.value);
    setDraft(null);
    if (drag.element.hasPointerCapture?.(drag.id)) drag.element.releasePointerCapture(drag.id);
  }, [save]);
  useEffect(() => {
    const resize = () => { finish(false); setViewport(window.innerWidth); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [finish]);
  useEffect(() => {
    if (!enabledOnDesktop) finish(false);
  }, [enabledOnDesktop, finish]);
  useEffect(() => {
    if (draft === null) return;
    const previous = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const blur = () => finish(false);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } };
    window.addEventListener('blur', blur); window.addEventListener('keydown', escape, true);
    return () => {
      document.body.style.cursor = previous.cursor; document.body.style.userSelect = previous.userSelect;
      window.removeEventListener('blur', blur); window.removeEventListener('keydown', escape, true);
    };
  }, [draft === null, finish]);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabledOnDesktop || event.button !== 0 || active.current) return;
    event.preventDefault(); event.currentTarget.focus();
    active.current = { id: event.pointerId, x: event.clientX, width, value: width, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId); setDraft(width);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = active.current; if (!drag || drag.id !== event.pointerId) return;
    drag.value = clampAsideWidth(drag.width + drag.x - event.clientX, window.innerWidth, navigation);
    setDraft(drag.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabledOnDesktop) return;
    const next = widthAfterKey(event.key, width, viewport, navigation, event.shiftKey);
    if (next !== null) { event.preventDefault(); event.stopPropagation(); save(next); }
  };
  return { width, dragging: draft !== null, handleProps: {
    role: 'separator', 'aria-label': '调整右侧栏宽度', 'aria-orientation': 'vertical' as const,
    'aria-valuemin': bounds.min, 'aria-valuemax': bounds.max, 'aria-valuenow': width,
    'aria-valuetext': `${width}像素`, tabIndex: enabledOnDesktop ? 0 : -1,
    'data-testid': 'aside-resize-handle', 'data-dragging': draft !== null ? 'true' : undefined,
    onPointerDown, onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => { if (active.current?.id === event.pointerId) finish(true); },
    onPointerCancel: () => finish(false), onLostPointerCapture: () => finish(false), onKeyDown,
    onDoubleClick: () => { if (enabledOnDesktop) save(clampAsideWidth(ASIDE_DEFAULT_WIDTH, viewport, navigation)); },
    title: '拖动调整宽度 · 双击恢复默认 · 方向键微调',
  } };
}
