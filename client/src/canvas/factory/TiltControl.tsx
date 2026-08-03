import { useCanvas } from '../../state/canvasStore';

/**
 * Tilt, as a continuum rather than a mode switch.
 *
 * 0° is the flat canvas everyone already knows; 30° is the isometric plant. They
 * are the same drawing and the same numbers seen from a different angle, which is
 * why this is one control with three stops instead of two screens to keep in
 * sync — and why the transition is worth animating: the towers visibly rise out
 * of a plan the learner already understood, which is a better introduction to the
 * metaphor than any amount of explaining.
 *
 * Advanced sheets default flat (20 components read better as a plan); the ladder
 * defaults to the plant.
 */
// Kept module-local: exporting a non-component from a component file costs Fast
// Refresh, and nothing outside needs the stop list.
const TILT_STOPS = [0, 12, 30] as const;

const LABEL: Record<number, string> = {
  0: 'flat floor plan',
  12: 'shallow plant',
  30: 'isometric plant',
};

export function TiltControl() {
  const tilt = useCanvas((s) => s.viewTilt);
  const setTilt = useCanvas((s) => s.setViewTilt);

  return (
    <div className="fx-tilt" role="group" aria-label="Canvas tilt">
      <span className="fx-tilt-label">TILT</span>
      <span className="fx-tilt-end" data-on={tilt === 0} aria-hidden="true">
        ◫
      </span>
      <div className="fx-tilt-track">
        <div className="fx-tilt-rail" />
        {TILT_STOPS.map((t, i) => (
          <button
            key={t}
            type="button"
            className="fx-tilt-stop"
            data-on={tilt === t}
            style={{ left: i * 26 }}
            aria-label={LABEL[t]}
            aria-pressed={tilt === t}
            title={LABEL[t]}
            onClick={() => setTilt(t)}
          />
        ))}
        <div className="fx-tilt-thumb" style={{ left: (tilt / 30) * 58 }} />
      </div>
      <span className="fx-tilt-end" data-on={tilt > 0} aria-hidden="true">
        ◰
      </span>
    </div>
  );
}
