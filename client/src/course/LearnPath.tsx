import { useEffect } from 'react';
import { COURSE, type Chapter } from '@loadbearing/shared';
import { useApp } from '../state/appStore';
import { NODE_ICONS } from '../canvas/icons';
import { NODE_SPEC } from '../canvas/nodeCatalog';
import { STEP_KIND, chapterOpen, nextStep, stepState, useCourse } from './useCourse';

/**
 * The course, as one path: chapters top to bottom, steps along each. The next step
 * is the one thing on the page that asks for attention.
 */
export function LearnPath() {
  const progress = useCourse((s) => s.progress);
  const loaded = useCourse((s) => s.loaded);
  const load = useCourse((s) => s.load);
  const open = useCourse((s) => s.open);
  const setView = useApp((s) => s.setView);
  const serverUp = useApp((s) => s.serverUp);

  // Asked again when the server comes back, so a blip never shows a learner zero steps.
  useEffect(() => {
    if (serverUp) void load();
  }, [load, serverUp]);

  const next = nextStep(progress);
  const total = COURSE.reduce((n, c) => n + c.steps.length, 0);
  const done = Object.keys(progress).length;

  const go = (stepId: string) => {
    open(stepId);
    setView('lesson');
  };

  return (
    <div className="sheet learn">
      <header className="learn-head">
        <div>
          <span className="chip spec">Pocket Market</span>
          <h1>Build a shop that survives its own success.</h1>
          <p className="lede">One small online shop, from one box to a busy marketplace. Each step is one change, checked by real traffic.</p>
        </div>
        <div className="learn-cta" style={{ visibility: loaded ? 'visible' : 'hidden' }}>
          <div className="learn-count mono">
            {done} / {total} steps
          </div>
          <div className="learn-bar">
            <span style={{ transform: `scaleX(${total ? done / total : 0})` }} />
          </div>
          {next ? (
            <button className="primary learn-go" onClick={() => go(next.id)}>
              {done === 0 ? 'Start' : 'Continue'}: {next.title}
            </button>
          ) : (
            <span className="chip pass">Everything here is done</span>
          )}
        </div>
      </header>

      <div className="chapters">
        {COURSE.map((chapter) => (
          <ChapterCard key={chapter.id} chapter={chapter} onOpen={go} />
        ))}
        <section className="chapter-card soon">
          <div className="ch-head">
            <span className="ch-num mono">3+</span>
            <div>
              <h2>Caches, files, queues and more</h2>
              <p>Six more chapters are on the way.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChapterCard({ chapter, onOpen }: { chapter: Chapter; onOpen: (id: string) => void }) {
  const progress = useCourse((s) => s.progress);
  const unlocked = chapterOpen(chapter, progress);
  const doneHere = chapter.steps.filter((s) => progress[s.id]).length;

  return (
    <section className={`chapter-card${unlocked ? '' : ' locked'}`}>
      <div className="ch-head">
        <span className="ch-num mono">{chapter.number}</span>
        <div className="grow">
          <h2>{chapter.title}</h2>
          <p>{chapter.promise}</p>
        </div>
        {chapter.unlocks.length > 0 && (
          <div className="ch-parts" aria-label="New parts in this chapter">
            {chapter.unlocks.map((t) => {
              const Icon = NODE_ICONS[t];
              return (
                <span key={t} className="ch-part" title={NODE_SPEC[t]?.label}>
                  <Icon size={15} />
                  {NODE_SPEC[t]?.label}
                </span>
              );
            })}
          </div>
        )}
        <span className="ch-done mono">
          {doneHere}/{chapter.steps.length}
        </span>
      </div>
      <ol className="ch-steps">
        {chapter.steps.map((step, i) => {
          const state = stepState(step, progress);
          return (
            <li key={step.id} className={`st st-${state}`}>
              <button disabled={state === 'locked'} onClick={() => onOpen(step.id)} title={step.story}>
                <span className="st-dot">
                  {state === 'done' ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : step.type === 'checkpoint' ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M6 20V5M6 5h11l-2.5 3.5L17 12H6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="mono">{i + 1}</span>
                  )}
                </span>
                <span className="st-text">
                  <span className="st-name">{step.title}</span>
                  <span className="st-kind">{STEP_KIND[step.type]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
