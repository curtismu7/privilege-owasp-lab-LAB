import { useEffect, useState } from "react";
import SequenceView from "../evidence/SequenceView";
import MovieReel from "../evidence/MovieReel";
import StepDetailPanel from "../evidence/StepDetailPanel";

// Rule 14 + UI pattern 8c: the last run's hops (demo-hop/1, enriched by the server) in the shared evidence screens.
// Every hop shows its raw request and response and its W3C traceparent. Mock hops carry a MOCK tag and MOCK tokens.
export default function TraceTab({ run }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => { setSelected(null); }, [run]);
  if (!run || !run.hops?.length) return <p className="muted" data-testid="trace-empty">Run a command on the Commands tab first; its hops show here.</p>;
  return (
    <div data-testid="trace">
      <p className="lede">
        <strong>{run.label}</strong> <span className={`chip ${run.source === "mock" ? "chip--warn" : "chip--info"}`}><span className="dot" aria-hidden="true" />{run.source === "mock" ? "MOCK hops" : "Real hops"}</span>{" "}
        <span className="muted">trace <code>{run.traceId}</code>. {run.source === "real" ? "The PingOne hops in Real are described, not observed." : "The PingOne hops are simulated; the token is a labelled MOCK value."}</span>
      </p>
      <SequenceView hops={run.hops} selected={selected} onSelect={setSelected} />
      <MovieReel hops={run.hops} selected={selected} onSelect={setSelected} />
      {selected !== null && <StepDetailPanel hops={run.hops} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} />}
    </div>
  );
}
