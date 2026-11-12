import { useCallback, useEffect, useState } from "react";
import CoveragePage from "./components/CoveragePage";
import StoryTab from "./components/StoryTab";
import DiagramTab from "./components/DiagramTab";
import TraceTab from "./components/TraceTab";
import TalkTrack from "./components/TalkTrack";
import ModeToggle from "./components/ModeToggle";
import ThemeToggle from "./components/ThemeToggle";
import TopMenu from "./top-menu/TopMenu.jsx";
import "./top-menu/top-menu.css";
import ShelfLink from "./components/ShelfLink";
import ErrorBoundary from "./components/ErrorBoundary";
import { getJson, resetWorkspace, setMode } from "./api";

export const TABS = [
  { id: "coverage", label: "Coverage", title: "OWASP Top 10 — Privilege coverage" },
  { id: "story", label: "Story", title: "The story" },
  { id: "diagram", label: "Diagram", title: "How one dataset loads" },
  { id: "trace", label: "Trace", title: "Hops of the last run" },
  { id: "talk", label: "Talk track", title: "Talk track" },
];
// The banner is never blank: until /api/info answers (or if it fails) it says the safe thing.
export const BANNER_UNKNOWN = "MOCK until the server says otherwise: static deck wording, nothing leaves this machine.";
// Presenter mode: which talk-track sections go with which tab.
const SAY = { coverage: ["The coverage table", "Read a category", "Name the gaps"], story: ["Open"], diagram: ["Follow the hops"], trace: ["Follow the hops"] };

const tabFromHash = () => {
  const h = window.location.hash.replace("#", "");
  if (/^scenario-[a-z0-9-]{1,40}$/.test(h)) return "story";
  return TABS.some((t) => t.id === h) ? h : "coverage";
};

export default function App() {
  const [vertical, setVertical] = useState("retail");
  const [story, setStory] = useState(null);
  const [info, setInfo] = useState(undefined); // undefined = loading, null = failed
  const [tab, setTab] = useState(tabFromHash);
  const [presenter, setPresenter] = useState(false);
  const [dataSignal, setDataSignal] = useState(0); // bump = every panel reloads its data
  const [resetSignal, setResetSignal] = useState(0); // bump = diagram positions and the run view go back to the start
  const [notice, setNotice] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [focusKey, setFocusKey] = useState(null);
  const [switching, setSwitching] = useState(false);

  const loadInfo = useCallback(() => getJson(`/api/info?vertical=${encodeURIComponent(vertical)}`).then(setInfo, () => setInfo(null)), [vertical]);
  useEffect(() => { loadInfo(); }, [loadInfo, dataSignal]);
  useEffect(() => { getJson(`/api/story?vertical=${encodeURIComponent(vertical)}`).then(setStory, () => setStory(null)); }, [vertical, dataSignal]);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const go = (id) => { setTab(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };

  // Rule 19: switch server-side, then reload every panel's data (no page reload, no restart). 409 = Real not configured.
  const switchTo = async (source) => {
    if (!info || info.mode === source) return;
    setSwitching(true);
    const res = await setMode(source).catch(() => ({ ok: false, status: 0, body: {} }));
    setSwitching(false);
    if (!res.ok) { setNotice(res.status === 409 ? `Real is not configured: ${res.body?.detail || "see the how-to"}` : (res.body?.detail || "Could not switch mode.")); return; }
    setLastRun(null);
    setDataSignal((n) => n + 1);
    setNotice(`Switched to ${source === "real" ? "Real" : "Mock"}: all data reloaded.`);
  };

  const reset = async () => {
    const ok = await resetWorkspace().catch(() => false);
    setLastRun(null);
    setResetSignal((n) => n + 1);
    setNotice(ok ? "Reset: the run in flight stopped, the output, trace and diagram positions are back to the start." : "Reset failed on the server; the view was reset.");
  };

  const openCommand = (key) => { setFocusKey(key); go("coverage"); };

  const real = info?.mode === "real";
  const banner = info?.banner || BANNER_UNKNOWN;
  const current = TABS.find((t) => t.id === tab);
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand"><span className="shell-logo" aria-hidden="true">P</span> Privilege OWASP Lab <span className="shell-badge" data-testid="mode-badge">{info ? (real ? "Real" : "Mock") : "..."}</span></span>
        <nav className="shell-nav" aria-label="Lab sections">
          {TABS.map((t) => <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined} data-testid={`nav-${t.id}`} onClick={(e) => { e.preventDefault(); go(t.id); }}>{t.label}</a>)}
        </nav>
        <span className="shell-right">
          <TopMenu
            mode={{ value: real ? "real" : "mock", onChange: (m) => switchTo(m), realAvailable: null }}
            theme={undefined}
            present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter" }}
            onReset={reset}
          >
            <ShelfLink />
          </TopMenu>
        </span>
      </header>
      <main className="page">
        <p className="banner" role="note" data-state={real ? "live" : undefined} data-testid="banner">{banner}</p>
        <div className="page-head">
          <h1>{current.title}</h1>
          <div className="page-tools">
            {!presenter && story && (
              <label className="inline">Vertical{" "}
                <select value={vertical} onChange={(e) => setVertical(e.target.value)} data-testid="vertical">
                  {story.verticals.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="danger-text" onClick={reset} data-testid="reset">Reset</button>
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{notice}</p>
        {notice && !presenter && <p className="muted" data-testid="notice">{notice}</p>}
        {info === null && <p className="error" role="alert">Could not reach the lab server. Is it running?</p>}
        {presenter && story && tab !== "talk" && (
          <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
            {story.talkTrack.filter((t) => (SAY[tab] || ["Open"]).includes(t.title)).map((t) => <p key={t.title}><strong>{t.title}.</strong> {t.say}</p>)}
          </aside>
        )}
        <div role="region" aria-label={current.label}>
          {/* Kept mounted on every tab, so a run streams on while the presenter shows the trace or the diagram. */}
          <div hidden={tab !== "coverage"}><ErrorBoundary resetKey={`${dataSignal}-${resetSignal}`} title="The coverage panel could not be shown" testId="commands-error"><CoveragePage info={info} vertical={vertical} dataSignal={dataSignal} resetSignal={resetSignal} presenter={presenter} onRunDone={setLastRun} focusKey={focusKey} /></ErrorBoundary></div>
          {tab === "story" && (story ? <ErrorBoundary><StoryTab story={story} onOpenCommand={openCommand} /></ErrorBoundary> : <p className="muted">Loading...</p>)}
          {tab === "diagram" && <ErrorBoundary resetKey={resetSignal}><DiagramTab vertical={vertical} resetSignal={resetSignal} /></ErrorBoundary>}
          {tab === "trace" && <ErrorBoundary resetKey={lastRun}><TraceTab run={lastRun} /></ErrorBoundary>}
          {tab === "talk" && (story ? <TalkTrack talk={story.talkTrack} /> : <p className="muted">Loading...</p>)}
        </div>
        <p className="muted foot">Talk track: <a href="#talk" onClick={(e) => { e.preventDefault(); go("talk"); }}>on screen</a> or <code>docs/talk-track.md</code>. Keys: P presenter, Esc leave.</p>
      </main>
    </div>
  );
}
