import { useCallback, useEffect, useState } from 'react';

/**
 * Side panel widths, collapsed state, and the drag that changes them.
 *
 * A drawing board fills whatever is left over, so on a big sheet the two fixed 316px
 * and 372px columns are the difference between reading the design and hunting for it.
 * Both panels collapse to a spine and both can be dragged to any width, and the
 * arrangement is remembered per browser — a preference you have to set again every
 * morning is not a preference.
 */

const STORE_KEY = 'loadbearing.panels.v1';

export const PANEL_MIN = 210;
export const PANEL_MAX = 620;
/** Enough to hold the reopen affordance and nothing else. */
export const PANEL_COLLAPSED = 26;

export interface PanelState {
  leftWidth: number;
  rightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

const DEFAULTS: PanelState = { leftWidth: 316, rightWidth: 372, leftOpen: true, rightOpen: true };

const clampWidth = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, n)) : fallback;

function load(): PanelState {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<PanelState>;
    return {
      leftWidth: clampWidth(saved.leftWidth, DEFAULTS.leftWidth),
      rightWidth: clampWidth(saved.rightWidth, DEFAULTS.rightWidth),
      leftOpen: saved.leftOpen !== false,
      rightOpen: saved.rightOpen !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

export function usePanels() {
  const [state, setState] = useState<PanelState>(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // A browser refusing storage is not a reason to stop working.
    }
  }, [state]);

  const toggle = useCallback((side: 'left' | 'right') => {
    setState((s) => (side === 'left' ? { ...s, leftOpen: !s.leftOpen } : { ...s, rightOpen: !s.rightOpen }));
  }, []);

  /**
   * Listeners go on the window for the duration: the pointer leaves a 5px handle
   * immediately, and a handler bound to the handle stops firing the moment it does.
   */
  const startResize = useCallback((side: 'left' | 'right', event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    let startWidth = 0;
    setState((s) => {
      startWidth = side === 'left' ? s.leftWidth : s.rightWidth;
      return s;
    });

    const onMove = (e: PointerEvent) => {
      // The right panel grows as the pointer moves LEFT, which is the opposite sign.
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
      const width = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + delta));
      setState((s) =>
        side === 'left'
          ? { ...s, leftWidth: width, leftOpen: true }
          : { ...s, rightWidth: width, rightOpen: true },
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    // Without this a drag selects the panel's text as it passes over it.
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const columns = `${state.leftOpen ? state.leftWidth : PANEL_COLLAPSED}px 1fr ${
    state.rightOpen ? state.rightWidth : PANEL_COLLAPSED
  }px`;

  return { ...state, columns, toggle, startResize };
}
