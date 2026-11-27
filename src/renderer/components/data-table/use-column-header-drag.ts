import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  moveColumnTo,
  normalizeColumnLayout,
  type ColumnLayout,
  type LayoutColumn,
} from './column-layout';

type Drop = { key: string; after: boolean };

const EDGE = 32;

export function useColumnHeaderDrag(
  layout: ColumnLayout | undefined,
  columns: LayoutColumn[],
  onChange: ((next: ColumnLayout) => void) | undefined,
) {
  const [drop, setDrop] = useState<Drop | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const swallowClick = useRef(false);
  const clickTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      cancelDrag.current?.();
      window.clearTimeout(clickTimer.current);
    },
    [],
  );

  function start(event: ReactPointerEvent<HTMLTableCellElement>, key: string) {
    if (!layout || !onChange || event.button !== 0 || !event.isPrimary) return;
    const header = event.currentTarget;
    const row = header.parentElement;
    const scroller = header.closest<HTMLElement>('.domain-table-scroll');
    if (!row || !scroller) return;
    const tableRow = row;
    const scrollHost = scroller;
    cancelDrag.current?.();

    const pointer = event.pointerId;
    const startX = event.clientX;
    let x = startX;
    let y = event.clientY;
    let dragging = false;
    let frame = 0;
    let target: Drop | null = null;
    const current = normalizeColumnLayout(layout, columns);

    function updateTarget() {
      const area = tableRow.getBoundingClientRect();
      const view = scrollHost.getBoundingClientRect();
      const inside =
        y >= area.top && y <= area.bottom && x >= view.left && x <= view.right;
      let next: Drop | null = null;
      if (inside) {
        for (const cell of tableRow.querySelectorAll<HTMLElement>(
          '[data-reorder-column]',
        )) {
          const box = cell.getBoundingClientRect();
          if (!box.width || x < box.left || x >= box.right) continue;
          const over = cell.dataset.reorderColumn!;
          if (over !== key)
            next = { key: over, after: x >= box.left + box.width / 2 };
          break;
        }
      }
      if (next?.key !== target?.key || next?.after !== target?.after) {
        target = next;
        setDrop(next);
      }
      return inside ? view : null;
    }

    function scrollAtEdge() {
      frame = 0;
      const view = updateTarget();
      if (!view) return;
      const delta = x > view.right - EDGE ? 12 : x < view.left + EDGE ? -12 : 0;
      const before = scrollHost.scrollLeft;
      scrollHost.scrollLeft += delta;
      if (scrollHost.scrollLeft !== before)
        frame = window.requestAnimationFrame(scrollAtEdge);
    }

    function move(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      x = e.clientX;
      y = e.clientY;
      if (!dragging && Math.abs(x - startX) >= 6) {
        dragging = true;
        header.setPointerCapture(pointer);
      }
      if (!dragging) return;
      updateTarget();
      if (!frame) frame = window.requestAnimationFrame(scrollAtEdge);
    }

    function stop() {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', stop);
      cancelDrag.current = null;
      setDrop(null);
    }

    function cancel(e: PointerEvent) {
      if (e.pointerId === pointer) stop();
    }

    function finish(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      x = e.clientX;
      y = e.clientY;
      if (dragging) updateTarget();
      stop();
      if (!dragging) return;
      // Pointer capture can send the release click back to the sort control.
      swallowClick.current = true;
      window.clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);

      if (!target || !header.isConnected) return;
      const from = current.order.indexOf(key);
      const over = current.order.indexOf(target.key);
      const to = over + Number(target.after) - Number(from < over);
      const order = moveColumnTo(current.order, key, to, columns);
      if (order !== current.order) onChange?.({ ...current, order });
    }

    cancelDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', stop);
  }

  function preventDragClick(event: MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return { drop, start, preventDragClick };
}
