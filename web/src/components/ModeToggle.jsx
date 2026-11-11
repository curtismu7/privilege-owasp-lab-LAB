// Rule 19: the visible Mock / Real control in the header of every page. Pressed = current mode. Real is disabled with a
// how-to tooltip when it is not configured (the server would answer 409). The parent switches and reloads all data.
export default function ModeToggle({ info, onSwitch, busy = false }) {
  if (!info) return <span className="chip" data-testid="mode-loading">Mode ...</span>;
  const real = info.mode === "real";
  const howTo = info.realAvailable ? "Fetch live, read-only evidence from your PingOne environment" : (info.realHowTo || "Real is not configured. Mock keeps working.");
  return (
    <div className="mode-toggle" role="group" aria-label="Data source: Mock or Real" data-testid="mode-toggle">
      <button type="button" aria-pressed={!real} data-testid="mode-mock" disabled={busy} onClick={() => onSwitch("mock")} title="Canned output, offline">Mock</button>
      <button type="button" aria-pressed={real} data-testid="mode-real" disabled={busy || (!info.realAvailable && !real)} onClick={() => onSwitch("real")} title={howTo} aria-describedby={info.realAvailable ? undefined : "real-howto-tip"}>Real</button>
      {!info.realAvailable && <span id="real-howto-tip" className="sr-only">{howTo}</span>}
    </div>
  );
}
