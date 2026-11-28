import { useEffect, useMemo, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";

/** The run's hops as the kit's call data, one entry per arrow. A hop whose boxes the diagram lacks
 * (pingcli sits inside the lab; pingone-api/pingone-auth map to the diagram's token/api boxes) draws nothing. */
const HOP_NODE = { pingone: "token", "pingone-auth": "token", "pingone-api": "api" };

export function hopCalls(run) {
  if (!run || !Array.isArray(run.hops)) return [];
  return run.hops
    .map((h) => ({ from: HOP_NODE[h.from] ?? h.from, to: HOP_NODE[h.to] ?? h.to, hop: { title: h.label ?? h.kind, fact: h.fact ?? h.label ?? "", verdict: h.verdict ?? "ok", request: h.request, response: h.response } }))
    .filter((c) => c.from !== c.to);
}

// Rule 17: the diagram is diagram-studio/1 data loaded by name (server/diagrams/coverage-flow.json), never hand-built here.
export default function DiagramTab({ vertical, resetSignal, run = null }) {
  const [pattern, setPattern] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setPattern(null); getJson(`/api/diagram?vertical=${encodeURIComponent(vertical)}&name=coverage-flow`).then(setPattern, (e) => setError(e.message)); }, [vertical]);
  // The last run's hops ride on the matching arrows: the expanded box shows what went over the wire.
  const withHops = useMemo(() => {
    if (!pattern) return null;
    const calls = hopCalls(run);
    if (!calls.length) return pattern;
    const steps = pattern.steps.map((st) => ({ ...st }));
    let ci = 0;
    for (const st of steps) if (st.from === calls[ci]?.from && st.to === calls[ci]?.to) st.hop = calls[ci++].hop;
    return { ...pattern, steps };
  }, [pattern, run]);
  if (error) return <p className="error" role="alert">Could not load the diagram ({error}).</p>;
  if (!withHops) return <p className="muted">Loading...</p>;
  return <PatternDiagram key={vertical} pattern={withHops} resetSignal={resetSignal} />;
}
