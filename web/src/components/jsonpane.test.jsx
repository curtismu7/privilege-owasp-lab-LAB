// JsonPane tests (vitest + Testing Library + jsdom). Run where the file is vendored
// (web/src/components/, next to web/src/safeText.js) — see shared/gateway-trace/gateway-trace.test.jsx.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { Json, setJsonView } from "./JsonPane";

beforeEach(() => setJsonView("form"));

describe("JsonPane Form view: single-href link objects collapse", () => {
  test("a one-key { href } object shows the parent key with the URL as its value, no nested href row", () => {
    render(<Json value={{ _links: { branding: { href: "https://api.pingone.com/v1/branding" } } }} testId="links" />);
    const row = screen.getByText("branding").closest(".jform__row");
    expect(row).not.toBeNull();
    expect(screen.queryByText("href")).toBeNull();
    const url = row.querySelector(".jform__v--url");
    expect(url).not.toBeNull();
    expect(url).toHaveTextContent("https://api.pingone.com/v1/branding");
  });

  test("a multi-key object and an array of href objects stay nested as before", () => {
    render(
      <Json
        value={{
          _links: {
            multi: { href: "https://api.pingone.com/v1/x", method: "GET" },
            list: [{ href: "https://api.pingone.com/v1/a" }],
          },
        }}
        testId="links2"
      />
    );
    expect(screen.getByText("multi")).toBeInTheDocument();
    expect(screen.getByText("href")).toBeInTheDocument();
    expect(screen.getByText("method")).toBeInTheDocument();
    expect(screen.getByText("list")).toBeInTheDocument();
  });
});
