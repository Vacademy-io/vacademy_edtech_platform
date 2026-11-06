// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeldTap } from "./use-held-tap";

describe("useHeldTap", () => {
  let root: Root;
  let tap: () => void = () => {};
  const Holder = ({ busy, run }: { busy: boolean; run: () => void }) => {
    tap = useHeldTap(busy, run);
    return null;
  };
  const draw = (busy: boolean, run: () => void) =>
    act(async () => root.render(createElement(Holder, { busy, run })));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acts at once when nothing is out", async () => {
    const run = vi.fn();
    await draw(false, run);
    await act(async () => tap());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps a tap during the wait, then acts once with what the wait found", async () => {
    const before = vi.fn();
    const after = vi.fn();
    await draw(true, before);
    await act(async () => tap());
    expect(before).not.toHaveBeenCalled();

    await draw(false, after);
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);

    await draw(false, after);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("counts two taps during the wait as one", async () => {
    const run = vi.fn();
    await draw(true, run);
    await act(async () => {
      tap();
      tap();
    });
    await act(async () => tap());
    await draw(false, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the wait ends with no tap", async () => {
    const run = vi.fn();
    await draw(true, run);
    await draw(false, run);
    expect(run).not.toHaveBeenCalled();
  });

  it("drops a kept tap when the page is left", async () => {
    const run = vi.fn();
    await draw(true, run);
    await act(async () => tap());
    await act(async () => root.unmount());
    expect(run).not.toHaveBeenCalled();
  });
});
