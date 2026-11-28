import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });

function stubShelf(payload) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = new URL(url, "http://127.0.0.1:7811");
    calls.push(u.pathname);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/shelf") return json(payload);
    return json({ error: "not_found" }, 404);
  }));
  return calls;
}

beforeEach(() => { localStorage.clear(); window.location.hash = ""; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("verification mark in the header", () => {
  test("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    stubShelf({ shelfUrl: "http://shelf.example", demos: [
      { id: "other-lab", verification: mark("in-progress", "In progress") },
      { id: "privilege-owasp-lab", verification: mark("verified", "Verified", { note: "Every dataset read on the mock" }) },
    ] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every dataset read on the mock"));
  });

  test("shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
    for (const payload of [
      { shelfUrl: "http://shelf.example" },
      { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-owasp-lab", verification: null }] },
      { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-owasp-lab", verification: mark("none", "") }] },
    ]) {
      const calls = stubShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      await waitFor(() => expect(calls.filter((c) => c === "/api/shelf").length).toBeGreaterThanOrEqual(2)); // ShelfLink and VerifyMark both asked
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
      vi.unstubAllGlobals();
    }
  });
});
