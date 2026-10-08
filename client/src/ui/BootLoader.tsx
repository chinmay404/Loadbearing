/**
 * The boot screen, as React draws it while the session is being checked. The
 * styles live in index.html, because the same screen shows before any of this
 * JavaScript has loaded; reusing them keeps the hand-off seamless.
 */
export function BootLoader() {
  return (
    <div className="boot" role="status" aria-label="Loading Loadbearing">
      <div className="boot-rig" aria-hidden="true">
        <i className="bp" />
        <i className="bw" />
        <i className="bp" />
        <i className="bw" />
        <i className="bp" />
        <b className="bd" />
      </div>
      <p className="boot-word">Loadbearing</p>
      <p className="boot-sub">
        <span>Warming up the bench…</span>
        <span>Still waking the server. The first visit of the day takes a few seconds.</span>
      </p>
    </div>
  );
}
