import { create } from 'zustand';

/**
 * How this browser likes the bench to look: light or dark, and which skin the
 * parts wear. Kept in localStorage — a preference about a screen belongs to the
 * screen, and storing it on the account would need a server round trip to paint
 * the first frame. index.html applies the theme before React loads, so there is
 * no flash of the wrong one.
 */

export type Theme = 'light' | 'dark';
export type NodeSkin = 'instruments' | 'rack';

const THEME_KEY = 'lb:theme';
const SKIN_KEY = 'lb:node-skin';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage still get the change for this visit.
  }
}

const systemTheme = (): Theme =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function initialTheme(): Theme {
  const stored = read(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : systemTheme();
}
function initialSkin(): NodeSkin {
  return read(SKIN_KEY) === 'rack' ? 'rack' : 'instruments';
}

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PrefsState {
  theme: Theme;
  /** False until somebody picks — until then the theme follows the system. */
  themeChosen: boolean;
  nodeSkin: NodeSkin;
  /** Switch theme. `origin` is where the circular reveal grows from, in viewport px. */
  toggleTheme: (origin?: { x: number; y: number }) => void;
  setNodeSkin: (skin: NodeSkin) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: initialTheme(),
  themeChosen: read(THEME_KEY) !== null,
  nodeSkin: initialSkin(),

  toggleTheme: (origin) => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    write(THEME_KEY, next);
    const apply = () => {
      document.documentElement.dataset.theme = next;
      set({ theme: next, themeChosen: true });
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || reduceMotion() || !origin) {
      apply();
      return;
    }
    const t = doc.startViewTransition(apply);
    t.ready
      .then(() => {
        const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`],
          },
          { duration: 560, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => undefined);
  },

  setNodeSkin: (skin) => {
    write(SKIN_KEY, skin);
    set({ nodeSkin: skin });
  },
}));

/** Follow the system theme until the person picks one themselves. */
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (usePrefs.getState().themeChosen) return;
    const next: Theme = e.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    usePrefs.setState({ theme: next });
  });
}
