import { useEffect, useRef } from 'react';
import { subscribeLoading } from './loading';

/** Below this, a wait is not worth announcing: a bar that flashes for 40ms reads as a glitch. */
const SHOW_AFTER_MS = 140;

/**
 * A thin cobalt line along the top of the window whenever something is loading.
 *
 * It creeps towards the end and never claims to arrive until the work actually
 * finishes, then snaps to full and fades. Driven by the Web Animations API from a
 * subscription, so a burst of requests costs no React renders at all.
 */
export function LoadingBar() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const fill = el.firstElementChild as HTMLElement;
    let creep: Animation | null = null;
    let showTimer = 0;
    let visible = false;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = () => {
      visible = true;
      el.dataset.state = 'loading';
      fill.getAnimations().forEach((a) => a.cancel());
      el.getAnimations().forEach((a) => a.cancel());
      el.style.opacity = '1';
      // Fast at first, then slower and slower: progress you can believe, never 100%.
      creep = fill.animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.3)', offset: 0.08 }, { transform: 'scaleX(0.93)' }],
        { duration: reduce ? 1 : 12_000, easing: 'cubic-bezier(0.1, 0.65, 0.2, 1)', fill: 'forwards' },
      );
    };

    const finish = () => {
      visible = false;
      el.dataset.state = 'done';
      if (creep) {
        creep.commitStyles();
        creep.cancel();
        creep = null;
      }
      fill.animate([{ transform: 'scaleX(1)' }], { duration: reduce ? 1 : 200, easing: 'ease-out', fill: 'forwards' });
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, delay: reduce ? 0 : 180, easing: 'ease', fill: 'forwards' });
    };

    const unsubscribe = subscribeLoading((busy) => {
      if (busy > 0) {
        if (visible || showTimer) return;
        showTimer = window.setTimeout(() => {
          showTimer = 0;
          start();
        }, SHOW_AFTER_MS);
      } else {
        if (showTimer) {
          window.clearTimeout(showTimer);
          showTimer = 0;
        }
        if (visible) finish();
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(showTimer);
    };
  }, []);

  return (
    <div ref={bar} className="lb-loading" role="progressbar" aria-label="Loading" aria-hidden="true">
      <i />
    </div>
  );
}
