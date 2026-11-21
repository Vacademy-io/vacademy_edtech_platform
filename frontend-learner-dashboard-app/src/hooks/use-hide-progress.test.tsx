// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The institute on screen and each institute's stored setting, set by each test.
let currentInstitute: string | null | undefined = "inst-a";
const pending = new Map<string, (hide: boolean | null) => void>();
let failNext = false;

vi.mock("@/services/points", () => ({ useCurrentInstituteId: () => currentInstitute }));
vi.mock("@/services/student-display-settings", () => ({
  getStudentDisplaySettings: () =>
    new Promise((resolve, reject) => {
      if (failNext) {
        failNext = false;
        reject(new Error("down"));
        return;
      }
      const key = String(currentInstitute);
      pending.set(key, (hide) => resolve(hide === null ? {} : { courseDetails: { hideProgressCard: hide } }));
    }),
}));

const { useHideProgress } = await import("./use-hide-progress");

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const seen: (boolean | null)[] = [];

function Probe() {
  seen.push(useHideProgress());
  return null;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
}

function unmount() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

async function answer(institute: string, hide: boolean | null) {
  await act(async () => {
    pending.get(institute)?.(hide);
    await Promise.resolve();
  });
}

afterEach(() => {
  unmount();
  seen.length = 0;
  pending.clear();
});

describe("useHideProgress", () => {
  it("is null until the setting is read, then follows it", async () => {
    currentInstitute = "inst-a";
    mount();
    expect(seen.at(-1)).toBeNull();
    await answer("inst-a", false);
    expect(seen.at(-1)).toBe(false);
  });

  it("remembers the answer for the same institute on the way back to Home", () => {
    currentInstitute = "inst-a";
    mount();
    expect(seen[0]).toBe(false);
  });

  it("does not carry one institute's answer into another after a switch", async () => {
    // inst-a showed progress (false, remembered from the tests above).
    currentInstitute = "inst-b";
    mount();
    expect(seen).not.toContain(false);
    expect(seen.at(-1)).toBeNull();
    await answer("inst-b", true);
    expect(seen.at(-1)).toBe(true);
  });

  it("reads a setting with no courseDetails as showing progress", async () => {
    currentInstitute = "inst-c";
    mount();
    await answer("inst-c", null);
    expect(seen.at(-1)).toBe(false);
  });

  it("shows progress when the setting cannot be read", async () => {
    currentInstitute = "inst-d";
    failNext = true;
    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(seen.at(-1)).toBe(false);
  });
});
