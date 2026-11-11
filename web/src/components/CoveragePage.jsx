// The coverage page: the slide-21 table and the category cards, ported from AI-DEMO2's PrivilegeOwaspTop10Page
// (read-only source, never imported) onto the Ping UI standard. Same data shape as the AI-DEMO2 page:
// ID, threat, covered by (pill), how; the two stated gaps carry a gap chip.
// Differences: datasets come from the lab API (GET /api/commands, streamed via /api/stream), colours from tokens only,
// every piece of output is React text passed through visible(), and output is bounded on the client too.
import { useCallback, useEffect, useRef, useState } from "react";
import { visible } from "../safeText";
import { getJson } from "../api";
import { workspaceFetch } from "../workspace";
import ErrorBoundary from "./ErrorBoundary";
import { CollapsibleSection, openSection, scrollBehavior, parseSseBlock } from "./CoverageShared";

// Re-exported so App.test keeps one import site for the shared pieces.
export { CollapsibleSection, openSection, scrollBehavior, parseSseBlock };

// Client-side cap on how long a streamed dataset may take before it is aborted.
export const RUN_TIMEOUT_MS = 30000;
// The server caps output at 1 MiB; the page caps what it keeps too.
export const MAX_OUTPUT_CHARS = 2_000_000;

const GAP_IDS = new Set(["asi04", "asi06"]);

function RealHowTo({ info }) {
  if (!info || info.realAvailable) return null;
  return (
    <div className="card card--neutral howto" data-testid="real-howto">
      <h3>Real mode is not configured</h3>
      <p><span className="chip chip--info"><span className="dot" aria-hidden="true" />Mock</span> {info.realHowTo || "Real is not configured. Mock keeps working."}</p>
      <ol>
        <li>Put <code>PINGONE_ENVIRONMENT_ID</code>, <code>PINGONE_REGION</code>, <code>PINGONE_CLIENT_ID</code> and <code>PINGONE_CLIENT_SECRET</code> (a worker app with read roles) in <code>~/Development/.env</code>.</li>
        <li>Restart the lab, then press Real in the header. Evidence is fetched read-only; the secret is write-only: never shown, logged or returned.</li>
      </ol>
    </div>
  );
}

function CoverageTable({ rows, footnote }) {
  return (
    <div className="results" data-testid="coverage-table">
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th scope="col">ID</th><th scope="col">Threat</th><th scope="col">Covered by</th><th scope="col">How</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`row-${r.id}`}>
                <td className="mono id-cell">{visible(String(r.id))}</td>
                <td>{visible(String(r.threat))}</td>
                <td><span className={`chip ${r.state === "gap stated" ? "chip--warn" : "chip--ok"}`}><span className="dot" aria-hidden="true" />{visible(String(r.coveredBy))}{r.state === "gap stated" ? " · gap stated" : ""}</span></td>
                <td className={r.state === "gap stated" ? "gap-cell" : ""}>{visible(String(r.how))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && <p className="hint" data-testid="coverage-footnote">{visible(footnote)}</p>}
    </div>
  );
}

