// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";

// The label catalog: `keysOnly` is what react-i18next hands out before the
// namespace has loaded (every key comes back as itself).
const keysOnly = ((key: string) => key) as unknown as TFunction;
const loaded = ((key: string) => `label:${key}`) as unknown as TFunction;
let currentT: TFunction = keysOnly;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: currentT }) }));

type Settings = { sidebar: { tabs: { id: string; visible: boolean; label?: string }[] } };
const reads: ((value: Settings) => void)[] = [];
vi.mock("@/services/student-display-settings", () => ({
  getStudentDisplaySettings: () => new Promise<Settings>((resolve) => reads.push(resolve)),
}));

const { usePlayNavItems } = await import("./PlayBottomNav");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let titles: string[] = [];
let keys: (string | undefined)[] = [];
function Probe({ tick }: { tick: number }) {
  const items = usePlayNavItems();
  titles = items.map((item) => item.title);
  keys = items.map((item) => item.labelKey);
  return <span data-tick={tick} />;
}

const settings: Settings = {
  sidebar: { tabs: [{ id: "dashboard", visible: true }, { id: "learning-center", visible: true }] },
};

describe("usePlayNavItems", () => {
  it("keeps the translated labels when a read started before the catalog loaded lands last", async () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe tick={0} />));
    expect(reads).toHaveLength(1);

    // The catalog loads: a new t, so the settings are read again.
    currentT = loaded;
    act(() => root.render(<Probe tick={1} />));
    expect(reads).toHaveLength(2);

    // The second read answers first, then the first (stale) one.
    await act(async () => reads[1]!(settings));
    await act(async () => reads[0]!(settings));

    expect(titles).toEqual(["label:common.home", "label:playBottomNav.labels.learningCenter"]);
    act(() => root.unmount());
  });

  it("hands each built-in tab its catalog key, so a bar can read the label in its own render", async () => {
    currentT = keysOnly;
    reads.length = 0;
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe tick={0} />));
    await act(async () =>
      reads[0]!({
        sidebar: {
          tabs: [
            { id: "dashboard", visible: true },
            { id: "learning-center", visible: true },
            { id: "attendance", visible: true, label: "My days" },
          ],
        },
      }),
    );
    // Read before the catalog loaded: the titles are keys, the keys stay usable.
    expect(keys).toEqual(["common.home", "playBottomNav.labels.learningCenter", undefined]);
    expect(titles[2]).toBe("My days");
    act(() => root.unmount());
  });
});
