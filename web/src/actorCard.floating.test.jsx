// The shared evidence ActorCard is a FloatingDialog: it has the movable title bar, and Escape closes it.
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ActorCard from "./evidence/ActorCard";

describe("ActorCard in FloatingDialog", () => {
  test("renders in a FloatingDialog with a drag handle; Escape closes it", () => {
    const onClose = vi.fn();
    render(<ActorCard actorId="gateway" hops={[]} onClose={onClose} />);
    const card = screen.getByRole("dialog", { name: "Gateway actor details" });
    expect(card.classList.contains("fd-panel")).toBe(true);
    expect(within(card).getByTestId("fd-titlebar")).toBeTruthy();
    expect(within(card).getByTestId("actor-card")).toBeTruthy();
    fireEvent.keyDown(within(card).getByRole("button", { name: "Close Gateway details" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
