// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamInterface } from "@/types/exam-theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// One pending fetch per assessment id, resolved by each test.
const pending = new Map<string, (value: ExamInterface | null) => void>();

vi.mock("@/services/exam-interface", () => ({
  fetchExamInterface: (id: string) =>
    new Promise<ExamInterface | null>((resolve) => {
      pending.set(id, resolve);
    }),
}));

const { useAssessmentExamTheme, EXAM_THEME_LOAD_CAP_MS } = await import(
  "./use-assessment-exam-theme"
);

type Seen = { id: string; loading: boolean };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let seen: Seen[] = [];

function Probe({ assessmentId }: { assessmentId?: string }) {
  const { theme, isLoading } = useAssessmentExamTheme(assessmentId);
  seen.push({ id: theme.id, loading: isLoading });
  return null;
}

function render(assessmentId?: string) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(<Probe assessmentId={assessmentId} />));
}

const last = () => seen[seen.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  pending.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("useAssessmentExamTheme", () => {
  it("stays loading until the fetch settles, then exposes the theme", async () => {
    render("a1");
    expect(last()).toEqual({ id: "default", loading: true });
    await act(async () => {
      pending.get("a1")!({ v: 1, preset: "jee-main", strict: true });
    });
    expect(last()).toEqual({ id: "jee-main", loading: false });
    // Never reported "not loading" while still on the placeholder theme.
    expect(seen.some((s) => !s.loading && s.id === "default")).toBe(false);
  });

  it("a null answer settles on the default theme", async () => {
    render("a2");
    await act(async () => {
      pending.get("a2")!(null);
    });
    expect(last()).toEqual({ id: "default", loading: false });
  });

  it("stops loading after the cap and still applies a late answer", async () => {
    render("a3");
    act(() => {
      vi.advanceTimersByTime(EXAM_THEME_LOAD_CAP_MS - 1);
    });
    expect(last().loading).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(last()).toEqual({ id: "default", loading: false });
    await act(async () => {
      pending.get("a3")!({ v: 1, preset: "gate" });
    });
    expect(last()).toEqual({ id: "gate", loading: false });
  });

  it("no assessment id: not loading, default theme", () => {
    render(undefined);
    expect(last()).toEqual({ id: "default", loading: false });
  });

  it("ignores the answer for an assessment the screen has left", async () => {
    render("old");
    render("new");
    await act(async () => {
      pending.get("old")!({ v: 1, preset: "gate" });
    });
    expect(last()).toEqual({ id: "default", loading: true });
    await act(async () => {
      pending.get("new")!({ v: 1, preset: "rrb-je" });
    });
    expect(last()).toEqual({ id: "rrb-je", loading: false });
  });
});
