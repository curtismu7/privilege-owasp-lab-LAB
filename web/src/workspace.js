// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
// A duplicated tab copies sessionStorage, so it would share the original's id (and get 409 "run in progress" while the
// other tab runs). claimWorkspace() asks the other tabs over a BroadcastChannel whether one already holds this id; if one
// answers, this tab takes a fresh id. A plain reload keeps its id (no other tab answers).
const KEY = "privilege-owasp-lab.workspace";
const CHANNEL = "privilege-owasp-lab.workspace";
let memo = null;

const newId = () => {
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};
const save = (id) => { try { window.sessionStorage.setItem(KEY, id); } catch { /* blocked */ } };

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && /^[a-z0-9-]{1,40}$/.test(saved)) return (memo = saved); } catch { /* blocked */ }
  memo = newId();
  save(memo);
  return memo;
}

// The claim protocol, kept free of globals so a test can run two "tabs" in one process. getId/setId read and replace
// this tab's id; nonce tells this tab's own messages apart. Returns a close function.
export function startWorkspaceClaim({ getId, setId, nonce, Channel = globalThis.BroadcastChannel, makeId = newId }) {
  if (typeof Channel !== "function") return () => {};
  const ch = new Channel(CHANNEL);
  ch.onmessage = (e) => {
    const d = e.data || {};
    if (d.nonce === nonce || d.id !== getId()) return;
    if (d.type === "who") ch.postMessage({ type: "mine", id: getId(), nonce }); // I hold it: tell the newcomer
    else if (d.type === "mine") { const id = makeId(); setId(id); } // someone else holds it: take a fresh one
  };
  ch.postMessage({ type: "who", id: getId(), nonce });
  return () => ch.close();
}

export function claimWorkspace() {
  return startWorkspaceClaim({ getId: workspaceId, setId: (id) => { memo = id; save(id); }, nonce: newId() });
}

export const workspaceFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