function CategoryForm({ fields, source }) {
  return (
    <div className="results" data-testid="category-form">
      <p className="results__head">
        <span className={`chip ${String(fields.find((f) => f.key === "status")?.value || "").includes("GAP") ? "chip--warn" : "chip--ok"}`}><span className="dot" aria-hidden="true" />{visible(String(fields.find((f) => f.key === "status")?.value || ""))}</span>
        <span className="muted">{visible(source || "")}</span>
      </p>
      <dl className="kv">
        {fields.map((f) => (
          <div key={f.key} className="kv__row">
            <dt>{visible(f.key)}</dt>
            <dd className={GAP_IDS.has(f.key) || f.key === "stated gap" ? "gap-cell" : ""}>{f.value === "" ? "—" : visible(f.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DataView({ output, running }) {
  // Easy read first: the dataset shapes are ours (coverage table, category form).
  let parsed = null;
  try { parsed = JSON.parse(output); } catch { /* streamed partial or text */ }
  if (parsed && typeof parsed === "object" && parsed.data) {
    if (Array.isArray(parsed.data.rows)) return <CoverageTable rows={parsed.data.rows} footnote={parsed.data.footnote} />;
    if (Array.isArray(parsed.data.fields)) return <CategoryForm fields={parsed.data.fields} source={parsed.data.source} />;
  }
  return (
    <pre className="terminal__body" tabIndex={0} aria-label="Dataset output" data-testid="raw-output">{running ? "Running..." : output ? visible(output) : "(no output)"}</pre>
  );
}

export default function CoveragePage({ info, vertical, dataSignal = 0, resetSignal = 0, presenter = false, onRunDone = () => {}, focusKey = null }) {
  const [commands, setCommands] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [running, setRunning] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [cmdLabel, setCmdLabel] = useState("");
  const [output, setOutput] = useState("");
  const [exitCode, setExitCode] = useState(null);
  const [prereqs, setPrereqs] = useState([]);
  const [source, setSource] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [runError, setRunError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const abortRef = useRef(null);
  const outputRef = useRef(null);

  const clearRun = useCallback(() => {
    abortRef.current?.abort();
    setRunning(null); setActiveKey(null); setCmdLabel(""); setOutput(""); setExitCode(null); setPrereqs([]); setRunStatus(null); setSource(null); setRunError(null);
  }, []);
  useEffect(() => {
    clearRun();
    setLoadError(null);
    getJson(`/api/commands?vertical=${encodeURIComponent(vertical)}`).then(setCommands, (e) => setLoadError(e.message));
  }, [dataSignal, vertical, clearRun]);
  const seenReset = useRef(resetSignal);
  useEffect(() => { if (seenReset.current !== resetSignal) { seenReset.current = resetSignal; clearRun(); } }, [resetSignal, clearRun]);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`card-${focusKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusKey, commands]);

  const byKey = Object.fromEntries(commands.map((c) => [c.key, c]));
  const categories = [];
  for (const c of commands) { if (!categories.includes(c.category)) categories.push(c.category); }

  const copyCmd = (key, text) => { try { navigator.clipboard?.writeText(text).catch(() => {}); } catch { /* no clipboard */ } setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); };

  const run = async (commandKey) => {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const human = byKey[commandKey]?.title || commandKey;
    setRunning(commandKey); setActiveKey(commandKey); setCmdLabel(""); setOutput(""); setExitCode(null);
    setRunError(null); setRunStatus({ phase: "running", key: commandKey, label: human });
    setPrereqs(Array.isArray(byKey[commandKey]?.prereqs) ? byKey[commandKey].prereqs : []);

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, RUN_TIMEOUT_MS);
    let sawDone = false;
    let finalExit = null;
    let kept = 0;
    const finish = (code) => { finalExit = code; setExitCode(code); };
    const append = (text) => {
      if (kept >= MAX_OUTPUT_CHARS) return;
      const piece = String(text).slice(0, MAX_OUTPUT_CHARS - kept);
      kept += piece.length;
      setOutput((prev) => prev + piece + (kept >= MAX_OUTPUT_CHARS ? "\n[output truncated by the page]" : ""));
    };
    try {
      const res = await workspaceFetch(`/api/stream?commandKey=${encodeURIComponent(commandKey)}&vertical=${encodeURIComponent(vertical)}`, { signal: controller.signal });
      if (!res.ok || !res.body) {
        let detail = "";
        try { const b = await res.json(); detail = b.detail || b.error || ""; } catch { /* not JSON */ }
        setRunError(res.status === 409 ? `Another run is in progress in this workspace (${detail || "409"}). Wait for it, or press Reset.` : `Could not run: HTTP ${res.status}${detail ? ` (${detail})` : ""}`);
        finish(1);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const apply = (block) => {
        const ev = parseSseBlock(block);
        if (!ev) return;
        const { type, payload } = ev;
        if (type === "meta") {
          setCmdLabel(String(payload.command || ""));
          setSource(payload.source || null);
          if (Array.isArray(payload.prereqs)) setPrereqs(payload.prereqs);
        } else if (type === "chunk") {
          append(payload.text ?? "");
        } else if (type === "done") {
          sawDone = true;
          if (payload.error) setRunError(String(payload.error).slice(0, 500));
          finish(Number.isInteger(payload.exitCode) ? payload.exitCode : 0);
          onRunDone({ commandKey, label: human, source: payload.source, traceId: payload.traceId, hops: Array.isArray(payload.hops) ? payload.hops : [], exitCode: payload.exitCode });
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop();
        for (const b of blocks) apply(b);
      }
      buf += decoder.decode();
      if (buf.trim()) for (const b of buf.split("\n\n")) apply(b);
      if (!sawDone) finish(0);
    } catch (err) {
      if (err?.name === "AbortError") {
        if (timedOut) { setRunError(`The page stopped waiting after ${RUN_TIMEOUT_MS / 1000} seconds.`); finish(1); }
        else if (!sawDone) finish(finalExit === null ? 1 : finalExit);
      } else { setRunError(String(err?.message || err).slice(0, 500)); finish(1); }
    } finally {
      clearTimeout(timer);
      setRunning((r) => (r === commandKey ? null : r));
      setRunStatus({ phase: "done", key: commandKey, label: human, exitCode: finalExit === null ? 0 : finalExit });
    }
  };

  const showResult = running !== null || exitCode !== null || output !== "";
  const resultCategory = activeKey ? byKey[activeKey]?.category : null;

  const resultPanel = (showResult || runStatus) ? (
    <div ref={outputRef} className="output" data-testid="output">
      {runStatus && (
        <div className="run-status" role="status" aria-live="polite" aria-busy={runStatus.phase === "running"} data-testid="run-status">
          {runStatus.phase === "running"
            ? <><span className="chip chip--info"><span className="dot" aria-hidden="true" />Loading</span> {runStatus.label}...</>
            : <><span className={`chip ${runStatus.exitCode === 0 ? "chip--ok" : "chip--danger"}`}><span className="dot" aria-hidden="true" />{runStatus.exitCode === 0 ? "Done" : "Failed"}</span> <strong>{runStatus.label}</strong> (exit {runStatus.exitCode})</>}
        </div>
      )}
      {runError && <p className="run-error" role="alert" data-testid="run-error"><span className="chip chip--danger"><span className="dot" aria-hidden="true" />Reason</span> {visible(runError)}</p>}
      {showResult && prereqs.length > 0 && (
        <p className="chain" data-testid="prereq-chain">
          {prereqs.map((p) => <span key={p.title} className="chain__step"><span className="muted">{visible(p.title)}</span><span className="chain__arrow" aria-hidden="true"> → </span></span>)}
          <span className="chain__cmd">{cmdLabel ? <code>{visible(cmdLabel)}</code> : null}</span>
        </p>
      )}
      {showResult && (
        <CollapsibleSection id="response" title="Dataset output" forceOpen={running !== null ? true : null}>
          <ErrorBoundary title="This output could not be shown" testId="output-error">
            <div className="terminal" data-testid="terminal">
              <div className="terminal__head">
                <code className="terminal__prompt">$ {cmdLabel || "..."}</code>
                {source === "mock" && <span className="chip chip--warn" data-testid="mock-output"><span className="dot" aria-hidden="true" />MOCK data</span>}
                {source === "real" && <span className="chip chip--info"><span className="dot" aria-hidden="true" />Real evidence</span>}
                {exitCode !== null && <span className={`chip ${exitCode === 0 ? "chip--ok" : "chip--danger"}`} data-testid="exit-chip"><span className="dot" aria-hidden="true" />exit {exitCode}</span>}
              </div>
              <DataView output={output} running={running !== null} />
            </div>
          </ErrorBoundary>
        </CollapsibleSection>
      )}
    </div>
  ) : null;

  return (
    <div className="powasp">
      <p className="lede">The OWASP Agentic AI Top 10, with what PingOne Privilege covers. Pick a dataset to load it{info?.mode === "real" ? " (Real adds live, read-only evidence from your environment)" : " in Mock (static deck wording, nothing leaves this machine)"}.</p>
      <RealHowTo info={info} />
      <CollapsibleSection id="coverage-table-section" title="1. The slide-21 coverage table" defaultOpen>
        <p className="hint">Ten rows, one per ASI category. Green pills for full coverage, amber for the two stated gaps. The deck's footnote sits under the table.</p>
        <div className="card-grid">
          <div className={`card${activeKey === "coverage-table" ? "" : " card--neutral"}`} id="card-coverage-table" data-testid="card-coverage-table">
            <div className="cmd__top">
              <h3>The coverage table</h3>
              <button type="button" onClick={() => copyCmd("coverage-table", byKey["coverage-table"]?.label || "")} title="Copy">{copiedKey === "coverage-table" ? "Copied!" : "Copy"}</button>
            </div>
            <code className="cmd__label" title={byKey["coverage-table"]?.label}>{byKey["coverage-table"]?.label || "..."}</code>
            <button type="button" className="cmd__run" data-testid="run-coverage-table" disabled={running !== null} aria-busy={running === "coverage-table"} onClick={() => run("coverage-table")}>{running === "coverage-table" ? "Loading..." : runStatus?.phase === "done" && runStatus.key === "coverage-table" ? (runStatus.exitCode === 0 ? "Done" : "Failed") : "Load"}</button>
          </div>
          <div className={`card${activeKey === "two-layers" ? "" : " card--neutral"}`} id="card-two-layers" data-testid="card-two-layers">
            <div className="cmd__top">
              <h3>Gateway vs AIGuard</h3>
              <button type="button" onClick={() => copyCmd("two-layers", byKey["two-layers"]?.label || "")} title="Copy">{copiedKey === "two-layers" ? "Copied!" : "Copy"}</button>
            </div>
            <code className="cmd__label" title={byKey["two-layers"]?.label}>{byKey["two-layers"]?.label || "..."}</code>
            <button type="button" className="cmd__run" data-testid="run-two-layers" disabled={running !== null} aria-busy={running === "two-layers"} onClick={() => run("two-layers")}>{running === "two-layers" ? "Loading..." : runStatus?.phase === "done" && runStatus.key === "two-layers" ? (runStatus.exitCode === 0 ? "Done" : "Failed") : "Load"}</button>
          </div>
        </div>
        {resultCategory === "Overview" && resultPanel}
      </CollapsibleSection>

      <CollapsibleSection id="categories" title="2. The ten categories" forceOpen={resultPanel && resultCategory === "The ten categories" ? true : null}>
        <p className="hint">One dataset per ASI category: the threat in plain language, who covers it, how, and the stated gap where there is one.</p>
        {loadError && <p className="error" role="alert">Could not load the datasets ({loadError}).</p>}
        <div className="card-grid cmd-grid">
          {commands.filter((c) => /^asi\d\d$/.test(c.key)).map((c) => {
            const isRunning = running === c.key;
            const isDone = runStatus?.phase === "done" && runStatus.key === c.key;
            const gap = GAP_IDS.has(c.key);
            return (
              <div key={c.key} id={`card-${c.key}`} className={`card${activeKey === c.key ? "" : " card--neutral"}`} data-testid={`card-${c.key}`}>
                <div className="cmd__top">
                  <h3>{c.title}</h3>
                  {gap && <span className="chip chip--warn"><span className="dot" aria-hidden="true" />gap stated</span>}
                </div>
                <code className="cmd__label" title={c.label}>{c.label}</code>
                <button type="button" className="cmd__run" data-testid={`run-${c.key}`} disabled={isRunning || running !== null} aria-busy={isRunning} onClick={() => run(c.key)}>{isRunning ? "Loading..." : isDone ? (runStatus.exitCode === 0 ? "Done" : "Failed") : "Load"}</button>
              </div>
            );
          })}
        </div>
        {resultCategory === "The ten categories" && resultPanel}
      </CollapsibleSection>

      <CollapsibleSection id="live-evidence-section" title="3. Live evidence (Real)" defaultOpen={false}>
        <p className="hint">Real mode fetches read-only evidence from your PingOne environment beside the static claims. Mock replays the placeholder checks.</p>
        <div className="card-grid">
          <div className={`card${activeKey === "live-evidence" ? "" : " card--neutral"}`} id="card-live-evidence" data-testid="card-live-evidence">
            <div className="cmd__top">
              <h3>Live evidence</h3>
              <button type="button" onClick={() => copyCmd("live-evidence", byKey["live-evidence"]?.label || "")} title="Copy">{copiedKey === "live-evidence" ? "Copied!" : "Copy"}</button>
            </div>
            <code className="cmd__label" title={byKey["live-evidence"]?.label}>{byKey["live-evidence"]?.label || "..."}</code>
            <button type="button" className="cmd__run" data-testid="run-live-evidence" disabled={running !== null} aria-busy={running === "live-evidence"} onClick={() => run("live-evidence")}>{running === "live-evidence" ? "Loading..." : runStatus?.phase === "done" && runStatus.key === "live-evidence" ? (runStatus.exitCode === 0 ? "Done" : "Failed") : "Load"}</button>
          </div>
        </div>
        {resultCategory === "Overview" && activeKey === "live-evidence" && resultPanel}
      </CollapsibleSection>
    </div>
  );
}
