import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp, type View } from '../state/appStore';
import { usePrefs } from './prefs';
import {
  IconDrafting,
  IconFolder,
  IconGauge,
  IconInstrument,
  IconLearn,
  IconManual,
  IconMark,
  IconMoon,
  IconNote,
  IconSheets,
  IconSignOut,
  IconSun,
} from './UiIcons';

const NAV: { view: View; label: string; Icon: (p: { size?: number }) => JSX.Element; also?: View[] }[] = [
  { view: 'learn', label: 'Learn', Icon: IconLearn, also: ['lesson'] },
  { view: 'problems', label: 'Problems', Icon: IconSheets, also: ['compose'] },
  { view: 'workspace', label: 'Drawing board', Icon: IconDrafting },
  { view: 'projects', label: 'Projects', Icon: IconFolder, also: ['project'] },
  { view: 'dashboard', label: 'Progress', Icon: IconGauge },
  { view: 'notebook', label: 'Notes', Icon: IconNote },
  { view: 'reference', label: 'Reference', Icon: IconManual },
];

/**
 * The top of every screen: where you are, where else you can go, and the two
 * controls that change how everything looks. Labels, not a rail of icons — a
 * learner should never have to hover to find out what a place is called.
 */
export function TopBar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const problem = useApp((s) => s.problem);
  const serverUp = useApp((s) => s.serverUp);
  const stubMode = useApp((s) => s.stubMode);
  const llmConfigured = useApp((s) => s.llmConfigured);
  const canvasId = useApp((s) => s.canvasId);
  const username = useApp((s) => s.username);
  const signedOut = useApp((s) => s.signedOut);
  const theme = usePrefs((s) => s.theme);
  const toggleTheme = usePrefs((s) => s.toggleTheme);

  const navRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeIndex = NAV.findIndex((n) => n.view === view || n.also?.includes(view));

  // The highlight slides to whichever place is open.
  useLayoutEffect(() => {
    const place = () => {
      const nav = navRef.current;
      const btn = activeIndex >= 0 ? (nav?.children[activeIndex + 1] as HTMLElement | undefined) : undefined;
      setInd(btn ? { x: btn.offsetLeft, w: btn.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeIndex]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <button className="brand" onClick={() => setView('problems')} title="Back to the problems">
        <IconMark size={20} />
        Loadbearing
      </button>

      <nav className="nav" ref={navRef} aria-label="Main">
        <span
          className="nav-ind"
          aria-hidden="true"
          style={ind ? { transform: `translateX(${ind.x}px)`, width: ind.w, opacity: 1 } : { opacity: 0, width: 0 }}
        />
        {NAV.map(({ view: v, label, Icon }, i) => (
          <button
            key={v}
            className={i === activeIndex ? 'active' : ''}
            aria-current={i === activeIndex ? 'page' : undefined}
            disabled={v === 'workspace' && !problem}
            title={v === 'workspace' && !problem ? 'Open a problem first' : undefined}
            onClick={() => setView(v)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {/* A project canvas never calls a model, so the grader's state is only news elsewhere. */}
      {serverUp && !canvasId && (stubMode || !llmConfigured) && (
        <button
          className="status-chip"
          onClick={() => setView('settings')}
          title={
            stubMode
              ? 'The server was started with FAKE_LLM=1, which forces the offline stub. Restart it without that variable.'
              : 'Drawing, simulating and checks all work without a model. Add one to have designs reviewed.'
          }
        >
          {stubMode ? 'Reviews are simulated' : 'Reviews off · add a model'}
        </button>
      )}

      {!serverUp && (
        <span className="link-state" title="The server is not answering">
          Offline
        </span>
      )}

      <button
        className="icon-btn ghost theme-btn"
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }}
      >
        <span className="sun">
          <IconSun size={17} />
        </span>
        <span className="moon">
          <IconMoon size={17} />
        </span>
      </button>

      <div style={{ position: 'relative' }} ref={menuRef}>
        <button
          className="avatar"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Account: ${username ?? ''}`}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {(username ?? '').slice(0, 2).toUpperCase()}
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <div className="menu-head">
              <b>{username}</b>
              <span>Signed in</span>
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setView('settings');
              }}
            >
              <IconInstrument size={15} /> Grader model and settings
            </button>
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void api.logout().catch(() => undefined);
                signedOut();
              }}
            >
              <IconSignOut size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
