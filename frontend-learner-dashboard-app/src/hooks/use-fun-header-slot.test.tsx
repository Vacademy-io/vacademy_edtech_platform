// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  offerFunHeaderSlot,
  resetFunHeaderSlotForTests,
  useClaimFunHeaderSlot,
  useFunHeaderSlot,
  useFunHeaderSlotClaimed,
} from "./use-fun-header-slot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: { slot: HTMLElement | null; claimed: boolean } = { slot: null, claimed: false };
function Bar() {
  seen = { slot: useFunHeaderSlot(), claimed: useFunHeaderSlotClaimed() };
  return null;
}
function Home({ active }: { active: boolean }) {
  useClaimFunHeaderSlot(active);
  return null;
}

afterEach(() => resetFunHeaderSlotForTests());

describe("the Fun header slot", () => {
  it("is offered by the bar and claimed only while the home holds it", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Bar />));
    expect(seen).toEqual({ slot: null, claimed: false });

    const slot = document.createElement("div");
    act(() => offerFunHeaderSlot(slot));
    expect(seen.slot).toBe(slot);
    expect(seen.claimed).toBe(false);

    act(() => root.render(<><Bar /><Home active /></>));
    expect(seen.claimed).toBe(true);

    act(() => root.render(<><Bar /><Home active={false} /></>));
    expect(seen.claimed).toBe(false);

    act(() => root.render(<><Bar /><Home active /></>));
    act(() => root.render(<Bar />));
    expect(seen.claimed).toBe(false);

    act(() => offerFunHeaderSlot(null));
    expect(seen.slot).toBeNull();
    act(() => root.unmount());
  });
});
