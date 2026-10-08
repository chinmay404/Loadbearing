export type GoalState = 'pending' | 'pass' | 'fail';

/**
 * The circle beside a goal: empty while unchecked, a drawn tick when it passes, a
 * cross when it fails. One drawing for the lesson and the brief, so a goal looks
 * the same wherever it is asked of you.
 */
export function GoalMark({ state }: { state: GoalState }) {
  return (
    <span className="goal-mark" data-state={state} aria-hidden="true">
      {state === 'pass' ? (
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="9" />
          <path d="M6 10.4l2.7 2.7L14.2 7.6" />
        </svg>
      ) : state === 'fail' ? (
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8.2" />
          <path d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8.2" />
        </svg>
      )}
    </span>
  );
}
