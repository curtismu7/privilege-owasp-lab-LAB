import { useEffect, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";

// Rule 17: the diagram is diagram-studio/1 data loaded by name (server/diagrams/coverage-flow.json), never hand-built here.
export default function DiagramTab({ vertical, resetSignal }) {
  const [pattern, setPattern] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setPattern(null); getJson(`/api/diagram?vertical=${encodeURIComponent(vertical)}&name=coverage-flow`).then(setPattern, (e) => setError(e.message)); }, [vertical]);
  if (error) return <p className="error" role="alert">Could not load the diagram ({error}).</p>;
  if (!pattern) return <p className="muted">Loading...</p>;
  return <PatternDiagram key={vertical} pattern={pattern} resetSignal={resetSignal} />;
}
