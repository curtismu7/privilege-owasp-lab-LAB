import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { BANNER_UNKNOWN } from "./App";
import { parseSseBlock } from "./components/CoverageShared";
import ModeToggle from "./components/ModeToggle";

// A fake lab server: just enough of /api for the page, with SSE runs built from a script of frames.
const TABLE = JSON.stringify({ schemaVersion: "1.1", status: "success", message: "OWASP Agentic AI Top 10 coverage (deck p.21)", data: { rows: [
  { id: "ASI01", threat: "Agent Goal Hijack", coveredBy: "AIGuard", state: "covered", how: "Injection, jailbreak and hidden-instruction detection" },
  { id: "ASI04", threat: "Agentic Supply Chain", coveredBy: "AIGuard", state: "gap stated", how: "Tool-definition injection and typosquatting; fingerprint pinning pending" },
  { id: "ASI10", threat: "Rogue Agents", coveredBy: "Gateway", state: "covered", how: "No agent reaches a model, tool or peer without a valid scoped key" },
], footnote: "ASI08 is met by real-time event data to your observability stack." } }, null, 2);
const FORM = JSON.stringify({ schemaVersion: "1.1", status: "success", message: "ASI03 coverage", data: { fields: [
  { key: "category", value: "ASI03 - Identity & Privilege Abuse" },
  { key: "status", value: "COVERED" },
  { key: "the threat", value: "Agents act with credentials; an over-privileged agent turns a compromise into a privilege compromise." },
  { key: "how privilege covers it", value: "Per-user virtual keys, least-privilege scopes, RBAC, live revocation." },
], source: "Privilege Capability Overview deck, page 21" } }, null, 2);
const HOPS = [
  { n: 1, kind: "powasp-read-request", from: "browser", to: "lab", verdict: "ok", mock: true, traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", title: "Read request", narrative: "The page asks the lab", fact: "one dataset key", spec: { none: true, why: "w", failure: "f" }, request: { method: "GET", url: "/api/stream?commandKey=coverage-table" }, response: { status: 200 } },
  { n: 2, kind: "powasp-auth", from: "pingcli", to: "pingone-auth", verdict: "ok", mock: true, traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01", title: "Worker token", narrative: "MOCK token", fact: "worker token issued", spec: { mandate: "m", why: "w", failure: "f", refs: [{ label: "RFC 6749 §4.4", url: "https://www.rfc-editor.org/rfc/rfc6749#section-4.4" }] }, request: { method: "POST", url: "https://auth.pingone.example/e/as/token", body: "client_secret=[write-only]" }, response: { status: 200, body: { access_token: "MOCK-ACCESS-TOKEN-not-a-real-token" } } },
];
const COMMANDS = [
  { key: "coverage-table", title: "The coverage table", category: "Overview", label: "privilege-owasp dataset overview", runnable: true, auth: true, prereqs: [{ title: "The source deck", command: "deck p.21", note: "Mock" }, { title: "How the claims are labelled", command: "static + live", note: "n" }, { title: "Run dataset", command: "privilege-owasp dataset overview", note: "n" }] },
  { key: "asi03", title: "ASI03: Identity and Privilege Abuse", category: "The ten categories", label: "privilege-owasp dataset category", runnable: true, auth: true, prereqs: [{ title: "The source deck", command: "deck p.21" }, { title: "Run dataset", command: "privilege-owasp dataset category" }] },
  { key: "two-layers", title: "Gateway vs AIGuard", category: "Overview", label: "privilege-owasp dataset overview", runnable: true, auth: true, prereqs: [{ title: "The source deck", command: "deck p.21" }, { title: "Run dataset", command: "privilege-owasp dataset overview" }] },
];
const STORY = (v) => ({ intro: `${v === "banking" ? "Dana Okafor at Fabrikam Bank" : "Jordan Ellis at Northwind Retail"} asks what Privilege covers.`, verticals: ["banking", "healthcare", "retail"], scenarios: [{ id: "asi03-identity-abuse", title: "ASI03: Identity and Privilege Abuse", commandKey: "asi03", say: "Least privilege for agents", lesson: "Per-user keys" }], facts: [{ id: "f", status: "UNVERIFIED", text: "summaries are ours" }], talkTrack: [{ title: "Open", say: "Say this first." }, { title: "Follow the hops", say: "Open the hops." }], tokenLabel: "MOCK" });
const sse = (frames, { trailing = true } = {}) => frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}`).join("\n\n") + (trailing ? "\n\n" : "");

let server;
function fakeServer({ realAvailable = false, runText = TABLE, trailing = true, runStatus = 200, refuseReal = false, done = { exitCode: 0 }, version = null, versionStatus = 200 } = {}) {
  const s = { mode: "mock", calls: [] };
  s.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(url, "http://127.0.0.1:7810");
    const method = opts.method || "GET";
    s.calls.push(`${method} ${u.pathname}`);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/info") return json({ mode: s.mode, source: s.mode, realAvailable, realHowTo: realAvailable ? null : "Real needs PINGONE_ENVIRONMENT_ID in ~/Development/.env", banner: s.mode === "mock" ? "MOCK: no PingOne tenant is contacted and nothing leaves this machine." : "REAL: live evidence is fetched read-only." });
    if (u.pathname === "/api/mode") {
      const { source } = JSON.parse(opts.body);
      if (source === "real" && (!realAvailable || refuseReal)) return json({ error: "real_not_configured", detail: "not configured" }, 409);
      s.mode = source; return json({ source });
    }
    if (u.pathname === "/api/story") return json(STORY(u.searchParams.get("vertical")));
    if (u.pathname === "/api/commands") return json(COMMANDS);
    if (u.pathname === "/api/version") return versionStatus === 200 ? json(version || { version: "static-deck-2026-11-02", source: s.mode }) : json({ error: "binary not installed" }, versionStatus);
    if (u.pathname === "/api/reset") return json({ reset: "ok" });
    if (u.pathname === "/api/shelf") return json({ shelfUrl: null });
    if (u.pathname === "/api/diagram") return json({ title: "One coverage dataset", intro: "i", nodes: [{ id: "browser", label: "Browser", kind: "client", x: 0, y: 0 }, { id: "lab", label: "Lab", kind: "lab", x: 300, y: 0 }], steps: [{ from: "browser", to: "lab", label: "Open a dataset", say: "s" }] });
    if (u.pathname === "/api/stream") {
      if (runStatus !== 200) return json({ error: "run_in_progress", detail: "busy" }, runStatus);
      const cmd = COMMANDS.find((c) => c.key === u.searchParams.get("commandKey")) || COMMANDS[0];
      const text = cmd.key === "asi03" ? FORM : runText;
      const half = Math.floor(text.length / 2);
      return new Response(sse([["meta", { command: cmd.label, source: s.mode, prereqs: cmd.prereqs }], ["chunk", { text: text.slice(0, half) }], ["chunk", { text: text.slice(half) }], ["done", { source: s.mode, traceId: "0af7651916cd43dd8448eb211c80319c", hops: HOPS, ...done }]], { trailing }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return json({ error: "not_found" }, 404);
  });
  return s;
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  delete document.documentElement.dataset.theme;
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const runTable = async () => {
  await screen.findByTestId("run-coverage-table");
  fireEvent.click(screen.getByTestId("run-coverage-table"));
  await screen.findByTestId("coverage-table");
};

describe("shell, banner and mode", () => {
  test("the dark shell bar comes first, then the banner is the first thing in the page, before the title", async () => {
    render(<App />);
    const bar = document.querySelector("header.shell-bar");
    expect(bar).toBeTruthy();
    const main = document.querySelector("main.page");
    expect(main.firstElementChild).toBe(screen.getByTestId("banner"));
    expect(screen.getByTestId("banner")).toHaveAttribute("role", "note");
    expect(screen.getByTestId("banner").textContent).toBe(BANNER_UNKNOWN);
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toMatch(/^MOCK: no PingOne tenant/));
    expect(screen.getByTestId("mode-badge").textContent).toBe("Mock");
    expect(within(bar).getByTestId("nav-coverage")).toHaveAttribute("aria-current", "page");
  });

  test("Real unconfigured: the Real option is disabled with the how-to as its tooltip, and the how-to card shows", async () => {
    render(<App />);
    const real = await screen.findByTestId("mode-real");
    expect(real).toBeDisabled();
    expect(real.getAttribute("title")).toMatch(/PINGONE_ENVIRONMENT_ID/);
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    expect(await screen.findByTestId("real-howto")).toHaveTextContent(/Real mode is not configured/);
  });

  test("the toggle switches both ways through POST /api/mode and reloads every panel's data", async () => {
    server = fakeServer({ realAvailable: true }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    const select = screen.getByTestId("mode-select");
    await waitFor(() => expect(screen.getByTestId("mode-real")).not.toBeDisabled());
    const before = server.calls.filter((c) => c === "GET /api/commands").length;
    fireEvent.change(select, { target: { value: "real" } });
    await waitFor(() => expect(screen.getByTestId("mode-badge").textContent).toBe("Real"));
    expect(server.calls).toContain("POST /api/mode");
    await waitFor(() => expect(server.calls.filter((c) => c === "GET /api/commands").length).toBeGreaterThan(before));
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "live");
    fireEvent.change(screen.getByTestId("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(screen.getByTestId("mode-badge").textContent).toBe("Mock"));
    expect(screen.getByTestId("banner")).not.toHaveAttribute("data-state");
  });

  test("a 409 from /api/mode is reported and the mode stays Mock", async () => {
    server = fakeServer({ realAvailable: true, refuseReal: true }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    const select = screen.getByTestId("mode-select");
    await waitFor(() => expect(screen.getByTestId("mode-real")).not.toBeDisabled());
    fireEvent.change(select, { target: { value: "real" } });
    expect(await screen.findByTestId("notice")).toHaveTextContent(/Real is not configured/);
    expect(screen.getByTestId("mode-badge").textContent).toBe("Mock");
  });
});

describe("loading a dataset", () => {
  test("SSE load: MOCK label, exit chip, the slide-21 table with the gap rows, then the footnote", async () => {
    render(<App />);
    await runTable();
    expect(screen.getByTestId("mock-output")).toHaveTextContent("MOCK data");
    expect(screen.getByTestId("exit-chip")).toHaveTextContent("exit 0");
    expect(screen.getByTestId("run-status")).toHaveTextContent(/Done/);
    const table = screen.getByTestId("coverage-table");
    expect(table).toHaveTextContent("Agent Goal Hijack");
    expect(table).toHaveTextContent("Rogue Agents");
    expect(table.textContent).toContain("gap stated");
    expect(screen.getByTestId("row-ASI04").textContent).toContain("fingerprint pinning pending");
    expect(screen.getByTestId("coverage-footnote")).toHaveTextContent(/ASI08/);
  });

  test("a category dataset renders the key/value form with the status chip", async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-asi03"));
    const form = await screen.findByTestId("category-form");
    await waitFor(() => expect(screen.getByTestId("exit-chip")).toHaveTextContent("exit 0"));
    expect(form).toHaveTextContent("ASI03 - Identity & Privilege Abuse");
    expect(form).toHaveTextContent("COVERED");
    expect(form).toHaveTextContent("Per-user virtual keys");
  });

  test("hostile output stays inert text: markup is not parsed, bidi and ANSI escapes become visible escapes", async () => {
    const evil = `<img src=x onerror="window.__pwned=1"> ‮evil‬ \u001b[31mred\u001b[0m`;
    server = fakeServer({ runText: evil }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-coverage-table"));
    const raw = await screen.findByTestId("raw-output");
    await waitFor(() => expect(screen.getByTestId("exit-chip")).toBeTruthy());
    expect(document.querySelector("main img")).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(raw.textContent).toContain("<img src=x");
    expect(raw.textContent).toContain("\\u202e");
    expect(raw.textContent).toContain("\\u001b[31m");
    expect(raw.textContent).not.toMatch(/[‮\u001b]/);
  });

  test("a 409 (run in progress) is reported as the reason, the buttons come back", async () => {
    server = fakeServer({ runStatus: 409 }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-coverage-table"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent(/Another run is in progress/);
    await waitFor(() => expect(screen.getByTestId("run-coverage-table")).not.toBeDisabled());
  });

  test("parseSseBlock skips a corrupt frame", () => {
    expect(parseSseBlock("event: chunk\ndata: {bad")).toBeNull();
    expect(parseSseBlock('event: chunk\ndata: {"text":"a"}')).toEqual({ type: "chunk", payload: { text: "a" } });
  });

  test("sections remember open/closed across renders", async () => {
    render(<App />);
    const toggle = within(await screen.findByTestId("section-categories")).getAllByRole("button")[0];
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(JSON.parse(localStorage.getItem("privilege-owasp-lab.sectionOpen")).categories).toBe(false);
    cleanup();
    render(<App />);
    expect(within(await screen.findByTestId("section-categories")).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
  });
});

describe("review fixes", () => {
  test("BLOCKING: 50000-deep JSON output renders as inert raw text; the shell, banner and toggle stay", async () => {
    const deep = `${"[".repeat(50000)}${"]".repeat(50000)}`;
    server = fakeServer({ runText: deep }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-coverage-table"));
    await waitFor(() => expect(screen.getByTestId("exit-chip")).toHaveTextContent("exit 0"));
    expect(screen.getByTestId("raw-output").textContent.startsWith("[[[[")).toBe(true);
    expect(document.querySelector("header.shell-bar")).toBeTruthy();
    expect(screen.getByTestId("banner")).toBeTruthy();
    expect(screen.getByTestId("mode-select")).toBeTruthy();
  });

  test("a render failure in the output shows an error card and keeps the page (error boundary)", async () => {
    const ErrorBoundary = (await import("./components/ErrorBoundary")).default;
    const Boom = () => { throw new Error("boom <b>not markup</b>"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<div><p data-testid="outside">still here</p><ErrorBoundary testId="eb"><Boom /></ErrorBoundary></div>);
    spy.mockRestore();
    expect(screen.getByTestId("eb")).toHaveTextContent("boom <b>not markup</b>");
    expect(screen.getByTestId("eb").querySelector("b")).toBeNull();
    expect(screen.getByTestId("outside")).toBeTruthy();
  });

  test("a timeout keeps the output and shows the reason on its own line", async () => {
    server = fakeServer({ runText: "hanging\n", done: { exitCode: 1, error: "timed out after 15000 ms" } }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-coverage-table"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent("timed out after 15000 ms");
    expect(screen.getByTestId("raw-output").textContent).toBe("hanging\n");
    expect(screen.getByTestId("run-status")).toHaveTextContent(/Failed/);
  });

  test("a plain failure with output shows both; a success shows no reason line", async () => {
    server = fakeServer({ runText: "Error: forbidden\n", done: { exitCode: 1, error: "exit status 1" } }); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    fireEvent.click(await screen.findByTestId("run-coverage-table"));
    expect(await screen.findByTestId("run-error")).toHaveTextContent("exit status 1");
    expect(screen.getByTestId("raw-output")).toHaveTextContent("Error: forbidden");
    cleanup();
    server = fakeServer(); vi.stubGlobal("fetch", server.fetch);
    render(<App />);
    await runTable();
    expect(screen.queryByTestId("run-error")).toBeNull();
  });
});

describe("shell navigation and reset", () => {
  test("Reset calls the API, clears the run and the trace", async () => {
    render(<App />);
    await runTable();
    fireEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(server.calls).toContain("POST /api/reset"));
    await waitFor(() => expect(screen.queryByTestId("output")).toBeNull());
    fireEvent.click(screen.getByTestId("nav-trace"));
    expect(screen.getByTestId("trace-empty")).toBeTruthy();
  });

  test("Diagram loads by name and has Simulate and the positions reset", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("nav-diagram"));
    expect(await screen.findByTestId("pattern-reset")).toBeTruthy();
    expect(server.calls.some((c) => c === "GET /api/diagram")).toBe(true);
    expect(screen.getByTestId("pattern-step-bar")).toBeTruthy();
  });

  test("Trace shows the run hops with traceparent (shared evidence screens)", async () => {
    render(<App />);
    await runTable();
    fireEvent.click(screen.getByTestId("nav-trace"));
    await screen.findByTestId("trace");
    expect(screen.getByTestId("trace").textContent).toMatch(/MOCK hops/);
  });
});
