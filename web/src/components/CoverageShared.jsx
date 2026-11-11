// Shared pieces of the coverage page that App tests import: the collapsible section (open state remembered),
// the open-section event, the scroll behaviour helper and the SSE block parser (the parser also lives in
// CoveragePage for the stream loop; this re-export keeps one definition).
import { useEffect, useRef, useState } from "react";

export const RUN_TIMEOUT_MS = 30000;

const OPEN_EVENT = "privilege-owasp-lab.open-section";
const SECTION_KEY = "privilege-owasp-lab.sectionOpen";

export const openSection = (id) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
export const scrollBehavior = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; } catch { return "auto"; } };

export function parseSseBlock(block) {
  const ev = /^event: (\w+)/m.exec(block);
  const data = /^data: (.+)/m.exec(block);
  if (!ev || !data) return null;
  try { return { type: ev[1], payload: JSON.parse(data[1]) }; } catch { return null; }
}

function readSectionOpenMap() {
  try { const parsed = JSON.parse(localStorage.getItem(SECTION_KEY) || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
}
function writeSectionOpen(id, open) {
  try { localStorage.setItem(SECTION_KEY, JSON.stringify({ ...readSectionOpenMap(), [id]: open })); } catch { /* private mode: still toggles in memory */ }
}

// Collapsible section whose open state is remembered across reloads. forceOpen true/false wins while it is set.
export function CollapsibleSection({ id, title, defaultOpen = true, children, forceOpen = null, level = 2, badge = null }) {
  const [open, setOpen] = useState(() => {
    const saved = readSectionOpenMap()[id];
    return typeof saved === "boolean" ? saved : defaultOpen;
  });
  const ref = useRef(null);
  useEffect(() => {
    if (typeof readSectionOpenMap()[id] !== "boolean") setOpen(defaultOpen);
  }, [id, defaultOpen]);
  useEffect(() => {
    const on = (e) => {
      if (e.detail !== id) return;
      setOpen(true); writeSectionOpen(id, true);
      setTimeout(() => ref.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" }), 0);
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, [id]);
  const toggle = () => setOpen((prev) => { const next = !prev; writeSectionOpen(id, next); return next; });
  const shown = forceOpen === null ? open : Boolean(forceOpen);
  const H = level === 3 ? "h3" : "h2";
  return (
    <section ref={ref} id={`section-${id}`} className={`collapse${shown ? " is-open" : ""}`} data-testid={`section-${id}`}>
      <H className="collapse__heading">
        <button type="button" className="collapse__toggle" aria-expanded={shown} aria-controls={`section-body-${id}`} onClick={toggle}>
          <span aria-hidden="true">{shown ? "▾" : "▸"}</span> {title}
        </button>
        {badge && <span className="collapse__badge">{badge}</span>}
      </H>
      {shown && <div id={`section-body-${id}`} className="collapse__body">{children}</div>}
    </section>
  );
}
